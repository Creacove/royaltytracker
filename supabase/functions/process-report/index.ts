import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Google Document AI ──────────────────────────────────────────────

async function getAccessToken(serviceAccountJson: string): Promise<string> {
  // Handle common secret storage issues: extra quotes, escaped newlines
  let cleaned = serviceAccountJson.trim();
  // Remove wrapping quotes if the entire string is quoted
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  // Unescape escaped newlines (common when pasting JSON into secret forms)
  cleaned = cleaned.replace(/\\n/g, "\n");
  
  let sa: any;
  try {
    sa = JSON.parse(cleaned);
  } catch (e) {
    console.error("[process-report] Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY. First 100 chars:", cleaned.substring(0, 100));
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON. Please re-enter the full service account JSON.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = btoa(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );

  const unsignedToken = `${header}.${payload}`;

  // Import the private key
  const pemContent = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
  const jwt = `${unsignedToken}.${sig}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Failed to get access token: ${errText}`);
  }

  const data = await resp.json();
  return data.access_token;
}

interface BBox {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
}

interface ParsedTable {
  page_number: number;
  headers: { text: string; bbox: BBox }[];
  rows: Record<string, { value: string; bbox: BBox; confidence: number }>[];
}

function extractBBox(vertices: { x?: number; y?: number }[]): BBox {
  const xs = vertices.map((v) => v.x ?? 0);
  const ys = vertices.map((v) => v.y ?? 0);
  return {
    x_min: Math.min(...xs),
    y_min: Math.min(...ys),
    x_max: Math.max(...xs),
    y_max: Math.max(...ys),
  };
}

function getTextFromLayout(
  layout: any,
  fullText: string
): string {
  if (!layout?.textAnchor?.textSegments) return "";
  let text = "";
  for (const seg of layout.textAnchor.textSegments) {
    const start = parseInt(seg.startIndex ?? "0", 10);
    const end = parseInt(seg.endIndex ?? "0", 10);
    text += fullText.slice(start, end);
  }
  return text.trim();
}

function parseDocumentAIResponse(document: any): ParsedTable[] {
  const fullText: string = document.text || "";
  const tables: ParsedTable[] = [];

  for (let pageIdx = 0; pageIdx < (document.pages || []).length; pageIdx++) {
    const page = document.pages[pageIdx];
    const pageNum = pageIdx + 1;

    for (const table of page.tables || []) {
      const headers: { text: string; bbox: BBox }[] = [];
      if (table.headerRows?.[0]) {
        for (const cell of table.headerRows[0].cells) {
          const text = getTextFromLayout(cell.layout, fullText);
          const bbox = extractBBox(
            cell.layout?.boundingPoly?.normalizedVertices || []
          );
          headers.push({ text, bbox });
        }
      }

      const rows: Record<
        string,
        { value: string; bbox: BBox; confidence: number }
      >[] = [];
      for (const bodyRow of table.bodyRows || []) {
        const rowData: Record<
          string,
          { value: string; bbox: BBox; confidence: number }
        > = {};
        for (let ci = 0; ci < (bodyRow.cells || []).length; ci++) {
          const cell = bodyRow.cells[ci];
          const colName =
            ci < headers.length ? headers[ci].text : `col_${ci}`;
          rowData[colName] = {
            value: getTextFromLayout(cell.layout, fullText),
            bbox: extractBBox(
              cell.layout?.boundingPoly?.normalizedVertices || []
            ),
            confidence: cell.layout?.confidence ?? 0,
          };
        }
        rows.push(rowData);
      }

      tables.push({ page_number: pageNum, headers, rows });
    }
  }

  return tables;
}

// ─── Table Reconstruction & Column Mapping ───────────────────────────

