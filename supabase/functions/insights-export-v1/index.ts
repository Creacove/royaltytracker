import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import * as XLSX from "https://esm.sh/xlsx@0.18.5?target=deno";
import { PDFDocument, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EXPORT_BUCKET = "insights-exports";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

type Action = "export_answer" | "export_monthly_snapshot";

type AssistantExportPayload = {
  answer_title?: string;
  answer_text?: string;
  why_this_matters?: string;
  kpis?: Array<{ label?: string; value?: string; change?: string }>;
  table?: {
    columns?: string[];
    rows?: Array<Record<string, string | number | null>>;
  };
  result?: {
    columns?: string[];
    rows?: Array<Record<string, string | number | null>>;
  };
  chart?: {
    type?: string;
    x?: string;
    y?: string[];
    title?: string;
  };
  evidence?: {
    row_count?: number;
    from_date?: string;
    to_date?: string;
    provenance?: string[];
  };
};

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asArrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter((item): item is string => !!item);
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseJwtClaims(token: string): { role?: string; sub?: string; user_id?: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(b64 + pad));
  } catch {
    return null;
  }
}

function toIsoDate(input: string): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date.");
  return d.toISOString().slice(0, 10);
}

function defaultDateRange(): { fromDate: string; toDate: string } {
  const today = new Date();
  const from = new Date(today);
  from.setMonth(from.getMonth() - 12);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: today.toISOString().slice(0, 10),
  };
}

function normalizeDateRange(fromDate: unknown, toDate: unknown): { fromDate: string; toDate: string } {
  const defaults = defaultDateRange();
  const from = asString(fromDate) ? toIsoDate(asString(fromDate)!) : defaults.fromDate;
  const to = asString(toDate) ? toIsoDate(asString(toDate)!) : defaults.toDate;
  if (from > to) throw new Error("from_date cannot be after to_date.");
  return { fromDate: from, toDate: to };
}

function parseAnswerPayload(input: unknown): AssistantExportPayload {
  const root = asObject(input) ?? {};
  const kpis = Array.isArray(root.kpis)
    ? root.kpis
      .map((item) => asObject(item))
      .filter((item): item is Record<string, unknown> => !!item)
      .map((item) => ({
        label: asString(item.label) ?? "",
        value: asString(item.value) ?? "",
        change: asString(item.change) ?? "",
      }))
      .filter((item) => item.label.length > 0 && item.value.length > 0)
    : [];

  const parseTable = (obj: unknown) => {
    const tableObj = asObject(obj);
    return tableObj && Array.isArray(tableObj.rows)
      ? {
        columns: asArrayOfStrings(tableObj.columns),
        rows: tableObj.rows
          .map((row) => asObject(row))
          .filter((row): row is Record<string, unknown> => !!row)
          .map((row) => {
            const out: Record<string, string | number | null> = {};
            for (const [key, value] of Object.entries(row)) {
              if (value === null || value === undefined) out[key] = null;
              else if (typeof value === "string" || typeof value === "number") out[key] = value;
              else out[key] = String(value);
            }
            return out;
          }),
      }
      : undefined;
  };

  const table = parseTable(root.table) || parseTable(root.result);

  const chartObj = asObject(root.chart);
  const chart = chartObj ? {
    type: asString(chartObj.type) ?? "none",
    x: asString(chartObj.x) ?? "",
    y: asArrayOfStrings(chartObj.y),
    title: asString(chartObj.title) ?? undefined,
  } : undefined;

  const evidenceObj = asObject(root.evidence);
  const evidence = evidenceObj
    ? {
      row_count: Number(evidenceObj.row_count ?? 0),
      from_date: asString(evidenceObj.from_date) ?? undefined,
      to_date: asString(evidenceObj.to_date) ?? undefined,
      provenance: asArrayOfStrings(evidenceObj.provenance),
    }
    : undefined;

  return {
    answer_title: asString(root.answer_title) ?? undefined,
    answer_text: asString(root.answer_text) ?? undefined,
    why_this_matters: asString(root.why_this_matters) ?? undefined,
    kpis,
    table,
    chart,
    evidence,
  };
}