const COLUMN_MAPPINGS: Record<string, string> = {
  ISRC: "isrc",
  ISWC: "iswc",
  UPC: "upc",
  "TRACK TITLE": "track_title",
  TRACK: "track_title",
  SONG: "track_title",
  TITLE: "track_title",
  "TRACK ARTIST": "track_artist",
  ARTIST: "track_artist",
  ALBUM: "release_title",
  RELEASE: "release_title",
  TERRITORY: "territory",
  COUNTRY: "territory",
  PLATFORM: "platform",
  DSP: "platform",
  SERVICE: "platform",
  CHANNEL: "platform",
  UNITS: "usage_count",
  PLAYS: "usage_count",
  STREAMS: "usage_count",
  QUANTITY: "usage_count",
  "GROSS REVENUE": "gross_revenue",
  GROSS: "gross_revenue",
  "TOTAL REVENUE": "gross_revenue",
  "NET REVENUE": "net_revenue",
  NET: "net_revenue",
  COMMISSION: "commission",
  FEE: "commission",
  "YOUR SHARE": "publisher_share",
  "PUBLISHER SHARE": "publisher_share",
  SHARE: "publisher_share",
  "START DATE": "sales_start",
  "SALES START": "sales_start",
  "END DATE": "sales_end",
  "SALES END": "sales_end",
  "REPORT DATE": "report_date",
  LABEL: "label_name",
  PUBLISHER: "publisher_name",
};

const HEADER_KEYWORDS = [
  "ISRC",
  "REVENUE",
  "TERRITORY",
  "PLATFORM",
  "TRACK",
  "ARTIST",
  "TITLE",
  "STREAM",
  "PLAY",
  "USAGE",
];

function mapColumnName(raw: string): string {
  const clean = raw.toUpperCase().trim();
  if (COLUMN_MAPPINGS[clean]) return COLUMN_MAPPINGS[clean];
  for (const [pattern, standard] of Object.entries(COLUMN_MAPPINGS)) {
    if (clean.includes(pattern)) return standard;
  }
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_");
}

function detectHeaders(headers: { text: string }[]): boolean {
  const headerText = headers.map((h) => h.text.toUpperCase()).join(" ");
  const matchCount = HEADER_KEYWORDS.filter((kw) =>
    headerText.includes(kw)
  ).length;
  return matchCount >= 3;
}

function isSummaryRow(row: Record<string, any>): boolean {
  for (const v of Object.values(row)) {
    if (typeof v === "string") {
      const upper = v.toUpperCase();
      if (["TOTAL", "SUBTOTAL", "SUM", "GRAND"].some((kw) => upper.includes(kw)))
        return true;
    }
  }
  if (!row.isrc && !row.track_title) return true;
  return false;
}

interface TransactionRow {
  [key: string]: any;
}

function reconstructTables(tables: ParsedTable[]): TransactionRow[] {
  let headerMemory: string[] | null = null;
  const allRows: TransactionRow[] = [];

  for (const table of tables) {
    const hasHeaders = detectHeaders(table.headers);
    if (hasHeaders) {
      headerMemory = table.headers.map((h) => mapColumnName(h.text));
    } else if (!headerMemory) {
      continue;
    }

    for (let ri = 0; ri < table.rows.length; ri++) {
      const rowData = table.rows[ri];
      const record: TransactionRow = {
        source_page: table.page_number,
        source_row: ri,
      };

      const keys = Object.keys(rowData);
      const headers = headerMemory!;
      const bboxes: Record<string, BBox> = {};
      let confidenceSum = 0;
      let confidenceCount = 0;

      for (let ci = 0; ci < headers.length; ci++) {
        if (ci < keys.length) {
          const cell = rowData[keys[ci]];
          record[headers[ci]] = cell.value;
          bboxes[headers[ci]] = cell.bbox;
          if (cell.confidence > 0) {
            confidenceSum += cell.confidence;
            confidenceCount++;
          }
        }
      }

      record._bboxes = bboxes;
      record.ocr_confidence =
        confidenceCount > 0 ? confidenceSum / confidenceCount : 0;

      if (!isSummaryRow(record)) {
        allRows.push(record);
      }
    }
  }

  return allRows;
}

// ─── Normalization ───────────────────────────────────────────────────

const TERRITORY_MAP: Record<string, string> = {
  UK: "GB",
  USA: "US",
  "UNITED STATES": "US",
  "UNITED KINGDOM": "GB",
  ENGLAND: "GB",
  SCOTLAND: "GB",
  WALES: "GB",
  "NORTHERN IRELAND": "GB",
  "SOUTH KOREA": "KR",
  KOREA: "KR",
  HOLLAND: "NL",
  NETHERLANDS: "NL",
};

function normalizeISRC(isrc: string | null | undefined): string | null {
  if (!isrc) return null;
  const clean = isrc.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length !== 12) return null;
  return `${clean.slice(0, 2)}-${clean.slice(2, 5)}-${clean.slice(5, 7)}-${clean.slice(7, 12)}`;
}

function normalizeTerritory(t: string | null | undefined): string | null {
  if (!t) return null;
  const clean = t.trim().toUpperCase();
  return TERRITORY_MAP[clean] || (clean.length === 2 ? clean : clean);
}

const PLATFORM_PATTERNS: [RegExp, string][] = [
  [/spotify/i, "Spotify"],
  [/apple.*music/i, "Apple Music"],
  [/youtube/i, "YouTube"],
  [/deezer/i, "Deezer"],
  [/tidal/i, "Tidal"],
  [/amazon.*music/i, "Amazon Music"],
  [/pandora/i, "Pandora"],
];

function normalizePlatform(p: string | null | undefined): string | null {
  if (!p) return null;
  for (const [re, name] of PLATFORM_PATTERNS) {
    if (re.test(p)) return name;
  }
  return p.trim();
}

function parseCurrency(value: any): number | null {
  if (value == null || value === "") return null;
  const str = String(value).trim();
  const isNegative = str.includes("(") && str.includes(")");
  let clean = str.replace(/[^\d.,-]/g, "");
  if (!clean) return null;

  // Handle European vs US format
  if (clean.includes(",") && clean.includes(".")) {
    if (clean.lastIndexOf(",") > clean.lastIndexOf(".")) {
      clean = clean.replace(/\./g, "").replace(",", ".");
    } else {
      clean = clean.replace(/,/g, "");
    }
  } else if (clean.includes(",")) {
    const parts = clean.split(",");
    if (parts[parts.length - 1].length <= 3) {
      clean = clean.replace(/,/g, "");
    } else {
      clean = clean.replace(",", ".");
    }
  }

  const num = parseFloat(clean);
  if (isNaN(num)) return null;
  return isNegative ? -num : num;
}

function normalizeRow(row: TransactionRow): TransactionRow {
  const r = { ...row };
  r.isrc = normalizeISRC(r.isrc);
  r.territory = normalizeTerritory(r.territory);
  r.platform = normalizePlatform(r.platform);
  for (const col of [
    "gross_revenue",
    "commission",
    "net_revenue",
    "publisher_share",
  ]) {
    if (r[col] != null) r[col] = parseCurrency(r[col]);
  }
  if (r.usage_count != null) {
    const n = parseInt(String(r.usage_count).replace(/[^0-9]/g, ""), 10);
    r.usage_count = isNaN(n) ? null : n;
  }
  // Clean strings
  for (const col of ["track_title", "artist_name", "track_artist", "release_title", "label_name", "publisher_name"]) {
    if (typeof r[col] === "string") {
      r[col] = r[col].replace(/\s+/g, " ").trim() || null;
    }
  }
  return r;
}

// ─── Validation ──────────────────────────────────────────────────────

interface ValidationError {
  row_index: number;
  error_type: string;
  expected: number | null;
  actual: number | null;
  deviation: number | null;
  severity: string;
  field: string;
  message: string;
}

function validateRows(
  rows: TransactionRow[],
  tolerance = 0.01
): { errors: ValidationError[]; accuracy: number } {
  const errors: ValidationError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // Revenue math: gross - commission = net
    if (r.gross_revenue != null && r.commission != null && r.net_revenue != null) {
      const expected = r.gross_revenue - r.commission;
      const deviation = Math.abs(expected - r.net_revenue);
      if (deviation > tolerance) {
        errors.push({
          row_index: i,
          error_type: "revenue_math_mismatch",
          expected,
          actual: r.net_revenue,
          deviation,
          severity: deviation > 1.0 ? "critical" : "warning",
          field: "net_revenue",
          message: `Expected net ${expected.toFixed(4)} but got ${r.net_revenue.toFixed(4)} (Δ${deviation.toFixed(4)})`,
        });
      }
    }

    // Non-negative checks
    for (const col of ["gross_revenue", "net_revenue", "commission", "publisher_share"]) {
      if (r[col] != null && r[col] < 0) {
        errors.push({
          row_index: i,
          error_type: "negative_value",
          expected: 0,
          actual: r[col],
          deviation: Math.abs(r[col]),
          severity: "warning",
          field: col,
          message: `${col} is negative: ${r[col]}`,
        });
      }
    }

    // Required fields
    for (const col of ["track_title", "platform", "territory"]) {
      if (!r[col]) {
        errors.push({
          row_index: i,
          error_type: "missing_required_field",
          expected: null,
          actual: null,
          deviation: null,
          severity: "warning",
          field: col,
          message: `Missing required field: ${col}`,
        });
      }
    }
  }

  const criticalRows = new Set(
    errors.filter((e) => e.severity === "critical").map((e) => e.row_index)
  );
  const validRows = rows.length - criticalRows.size;
  const accuracy = rows.length > 0 ? (validRows / rows.length) * 100 : 0;

  return { errors, accuracy };
}