async function buildPdf({
  trackKey,
  fromDate,
  toDate,
  payload,
}: {
  trackKey: string;
  fromDate: string;
  toDate: string;
  payload: AssistantExportPayload;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  let page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const marginX = 50;
  const pageWidth = 612;
  const pageHeight = 792;
  const contentWidth = pageWidth - marginX * 2;
  let y = pageHeight - 50;

  const addNewPage = () => {
    page = doc.addPage([612, 792]);
    y = pageHeight - 50;
  };

  const drawText = (
    text: string,
    { size = 10, isBold = false, color = [0, 0, 0], wrap = true }: { size?: number; isBold?: boolean; color?: number[]; wrap?: boolean } = {}
  ) => {
    const activeFont = isBold ? fontBold : font;
    if (!wrap) {
      page.drawText(text, { x: marginX, y, size, font: activeFont });
      y -= size + 5;
      return;
    }

    const words = String(text).split(/\s+/);
    let line = "";
    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      const width = activeFont.widthOfTextAtSize(testLine, size);
      if (width > contentWidth) {
        page.drawText(line, { x: marginX, y, size, font: activeFont });
        y -= size + 5;
        line = word;
        if (y < 40) addNewPage();
      } else {
        line = testLine;
      }
    }
    page.drawText(line, { x: marginX, y, size, font: activeFont });
    y -= size + 10;
    if (y < 40) addNewPage();
  };

  // 1. Header
  page.drawRectangle({
    x: 0,
    y: pageHeight - 100,
    width: pageWidth,
    height: 100,
    color: { type: "RGB", red: 0.05, green: 0.05, blue: 0.08 } as any,
  });

  y = pageHeight - 45;
  page.drawText("ORDERSOUNDS", { x: marginX, y, size: 14, font: fontBold, color: { type: "RGB", red: 1, green: 1, blue: 1 } as any });
  y -= 25;
  page.drawText(payload.answer_title ?? "Publisher Insight Report", { x: marginX, y, size: 18, font: fontBold, color: { type: "RGB", red: 1, green: 1, blue: 1 } as any });
  y = pageHeight - 120;

  // Metadata
  drawText(`Track: ${trackKey}`, { isBold: true });
  drawText(`Period: ${fromDate} to ${toDate}`, { size: 9 });
  drawText(`Generated: ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`, { size: 8 });
  y -= 10;

  // 2. Direct Answer
  drawText("INSIGHT SUMMARY", { size: 12, isBold: true });
  drawText(payload.answer_text ?? "No commentary provided.", { size: 11 });

  if (payload.why_this_matters) {
    y -= 5;
    drawText("WHY THIS MATTERS", { size: 10, isBold: true });
    drawText(payload.why_this_matters, { size: 10 });
  }
  y -= 15;

  // 3. KPIs
  if (payload.kpis?.length) {
    drawText("KEY PERFORMANCE INDICATORS", { size: 12, isBold: true });
    const kpiYStart = y;
    let kpiX = marginX;
    const kpiColumns = 3;
    const kpiSpacing = 10;
    const kpiWidth = (contentWidth - (kpiSpacing * (kpiColumns - 1))) / kpiColumns;

    for (const kpi of payload.kpis) {
      page.drawRectangle({ x: kpiX, y: y - 40, width: kpiWidth, height: 45, color: { type: "RGB", red: 0.97, green: 0.97, blue: 0.98 } as any });
      page.drawText(kpi.label?.toUpperCase() ?? "", { x: kpiX + 5, y: y - 12, size: 7, font: fontBold });
      page.drawText(kpi.value ?? "", { x: kpiX + 5, y: y - 28, size: 12, font: fontBold });
      if (kpi.change) {
        page.drawText(kpi.change, { x: kpiX + 5, y: y - 36, size: 7, font });
      }
      kpiX += kpiWidth + kpiSpacing;
      if (kpiX + kpiWidth > pageWidth - marginX) {
        kpiX = marginX;
        y -= 55;
        if (y < 100) addNewPage();
      }
    }
    y = Math.min(y, kpiYStart - 60);
    y -= 20;
    if (y < 100) addNewPage();
  }

  // 4. Data Table
  if (payload.table?.rows?.length) {
    drawText("DATA EVIDENCE (TOP 25 RECORDS)", { size: 12, isBold: true });

    const cols = payload.table.columns?.slice(0, 6) ?? []; // Max 6 columns for width
    if (cols.length > 0) {
      const colWidth = contentWidth / cols.length;

      // Header
      page.drawRectangle({ x: marginX, y: y - 15, width: contentWidth, height: 18, color: { type: "RGB", red: 0.9, green: 0.9, blue: 0.92 } as any });
      let cellX = marginX;
      for (const col of cols) {
        page.drawText(col.replace(/_/g, " ").toUpperCase(), { x: cellX + 4, y: y - 10, size: 7, font: fontBold });
        cellX += colWidth;
      }
      y -= 20;

      // Rows
      for (const row of payload.table.rows.slice(0, 25)) {
        if (y < 50) {
          addNewPage();
          // Redraw headers on new page
          page.drawRectangle({ x: marginX, y: y - 15, width: contentWidth, height: 18, color: { type: "RGB", red: 0.9, green: 0.9, blue: 0.92 } as any });
          let hX = marginX;
          for (const col of cols) {
            page.drawText(col.replace(/_/g, " ").toUpperCase(), { x: hX + 4, y: y - 10, size: 7, font: fontBold });
            hX += colWidth;
          }
          y -= 20;
        }

        let rX = marginX;
        for (const col of cols) {
          const rawVal = row[col];
          const val = rawVal === null ? "-" : String(rawVal);
          page.drawText(val.slice(0, 25), { x: rX + 4, y: y - 10, size: 7, font: font });
          rX += colWidth;
        }

        page.drawLine({
          start: { x: marginX, y: y - 14 },
          end: { x: marginX + contentWidth, y: y - 14 },
          thickness: 0.2,
          color: { type: "RGB", red: 0.8, green: 0.8, blue: 0.8 } as any,
        });

        y -= 15;
      }
    }
  }

  return await doc.save();
}