// ─── Main Handler ────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { report_id } = await req.json();
    if (!report_id) {
      return new Response(
        JSON.stringify({ error: "report_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[process-report] Starting for report ${report_id}`);

    // 1. Fetch report metadata
    const { data: report, error: fetchErr } = await supabase
      .from("cmo_reports")
      .select("*")
      .eq("id", report_id)
      .single();

    if (fetchErr || !report) {
      throw new Error(`Report not found: ${fetchErr?.message}`);
    }

    // 2. Update status to processing
    await supabase
      .from("cmo_reports")
      .update({ status: "processing" })
      .eq("id", report_id);

    // 3. Download PDF from storage
    const { data: pdfData, error: dlErr } = await supabase.storage
      .from("cmo-reports")
      .download(report.file_path);

    if (dlErr || !pdfData) {
      throw new Error(`Failed to download PDF: ${dlErr?.message}`);
    }

    const pdfBytes = new Uint8Array(await pdfData.arrayBuffer());
    // Chunk the conversion to avoid call stack overflow on large files
    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < pdfBytes.length; i += CHUNK) {
      binary += String.fromCharCode(...pdfBytes.subarray(i, i + CHUNK));
    }
    const pdfBase64 = btoa(binary);

    console.log(`[process-report] PDF downloaded (${pdfBytes.byteLength} bytes)`);

    // 4. Call Google Document AI
    const gcpProject = Deno.env.get("GOOGLE_CLOUD_PROJECT")!;
    const processorId = Deno.env.get("DOCUMENTAI_PROCESSOR_ID")!;
    const saKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY")!;

    const accessToken = await getAccessToken(saKey);

    const docAIUrl = `https://us-documentai.googleapis.com/v1/projects/${gcpProject}/locations/us/processors/${processorId}:process`;

    console.log(`[process-report] Calling Document AI...`);

    const aiResp = await fetch(docAIUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rawDocument: {
          content: pdfBase64,
          mimeType: "application/pdf",
        },
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      throw new Error(`Document AI error (${aiResp.status}): ${errText}`);
    }

    const aiResult = await aiResp.json();
    const document = aiResult.document;

    console.log(`[process-report] Document AI returned ${document.pages?.length ?? 0} pages`);

    // 5. Parse tables from Document AI response
    const tables = parseDocumentAIResponse(document);

    // 6. Reconstruct into rows
    const rawRows = reconstructTables(tables);

    if (rawRows.length === 0) {
      // No data extracted
      await supabase
        .from("cmo_reports")
        .update({
          status: "completed",
          processed_at: new Date().toISOString(),
          transaction_count: 0,
          accuracy_score: 0,
          error_count: 0,
          total_revenue: 0,
        })
        .eq("id", report_id);

      return new Response(
        JSON.stringify({
          status: "completed",
          message: "No data tables found in document",
          transactions: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Normalize
    const normalizedRows = rawRows.map(normalizeRow);

    // 8. Validate
    const { errors: validationErrors, accuracy } = validateRows(normalizedRows);

    const criticalErrors = validationErrors.filter(
      (e) => e.severity === "critical"
    );
    const criticalRowIndices = new Set(criticalErrors.map((e) => e.row_index));

    // 9. Insert transactions into royalty_transactions
    const transactions = normalizedRows.map((r, i) => ({
      report_id,
      user_id: report.user_id,
      track_title: r.track_title || r.artist_name || null,
      artist_name: r.track_artist || r.artist_name || null,
      isrc: r.isrc || null,
      iswc: r.iswc || null,
      platform: r.platform || null,
      territory: r.territory || null,
      quantity: r.usage_count || null,
      gross_revenue: r.gross_revenue ?? null,
      commission: r.commission ?? null,
      net_revenue: r.net_revenue ?? null,
      currency: "USD",
      source_page: r.source_page ?? null,
      source_row: r.source_row ?? null,
      ocr_confidence: r.ocr_confidence ?? null,
      bbox_x: r._bboxes
        ? Object.values(r._bboxes as Record<string, BBox>)[0]?.x_min ?? null
        : null,
      bbox_y: r._bboxes
        ? Object.values(r._bboxes as Record<string, BBox>)[0]?.y_min ?? null
        : null,
      bbox_width: r._bboxes
        ? (() => {
            const first = Object.values(r._bboxes as Record<string, BBox>)[0];
            return first ? first.x_max - first.x_min : null;
          })()
        : null,
      bbox_height: r._bboxes
        ? (() => {
            const first = Object.values(r._bboxes as Record<string, BBox>)[0];
            return first ? first.y_max - first.y_min : null;
          })()
        : null,
      validation_status: criticalRowIndices.has(i) ? "failed" : "passed",
      raw_data: r._bboxes ? { bounding_boxes: r._bboxes } : null,
    }));

    // Insert in batches of 500
    const BATCH_SIZE = 500;
    for (let start = 0; start < transactions.length; start += BATCH_SIZE) {
      const batch = transactions.slice(start, start + BATCH_SIZE);
      const { error: insErr } = await supabase
        .from("royalty_transactions")
        .insert(batch);
      if (insErr) {
        console.error(`[process-report] Insert error at batch ${start}:`, insErr.message);
        throw new Error(`Failed to insert transactions: ${insErr.message}`);
      }
    }

    console.log(`[process-report] Inserted ${transactions.length} transactions`);

    // 10. Insert validation errors
    if (validationErrors.length > 0) {
      const errorRecords = validationErrors.map((e) => ({
        report_id,
        user_id: report.user_id,
        error_type: e.error_type,
        severity: e.severity,
        message: e.message,
        field_name: e.field,
        expected_value: e.expected != null ? String(e.expected) : null,
        actual_value: e.actual != null ? String(e.actual) : null,
        source_page: normalizedRows[e.row_index]?.source_page ?? null,
      }));

      for (let start = 0; start < errorRecords.length; start += BATCH_SIZE) {
        const batch = errorRecords.slice(start, start + BATCH_SIZE);
        const { error: errInsErr } = await supabase
          .from("validation_errors")
          .insert(batch);
        if (errInsErr) {
          console.error(`[process-report] Validation error insert failed:`, errInsErr.message);
        }
      }

      console.log(`[process-report] Inserted ${errorRecords.length} validation errors`);
    }

    // 11. Update report with results
    const totalRevenue = normalizedRows.reduce(
      (sum, r) => sum + (r.gross_revenue ?? 0),
      0
    );

    await supabase
      .from("cmo_reports")
      .update({
        status: "completed",
        processed_at: new Date().toISOString(),
        transaction_count: transactions.length,
        accuracy_score: Math.round(accuracy * 100) / 100,
        error_count: validationErrors.length,
        total_revenue: Math.round(totalRevenue * 100) / 100,
        page_count: document.pages?.length ?? 0,
      })
      .eq("id", report_id);

    console.log(`[process-report] Done. ${transactions.length} transactions, ${accuracy.toFixed(1)}% accuracy`);

    return new Response(
      JSON.stringify({
        status: "completed",
        transactions: transactions.length,
        errors: validationErrors.length,
        accuracy: Math.round(accuracy * 100) / 100,
        pages: document.pages?.length ?? 0,
        revenue: Math.round(totalRevenue * 100) / 100,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[process-report] FAILED:", error);

    // Try to mark report as failed
    try {
      const { report_id } = await req.clone().json().catch(() => ({}));
      if (report_id) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const sb = createClient(supabaseUrl, supabaseServiceKey);
        await sb
          .from("cmo_reports")
          .update({ status: "failed" })
          .eq("id", report_id);
      }
    } catch (_) {
      // best effort
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