function buildWorkbookFromAnswer(payload: AssistantExportPayload): Uint8Array {
  const wb = XLSX.utils.book_new();
  const kpiRows = (payload.kpis ?? []).map((kpi) => ({
    metric: kpi.label ?? "",
    value: kpi.value ?? "",
    change: kpi.change ?? "",
  }));
  const summaryRows = [
    { section: "answer_title", value: payload.answer_title ?? "" },
    { section: "answer_text", value: payload.answer_text ?? "" },
    { section: "why_this_matters", value: payload.why_this_matters ?? "" },
    { section: "rows_used", value: String(payload.evidence?.row_count ?? 0) },
    { section: "sources", value: (payload.evidence?.provenance ?? []).join(", ") },
  ];

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), "Executive");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpiRows.length ? kpiRows : [{ metric: "", value: "", change: "" }]), "Key Numbers");

  if (payload.table?.columns?.length && payload.table.rows) {
    const tableRows = payload.table.rows.map((row) => {
      const out: Record<string, string | number | null> = {};
      for (const col of payload.table!.columns!) out[col] = row[col] ?? null;
      return out;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tableRows), "Breakdown");
  }

  const data = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Uint8Array(data);
}

async function uploadAndSign({
  adminClient,
  userId,
  baseName,
  contentType,
  bytes,
}: {
  adminClient: ReturnType<typeof createClient>;
  userId: string;
  baseName: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<string> {
  const path = `${userId}/${Date.now()}_${baseName}`;
  const { error: uploadError } = await adminClient.storage.from(EXPORT_BUCKET).upload(path, bytes, {
    contentType,
    upsert: false,
  });
  if (uploadError) throw new Error(`Failed to upload export artifact: ${uploadError.message}`);
  const { data: signedData, error: signedError } = await adminClient.storage
    .from(EXPORT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signedError || !signedData?.signedUrl) {
    throw new Error(`Failed to sign export artifact URL: ${signedError?.message ?? "missing URL"}`);
  }
  return signedData.signedUrl;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
    const anonKey =
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");

    if (!supabaseUrl || !serviceRoleKey || !anonKey) throw new Error("Missing Supabase env.");

    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    const jwt = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const claims = parseJwtClaims(jwt);
    const role = claims?.role ?? null;
    let requesterId = claims?.sub ?? claims?.user_id ?? null;

    if (role !== "service_role") {
      const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt);
      if (userErr || !userData?.user?.id) {
        return new Response(JSON.stringify({ error: "Invalid or expired access token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      requesterId = userData.user.id;
    }

    if (!requesterId) {
      return new Response(JSON.stringify({ error: "Unable to resolve user identity" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    });

    const body = await req.json().catch(() => ({}));
    const action = asString((body as { action?: unknown }).action) as Action | null;
    if (action !== "export_answer" && action !== "export_monthly_snapshot") {
      return new Response(JSON.stringify({ error: "Unsupported action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const trackKey = asString((body as { track_key?: unknown }).track_key);
    if (!trackKey) throw new Error("track_key is required.");
    const { fromDate, toDate } = normalizeDateRange(
      (body as { from_date?: unknown }).from_date,
      (body as { to_date?: unknown }).to_date,
    );

    let answerPayload = parseAnswerPayload((body as { answer_payload?: unknown }).answer_payload);

    if (action === "export_monthly_snapshot") {
      const { data: detailData, error: detailError } = await userClient.rpc("get_track_insight_detail_v1", {
        p_track_key: trackKey,
        from_date: fromDate,
        to_date: toDate,
        filters_json: {},
      });
      if (detailError) throw new Error(`Failed to load monthly snapshot data: ${detailError.message}`);
      const detail = asObject(detailData);
      const summary = asObject(detail?.summary);
      const monthlyTrend = Array.isArray(detail?.monthly_trend)
        ? (detail?.monthly_trend as Array<Record<string, unknown>>)
        : [];
      const territoryMix = Array.isArray(detail?.territory_mix)
        ? (detail?.territory_mix as Array<Record<string, unknown>>)
        : [];
      const platformMix = Array.isArray(detail?.platform_mix)
        ? (detail?.platform_mix as Array<Record<string, unknown>>)
        : [];

      answerPayload = {
        answer_title: "Monthly Snapshot",
        answer_text:
          summary
            ? `This monthly snapshot summarizes reviewed data for ${asString(summary.track_title) ?? trackKey}.`
            : "This monthly snapshot summarizes reviewed data for the selected track.",
        why_this_matters:
          "Use this package for monthly performance review, discussion, and reporting handoff.",
        kpis: [
          { label: "Net Revenue", value: String(summary?.net_revenue ?? 0) },
          { label: "Gross Revenue", value: String(summary?.gross_revenue ?? 0) },
          { label: "Quantity", value: String(summary?.quantity ?? 0) },
          { label: "Rows Used", value: String(summary?.line_count ?? 0) },
        ],
        table: {
          columns: ["month_start", "net_revenue", "quantity", "gross_revenue"],
          rows: monthlyTrend.slice(0, 24).map((row) => ({
            month_start: (row.month_start as string) ?? null,
            net_revenue: (row.net_revenue as number) ?? null,
            quantity: (row.quantity as number) ?? null,
            gross_revenue: (row.gross_revenue as number) ?? null,
          })),
        },
        evidence: {
          row_count: Number(summary?.line_count ?? 0),
          from_date: fromDate,
          to_date: toDate,
          provenance: ["get_track_insight_detail_v1"],
        },
      };

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          (answerPayload.kpis ?? []).map((kpi) => ({ metric: kpi.label, value: kpi.value, change: kpi.change ?? "" })),
        ),
        "Executive KPIs",
      );
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(answerPayload.table?.rows ?? []), "Monthly Trend");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(territoryMix.slice(0, 50)), "Territory");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(platformMix.slice(0, 50)), "Platform");
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet([{ note: answerPayload.why_this_matters ?? "" }, { answer: answerPayload.answer_text ?? "" }]),
        "Narrative",
      );
      const xlsxMonthly = new Uint8Array(XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer);

      const pdfBytes = await buildPdf({
        trackKey,
        fromDate,
        toDate,
        payload: answerPayload,
      });

      const [pdfUrl, xlsxUrl] = await Promise.all([
        uploadAndSign({
          adminClient,
          userId: requesterId,
          baseName: `monthly_snapshot_${trackKey}.pdf`,
          contentType: "application/pdf",
          bytes: pdfBytes,
        }),
        uploadAndSign({
          adminClient,
          userId: requesterId,
          baseName: `monthly_snapshot_${trackKey}.xlsx`,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          bytes: xlsxMonthly,
        }),
      ]);

      return new Response(
        JSON.stringify({ pdf_url: pdfUrl, xlsx_url: xlsxUrl }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!answerPayload.answer_text && !answerPayload.table?.rows?.length) {
      throw new Error("answer_payload is required for export_answer.");
    }

    const pdfBytes = await buildPdf({
      trackKey,
      fromDate,
      toDate,
      payload: answerPayload,
    });
    const xlsxBytes = buildWorkbookFromAnswer(answerPayload);

    const [pdfUrl, xlsxUrl] = await Promise.all([
      uploadAndSign({
        adminClient,
        userId: requesterId,
        baseName: `answer_export_${trackKey}.pdf`,
        contentType: "application/pdf",
        bytes: pdfBytes,
      }),
      uploadAndSign({
        adminClient,
        userId: requesterId,
        baseName: `answer_export_${trackKey}.xlsx`,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: xlsxBytes,
      }),
    ]);

    return new Response(
      JSON.stringify({ pdf_url: pdfUrl, xlsx_url: xlsxUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
