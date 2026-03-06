import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type AiInsightsMode = "workspace-general" | "artist" | "track";

type EntityContext = {
  track_key?: string;
  track_title?: string;
  artist_key?: string;
  artist_name?: string;
};

type RequestPayload = {
  question?: string;
  from_date?: string;
  to_date?: string;
  conversation_id?: string;
  entity_context?: EntityContext;
};

type InsightRow = {
  track_key: string;
  track_title: string;
  artist_name: string;
  isrc: string | null;
  net_revenue: number;
  gross_revenue: number;
  quantity: number;
  net_per_unit: number;
  trend_3m_pct: number;
  top_territory: string;
  top_platform: string;
  failed_line_count: number;
  open_critical_task_count: number;
  opportunity_score: number;
  quality_flag: string;
};

type TrackAssistantTurnResponse = {
  conversation_id?: string;
  answer_title?: string;
  answer_text?: string;
  why_this_matters?: string;
  kpis?: Array<{ label?: string; value?: string }>;
  table?: {
    columns?: string[];
    rows?: Array<Record<string, string | number | null>>;
  };
  chart?: {
    type?: "bar" | "line" | "none" | string;
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
  follow_up_questions?: string[];
  diagnostics?: {
    intent?: string;
    confidence?: "high" | "medium" | "low" | string;
    used_fields?: string[];
    missing_fields?: string[];
    strict_mode?: boolean;
  };
  clarification?: {
    prompt?: string;
    options?: string[];
  };
};

type TrackNaturalChatPlanResponse = {
  plan_id?: string;
  sql_preview?: string;
  execution_token?: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asString(value: unknown, maxLen = 3000): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function normalizeDate(input: string | null, fallback: string): string {
  if (!input) return fallback;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  return iso.test(input) ? input : fallback;
}

function compactMoney(value: number): string {
  return Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value || 0);
}

function detectMode(question: string, context: EntityContext): AiInsightsMode {
  if (context.track_key) return "track";
  if (context.artist_key || context.artist_name) return "artist";
  const q = question.toLowerCase();
  if (q.includes("artist")) return "artist";
  if (q.includes("track") || q.includes("isrc")) return "track";
  return "workspace-general";
}

function inferConfidence(rows: InsightRow[]): "high" | "medium" | "low" {
  if (rows.length === 0) return "low";
  const highRiskCount = rows.filter((r) => r.quality_flag === "high").length;
  const highRiskShare = highRiskCount / rows.length;
  if (highRiskShare <= 0.1) return "high";
  if (highRiskShare <= 0.3) return "medium";
  return "low";
}

function topByNet(rows: InsightRow[], count = 8): InsightRow[] {
  return [...rows].sort((a, b) => (b.net_revenue || 0) - (a.net_revenue || 0)).slice(0, count);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeAssistantKpis(
  raw: TrackAssistantTurnResponse["kpis"],
): Array<{ label: string; value: string }> {
  if (!Array.isArray(raw)) return [];
  const normalized: Array<{ label: string; value: string }> = [];
  for (const item of raw) {
    if (!isNonEmptyString(item?.label) || !isNonEmptyString(item?.value)) continue;
    normalized.push({ label: item.label.trim(), value: item.value.trim() });
  }
  return normalized;
}

function normalizeAssistantFollowUps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

function toAiVisual(payload: TrackAssistantTurnResponse): {
  type: "bar" | "line" | "table" | "none";
  title?: string;
  x?: string;
  y?: string[];
  rows?: Array<Record<string, string | number | null>>;
  columns?: string[];
} {
  const chartType = payload.chart?.type;
  const chartRows = payload.table?.rows ?? [];
  const chartColumns = payload.table?.columns ?? [];
  const chartX = payload.chart?.x;
  const chartY = payload.chart?.y ?? [];

  if ((chartType === "bar" || chartType === "line") && chartRows.length > 0 && chartY.length > 0 && isNonEmptyString(chartX)) {
    return {
      type: chartType,
      title: payload.chart?.title,
      x: chartX,
      y: chartY,
      rows: chartRows,
      columns: chartColumns,
    };
  }

  if (chartRows.length > 0) {
    return {
      type: "table",
      columns: chartColumns,
      rows: chartRows,
      title: payload.answer_title,
    };
  }

  return { type: "none" };
}

function toFunctionErrorMessage(error: { message?: string } | null, data: unknown): string {
  const fallback = (error?.message ?? "Edge Function returned a non-2xx status code").trim();
  if (!data || typeof data !== "object" || Array.isArray(data)) return fallback;
  const record = data as Record<string, unknown>;
  const detail = typeof record.detail === "string" ? record.detail.trim() : "";
  const message = typeof record.error === "string" ? record.error.trim() : "";
  if (message && detail) return `${message} (${detail})`;
  if (message) return message;
  if (detail) return detail;
  return fallback;
}

function normalizeArtistKey(artistName: string): string {
  const normalized = artistName.trim().toLowerCase().replace(/\s+/g, " ");
  return `artist:${normalized || "unknown artist"}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey =
      Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseKey) {
      return jsonResponse({ error: "Missing Supabase environment." }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing authorization header." }, 401);

    const userClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const body = (await req.json().catch(() => ({}))) as RequestPayload;
    const question = asString(body.question, 1200);
    if (!question) return jsonResponse({ error: "question is required." }, 400);

    const today = new Date().toISOString().slice(0, 10);
    const oneYearAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365).toISOString().slice(0, 10);
    const fromDate = normalizeDate(asString(body.from_date, 20), oneYearAgo);
    const toDate = normalizeDate(asString(body.to_date, 20), today);
    const entityContext: EntityContext = body.entity_context ?? {};
    const mode = detectMode(question, entityContext);

    const { data, error } = await userClient.rpc("get_track_insights_list_v1", {
      from_date: fromDate,
      to_date: toDate,
      filters_json: {},
    });
    if (error) {
      return jsonResponse(
        {
          error: "Failed to load workspace insight rows.",
          detail: error.message,
          code: (error as { code?: string } | null)?.code ?? null,
        },
        500,
      );
    }
    const rows = (Array.isArray(data) ? data : []) as InsightRow[];

    let scopedRows = rows;
    const resolvedEntities: EntityContext = {};

    if (mode === "artist" && (isNonEmptyString(entityContext.artist_key) || isNonEmptyString(entityContext.artist_name))) {
      const selectedArtistKey = isNonEmptyString(entityContext.artist_key)
        ? entityContext.artist_key
        : isNonEmptyString(entityContext.artist_name)
          ? normalizeArtistKey(entityContext.artist_name)
          : null;

      if (!selectedArtistKey) {
        return jsonResponse({ error: "artist_key or artist_name is required for artist scope." }, 400);
      }

      const selectedArtistRow = rows.find((r) => normalizeArtistKey(r.artist_name) === selectedArtistKey);
      resolvedEntities.artist_key = selectedArtistKey;
      if (selectedArtistRow) resolvedEntities.artist_name = selectedArtistRow.artist_name;

      let assistantPayload: TrackAssistantTurnResponse | null = null;

      const { data: sendTurnData, error: sendTurnError } = await userClient.functions.invoke(
        "insights-artist-chat",
        {
          body: {
            action: "send_turn",
            artist_key: selectedArtistKey,
            artist_name: resolvedEntities.artist_name ?? entityContext.artist_name,
            from_date: fromDate,
            to_date: toDate,
            question,
            conversation_id: body.conversation_id,
          },
        },
      );

      if (sendTurnError) {
        const sendTurnMessage = toFunctionErrorMessage(sendTurnError as { message?: string }, sendTurnData);
        const artistRows = rows.filter((r) => normalizeArtistKey(r.artist_name) === selectedArtistKey);
        const q = question.toLowerCase();
        const asksOpportunityRisk = /\b(opportunity|potential)\b.*\b(risk|data risk|quality risk)\b|\b(highest opportunity)\b.*\b(highest data risk)\b/.test(q);
        const asksRevenueTracks =
          (/\b(track|tracks|song|songs)\b/.test(q) && /\b(revenue|money|earning|royalt|gross|net|generating)\b/.test(q)) ||
          /\b(top|highest|best|most)\b.*\b(track|tracks|song|songs)\b/.test(q) ||
          /\b(top|highest|best|most)\b.*\b(revenue|money|earning|royalt|gross|net)\b/.test(q);

        if (artistRows.length > 0 && (asksOpportunityRisk || asksRevenueTracks)) {
          const ranked = [...artistRows].sort((a, b) => (b.net_revenue || 0) - (a.net_revenue || 0));
          const topNMatch = q.match(/\btop\s+(\d{1,2})\b/);
          const topN = topNMatch ? Math.max(1, Math.min(20, Number(topNMatch[1]))) : 5;

          const tableRows = asksOpportunityRisk
            ? ranked
              .slice(0, topN)
              .map((r) => ({
                track_title: r.track_title,
                net_revenue: Number((r.net_revenue || 0).toFixed(2)),
                opportunity_score: Number((r.opportunity_score || 0).toFixed(2)),
                quality_flag: r.quality_flag,
                failed_line_count: r.failed_line_count ?? 0,
              }))
            : ranked
              .slice(0, topN)
              .map((r) => ({
                track_title: r.track_title,
                net_revenue: Number((r.net_revenue || 0).toFixed(2)),
                quantity: Number((r.quantity || 0).toFixed(2)),
                top_platform: r.top_platform,
                top_territory: r.top_territory,
              }));

          const answerTitle = asksOpportunityRisk ? "Top Opportunity + Risk Tracks" : "Top Revenue Tracks";
          const executive = asksOpportunityRisk
            ? `I found ${tableRows.length} tracks with the strongest combined opportunity and data-risk signal for this artist.`
            : `I found the top ${tableRows.length} revenue tracks for this artist in the selected period.`;

          return jsonResponse({
            conversation_id: body.conversation_id ?? crypto.randomUUID(),
            resolved_mode: "artist",
            resolved_entities: resolvedEntities,
            answer_title: "DEBUG ERROR: " + String(sendTurnMessage),
            executive_answer: executive,
            why_this_matters: "Identifying high-performing tracks helps in marketing and promotion planning. Focus budget on these top earners to maximize return.",
            evidence: {
              row_count: tableRows.length,
              scanned_rows: artistRows.length,
              from_date: fromDate,
              to_date: toDate,
              provenance: ["get_track_insights_list_v1"],
              system_confidence: tableRows.length > 0 ? "medium" : "low",
            },
            kpis: [
              { label: "Tracks considered", value: String(artistRows.length) },
              { label: "Top rows returned", value: String(tableRows.length) },
            ],
            visual: {
              type: "table",
              title: answerTitle,
              columns: Object.keys(tableRows[0] ?? {}),
              rows: tableRows,
            },
            actions: [
              { label: "Open Artist Transactions", href: `/transactions?q=${encodeURIComponent(resolvedEntities.artist_name ?? entityContext.artist_name ?? "")}`, kind: "primary" },
              { label: "Open Reviews", href: "/review-queue", kind: "secondary" },
              { label: "Open Statements", href: "/reports", kind: "ghost" },
            ],
            follow_up_questions: asksOpportunityRisk
              ? [
                "Show only high-opportunity tracks with critical quality flags.",
                "Which territories are driving this risk/opportunity mix?",
                "Which of these tracks changed most in the last 90 days?",
              ]
              : [
                "Show these tracks by platform contribution.",
                "Which territories underperform for the top tracks?",
                "Compare this artist's top tracks month over month.",
              ],
            diagnostics: {
              intent: "unknown",
              confidence: "medium",
              used_fields: ["track_title", "net_revenue", "opportunity_score", "quality_flag"],
              missing_fields: [],
              strict_mode: true,
              fallback_mode: "router_deterministic_artist_rows",
              verifier_status: "failed",
              insufficiency_reason: sendTurnMessage,
            },
          });
        }

        const rowCount = artistRows.length;
        return jsonResponse({
          conversation_id: body.conversation_id ?? crypto.randomUUID(),
          resolved_mode: "artist",
          resolved_entities: resolvedEntities,
          answer_title: "DEBUG ERROR: " + String(sendTurnMessage),
          executive_answer: rowCount > 0
            ? "I could not generate a verified SQL answer for this artist question. Try a narrower query like top 5 tracks by revenue."
            : "No artist-scoped rows were found for the selected context and date range.",
          why_this_matters: "Refining your search helps isolate specific revenue drivers. Use top tracks to identify your core growth opportunities.",
          evidence: {
            row_count: 0,
            scanned_rows: rowCount,
            from_date: fromDate,
            to_date: toDate,
            provenance: ["insights-artist-chat", "get_track_insights_list_v1"],
            system_confidence: "low",
          },
          kpis: [],
          visual: { type: "none" },
          actions: [
            { label: "Open Artist Transactions", href: `/transactions?q=${encodeURIComponent(resolvedEntities.artist_name ?? entityContext.artist_name ?? "")}`, kind: "primary" },
            { label: "Open Reviews", href: "/review-queue", kind: "secondary" },
            { label: "Open Statements", href: "/reports", kind: "ghost" },
          ],
          follow_up_questions: [
            "Try a broader date range.",
            "Ask for top 5 tracks by revenue.",
            "Check whether this artist has mapped transactions in scope.",
          ],
          diagnostics: {
            intent: "unknown",
            confidence: "low",
            used_fields: [],
            missing_fields: [],
            strict_mode: true,
            verifier_status: "failed",
            insufficiency_reason: sendTurnMessage,
          },
        });
      }

      assistantPayload = (sendTurnData ?? {}) as TrackAssistantTurnResponse;
      const verifierStatus = (assistantPayload.diagnostics as Record<string, unknown> | undefined)?.verifier_status;
      const insufficiencyReason = (assistantPayload.diagnostics as Record<string, unknown> | undefined)?.insufficiency_reason;
      const evidenceRowCount = Number(assistantPayload.evidence?.row_count ?? 0);

      // Only fall back when the response is genuinely empty — verifier failed AND zero rows.
      // A passed response with data_notes warnings is still a valid answer.
      const isTrulyFailed = verifierStatus === "failed" && evidenceRowCount === 0;

      if (isTrulyFailed) {
        const artistRows = rows.filter((r) => normalizeArtistKey(r.artist_name) === selectedArtistKey);
        const q = question.toLowerCase();
        const asksOpportunityRisk = /\b(opportunity|potential)\b.*\b(risk|data risk|quality risk)\b|\b(highest opportunity)\b.*\b(highest data risk)\b/.test(q);
        const asksRevenueTracks =
          (/\b(track|tracks|song|songs)\b/.test(q) && /\b(revenue|money|earning|royalt|gross|net|generating)\b/.test(q)) ||
          /\b(top|highest|best|most)\b.*\b(track|tracks|song|songs)\b/.test(q) ||
          /\b(top|highest|best|most)\b.*\b(revenue|money|earning|royalt|gross|net)\b/.test(q);

        if (artistRows.length > 0 && (asksOpportunityRisk || asksRevenueTracks)) {
          const ranked = [...artistRows].sort((a, b) => (b.net_revenue || 0) - (a.net_revenue || 0));
          const topNMatch = q.match(/\btop\s+(\d{1,2})\b/);
          const topN = topNMatch ? Math.max(1, Math.min(20, Number(topNMatch[1]))) : 5;

          const tableRows = asksOpportunityRisk
            ? ranked
              .slice(0, topN)
              .map((r) => ({
                track_title: r.track_title,
                net_revenue: Number((r.net_revenue || 0).toFixed(2)),
                opportunity_score: Number((r.opportunity_score || 0).toFixed(2)),
                quality_flag: r.quality_flag,
                failed_line_count: r.failed_line_count ?? 0,
              }))
            : ranked
              .slice(0, topN)
              .map((r) => ({
                track_title: r.track_title,
                net_revenue: Number((r.net_revenue || 0).toFixed(2)),
                quantity: Number((r.quantity || 0).toFixed(2)),
                top_platform: r.top_platform,
                top_territory: r.top_territory,
              }));

          const answerTitle = asksOpportunityRisk ? "Top Opportunity + Risk Tracks" : "Top Revenue Tracks";
          const executive = asksOpportunityRisk
            ? `I found ${tableRows.length} tracks with the strongest combined opportunity and data-risk signal for this artist.`
            : `I found the top ${tableRows.length} revenue tracks for this artist in the selected period.`;

          return jsonResponse({
            conversation_id: assistantPayload.conversation_id ?? body.conversation_id ?? crypto.randomUUID(),
            resolved_mode: "artist",
            resolved_entities: resolvedEntities,
            answer_title: answerTitle,
            executive_answer: executive,
            why_this_matters: "Identifying high-performing tracks helps in marketing and promotion planning. Focus budget on these top earners to maximize return.",
            evidence: {
              row_count: tableRows.length,
              scanned_rows: artistRows.length,
              from_date: fromDate,
              to_date: toDate,
              provenance: ["get_track_insights_list_v1"],
              system_confidence: tableRows.length > 0 ? "medium" : "low",
            },
            kpis: [
              { label: "Tracks considered", value: String(artistRows.length) },
              { label: "Top rows returned", value: String(tableRows.length) },
            ],
            visual: {
              type: "table",
              title: answerTitle,
              columns: Object.keys(tableRows[0] ?? {}),
              rows: tableRows,
            },
            actions: [
              { label: "Open Artist Transactions", href: `/transactions?q=${encodeURIComponent(resolvedEntities.artist_name ?? entityContext.artist_name ?? "")}`, kind: "primary" },
              { label: "Open Reviews", href: "/review-queue", kind: "secondary" },
              { label: "Open Statements", href: "/reports", kind: "ghost" },
            ],
            follow_up_questions: asksOpportunityRisk
              ? [
                "Show only high-opportunity tracks with critical quality flags.",
                "Which territories are driving this risk/opportunity mix?",
                "Which of these tracks changed most in the last 90 days?",
              ]
              : [
                "Show these tracks by platform contribution.",
                "Which territories underperform for the top tracks?",
                "Compare this artist's top tracks month over month.",
              ],
            diagnostics: {
              ...(assistantPayload.diagnostics ?? {}),
              fallback_mode: "router_deterministic_artist_rows",
              verifier_status: "failed",
              insufficiency_reason: typeof insufficiencyReason === "string" && insufficiencyReason.length > 0
                ? insufficiencyReason
                : "no_rows_returned",
            },
          });
        }

        const rowCount = Number(assistantPayload.evidence?.row_count ?? 0);
        return jsonResponse({
          conversation_id: assistantPayload.conversation_id ?? body.conversation_id ?? crypto.randomUUID(),
          resolved_mode: "artist",
          resolved_entities: resolvedEntities,
          answer_title: "No Data Found",
          executive_answer: "No artist-scoped rows were found for the selected context and date range. Try expanding the date range or check if this artist has imported transactions.",
          why_this_matters: "There is no transaction data in scope to answer this question.",
          evidence: {
            row_count: rowCount,
            scanned_rows: rowCount,
            from_date: assistantPayload.evidence?.from_date ?? fromDate,
            to_date: assistantPayload.evidence?.to_date ?? toDate,
            provenance: Array.isArray(assistantPayload.evidence?.provenance) ? assistantPayload.evidence?.provenance : ["run_artist_chat_sql_v1"],
            system_confidence: "low",
          },
          kpis: [],
          visual: { type: "none" },
          actions: [
            { label: "Open Artist Transactions", href: `/transactions?q=${encodeURIComponent(resolvedEntities.artist_name ?? entityContext.artist_name ?? "")}`, kind: "primary" },
            { label: "Open Reviews", href: "/review-queue", kind: "secondary" },
            { label: "Open Statements", href: "/reports", kind: "ghost" },
          ],
          follow_up_questions: [
            "Try a broader date range.",
            "Ask for net revenue by platform or territory.",
            "Check data mapping completeness for this artist.",
          ],
          diagnostics: assistantPayload.diagnostics ?? {
            intent: "unknown",
            confidence: "low",
            used_fields: [],
            missing_fields: [],
            strict_mode: false,
            verifier_status: "failed",
            insufficiency_reason: typeof insufficiencyReason === "string" && insufficiencyReason.length > 0
              ? insufficiencyReason
              : "no_rows_returned",
          },
        });
      }
      if (!assistantPayload || !isNonEmptyString(assistantPayload.answer_text)) {
        if (assistantPayload && "error" in assistantPayload && typeof assistantPayload.error === "string") {
          return jsonResponse({ error: `Artist assistant error: ${assistantPayload.error}` }, 502);
        }
        return jsonResponse({ error: "Artist assistant returned an empty verified response." }, 502);
      }
      const rowCount = Number(assistantPayload.evidence?.row_count ?? 0);
      const kpis = normalizeAssistantKpis(assistantPayload.kpis);
      const followUps = normalizeAssistantFollowUps(assistantPayload.follow_up_questions);
      const visual = toAiVisual(assistantPayload);

      return jsonResponse({
        conversation_id: assistantPayload.conversation_id ?? body.conversation_id ?? crypto.randomUUID(),
        resolved_mode: "artist",
        resolved_entities: resolvedEntities,
        answer_title:
          (isNonEmptyString(assistantPayload.answer_title) && assistantPayload.answer_title) ||
          "Artist AI answer",
        executive_answer: assistantPayload.answer_text,
        why_this_matters:
          (isNonEmptyString(assistantPayload.why_this_matters) && assistantPayload.why_this_matters) ||
          (isNonEmptyString(assistantPayload.answer_title) ? assistantPayload.answer_title : "Artist-level reviewed evidence in scope."),
        evidence: {
          row_count: rowCount,
          scanned_rows: rowCount,
          from_date: assistantPayload.evidence?.from_date ?? fromDate,
          to_date: assistantPayload.evidence?.to_date ?? toDate,
          provenance: Array.isArray(assistantPayload.evidence?.provenance) ? assistantPayload.evidence?.provenance : ["run_artist_chat_sql_v1"],
          system_confidence: rowCount > 0 ? "high" : "low",
        },
        kpis,
        visual,
        actions: [
          { label: "Open Artist Transactions", href: `/transactions?q=${encodeURIComponent(resolvedEntities.artist_name ?? entityContext.artist_name ?? "")}`, kind: "primary" },
          { label: "Open Reviews", href: "/review-queue", kind: "secondary" },
          { label: "Open Statements", href: "/reports", kind: "ghost" },
        ],
        follow_up_questions:
          followUps.length > 0
            ? followUps
            : [
              "Which tracks contribute most to this artist's revenue?",
              "Which territories underperform for this artist?",
              "Where are the biggest quality blockers for this artist?",
            ],
        diagnostics: assistantPayload.diagnostics ?? undefined,
      });
    }

    if (mode === "track" && entityContext.track_key) {
      scopedRows = rows.filter((r) => r.track_key === entityContext.track_key);
      const track = scopedRows[0];
      if (track) {
        resolvedEntities.track_key = track.track_key;
        resolvedEntities.track_title = track.track_title;
        resolvedEntities.artist_name = track.artist_name;
        resolvedEntities.artist_key = normalizeArtistKey(track.artist_name);
      }
    } else if (mode === "artist") {
      const requestedArtistKey = isNonEmptyString(entityContext.artist_key)
        ? entityContext.artist_key
        : isNonEmptyString(entityContext.artist_name)
          ? normalizeArtistKey(entityContext.artist_name)
          : null;
      if (requestedArtistKey) {
        scopedRows = rows.filter((r) => normalizeArtistKey(r.artist_name) === requestedArtistKey);
        const first = scopedRows[0];
        if (first) {
          resolvedEntities.artist_name = first.artist_name;
          resolvedEntities.artist_key = requestedArtistKey;
        } else {
          resolvedEntities.artist_key = requestedArtistKey;
        }
      } else {
        const artistNeedle = question.toLowerCase();
        scopedRows = rows.filter((r) => r.artist_name.toLowerCase().includes(artistNeedle));
        if (scopedRows[0]) {
          resolvedEntities.artist_name = scopedRows[0].artist_name;
          resolvedEntities.artist_key = normalizeArtistKey(scopedRows[0].artist_name);
        }
      }
    }

    if (mode === "track" && entityContext.track_key) {
      const trackRow = rows.find((r) => r.track_key === entityContext.track_key);
      if (trackRow) {
        resolvedEntities.track_key = trackRow.track_key;
        resolvedEntities.track_title = trackRow.track_title;
        resolvedEntities.artist_name = trackRow.artist_name;
      } else {
        resolvedEntities.track_key = entityContext.track_key;
      }

      let assistantPayload: TrackAssistantTurnResponse | null = null;
      const sendTurnPayload = {
        action: "send_turn",
        track_key: entityContext.track_key,
        from_date: fromDate,
        to_date: toDate,
        question,
        conversation_id: body.conversation_id,
      };

      const { data: sendTurnData, error: sendTurnError } = await userClient.functions.invoke(
        "insights-natural-chat",
        { body: sendTurnPayload },
      );

      if (!sendTurnError) {
        assistantPayload = (sendTurnData ?? {}) as TrackAssistantTurnResponse;
      } else {
        const sendTurnMessage = toFunctionErrorMessage(sendTurnError as { message?: string }, sendTurnData);
        const canFallback = /unsupported action/i.test(sendTurnMessage);
        if (!canFallback) {
          return jsonResponse(
            {
              error: "Failed to generate track insight answer.",
              detail: sendTurnMessage,
              code: (sendTurnError as { code?: string } | null)?.code ?? null,
            },
            500,
          );
        }

        const { data: planData, error: planError } = await userClient.functions.invoke(
          "insights-natural-chat",
          {
            body: {
              action: "plan_query",
              track_key: entityContext.track_key,
              question,
              from_date: fromDate,
              to_date: toDate,
            },
          },
        );

        if (planError) {
          return jsonResponse(
            {
              error: "Failed to generate track insight answer.",
              detail: toFunctionErrorMessage(planError as { message?: string }, planData),
              code: (planError as { code?: string } | null)?.code ?? null,
            },
            500,
          );
        }

        const plan = (planData ?? {}) as TrackNaturalChatPlanResponse;
        if (!isNonEmptyString(plan.plan_id) || !isNonEmptyString(plan.sql_preview) || !isNonEmptyString(plan.execution_token)) {
          return jsonResponse(
            { error: "Track assistant planning returned an invalid response." },
            502,
          );
        }

        const { data: runData, error: runError } = await userClient.functions.invoke(
          "insights-natural-chat",
          {
            body: {
              action: "run_query",
              track_key: entityContext.track_key,
              from_date: fromDate,
              to_date: toDate,
              plan_id: plan.plan_id,
              sql_preview: plan.sql_preview,
              execution_token: plan.execution_token,
            },
          },
        );

        if (runError) {
          return jsonResponse(
            {
              error: "Failed to generate track insight answer.",
              detail: toFunctionErrorMessage(runError as { message?: string }, runData),
              code: (runError as { code?: string } | null)?.code ?? null,
            },
            500,
          );
        }
        assistantPayload = (runData ?? {}) as TrackAssistantTurnResponse;
      }

      if (!assistantPayload) {
        return jsonResponse(
          { error: "Track assistant returned an empty response." },
          502,
        );
      }

      if (!isNonEmptyString(assistantPayload.answer_text)) {
        return jsonResponse(
          { error: "Track assistant returned an empty response." },
          502,
        );
      }

      const rowCount = Number(assistantPayload.evidence?.row_count ?? 0);
      const kpis = normalizeAssistantKpis(assistantPayload.kpis);
      const followUps = normalizeAssistantFollowUps(assistantPayload.follow_up_questions);
      const visual = toAiVisual(assistantPayload);

      return jsonResponse({
        conversation_id: assistantPayload.conversation_id ?? body.conversation_id ?? crypto.randomUUID(),
        resolved_mode: "track",
        resolved_entities: resolvedEntities,
        answer_title:
          (isNonEmptyString(assistantPayload.answer_title) && assistantPayload.answer_title) ||
          "Track AI answer",
        executive_answer: assistantPayload.answer_text,
        why_this_matters:
          (isNonEmptyString(assistantPayload.why_this_matters) && assistantPayload.why_this_matters) ||
          (isNonEmptyString(assistantPayload.answer_title) ? assistantPayload.answer_title : "Track-level reviewed evidence in scope."),
        evidence: {
          row_count: rowCount,
          scanned_rows: rowCount,
          from_date: assistantPayload.evidence?.from_date ?? fromDate,
          to_date: assistantPayload.evidence?.to_date ?? toDate,
          provenance: Array.isArray(assistantPayload.evidence?.provenance) ? assistantPayload.evidence?.provenance : ["run_track_chat_sql_v2"],
          system_confidence: rowCount > 0 ? "high" : "low",
        },
        kpis,
        visual,
        actions: [
          { label: "Open Track Insights", href: `/insights/${encodeURIComponent(entityContext.track_key)}?from=${fromDate}&to=${toDate}&track_key=${encodeURIComponent(entityContext.track_key)}`, kind: "primary" },
          { label: "Open Transactions", href: `/transactions?track_key=${encodeURIComponent(entityContext.track_key)}`, kind: "secondary" },
          { label: "Open Reviews", href: "/review-queue", kind: "ghost" },
        ],
        follow_up_questions:
          followUps.length > 0
            ? followUps
            : [
              "Which territories underperform for this track?",
              "What should I review first to improve payout confidence?",
              "Show top leakage patterns for this track.",
            ],
      });
    }

    if (scopedRows.length === 0) scopedRows = topByNet(rows, 12);

    const totalNet = scopedRows.reduce((sum, row) => sum + (row.net_revenue || 0), 0);
    const totalQty = scopedRows.reduce((sum, row) => sum + (row.quantity || 0), 0);
    const avgTrend = scopedRows.length
      ? scopedRows.reduce((sum, row) => sum + (row.trend_3m_pct || 0), 0) / scopedRows.length
      : 0;
    const topItem = topByNet(scopedRows, 1)[0];
    const confidence = inferConfidence(scopedRows);

    const modeLabel =
      mode === "track" ? "track" : mode === "artist" ? "artist" : "workspace";
    const executiveAnswer =
      mode === "track" && topItem
        ? `${topItem.track_title} by ${topItem.artist_name} generated ${compactMoney(totalNet)} in the selected range.`
        : mode === "artist" && resolvedEntities.artist_name
          ? `${resolvedEntities.artist_name} generated ${compactMoney(totalNet)} across ${scopedRows.length} tracks in scope.`
          : `Your workspace generated ${compactMoney(totalNet)} across ${scopedRows.length} prioritized tracks in scope.`;

    const whyThisMatters =
      avgTrend >= 0
        ? `Momentum is positive (${avgTrend.toFixed(1)}% avg trend), so act now on top performers to compound growth.`
        : `Momentum is soft (${avgTrend.toFixed(1)}% avg trend), so prioritize recovery actions on leakage and quality risks.`;

    const visualRows = topByNet(scopedRows, 8).map((row) => ({
      track: row.track_title,
      artist: row.artist_name,
      net_revenue: Number((row.net_revenue || 0).toFixed(2)),
      trend_3m_pct: Number((row.trend_3m_pct || 0).toFixed(1)),
    }));

    const followUp = mode === "track"
      ? [
        "Which territories are underperforming for this track?",
        "What quality blockers are reducing payout confidence?",
        "Show platform-specific trend changes for this track.",
      ]
      : mode === "artist"
        ? [
          "Which tracks contribute most to this artist's net revenue?",
          "Where is this artist losing money by territory?",
          "Which tracks need review attention first?",
        ]
        : [
          "Which tracks have high opportunity but high data risk?",
          "Where are we strongest and weakest by territory?",
          "Which artists should we prioritize this week?",
        ];

    const actions = mode === "track" && resolvedEntities.track_key
      ? [
        { label: "Open Transactions", href: `/transactions?track_key=${encodeURIComponent(resolvedEntities.track_key)}`, kind: "primary" },
        { label: "Open Reviews", href: "/review-queue", kind: "secondary" },
        { label: "Open Statements", href: "/reports", kind: "ghost" },
      ]
      : mode === "artist" && resolvedEntities.artist_name
        ? [
          { label: "Open Artist Transactions", href: `/transactions?q=${encodeURIComponent(resolvedEntities.artist_name)}`, kind: "primary" },
          { label: "Open Reviews", href: "/review-queue", kind: "secondary" },
          { label: "Open Statements", href: "/reports", kind: "ghost" },
        ]
        : [
          { label: "Open Transactions", href: "/transactions", kind: "primary" },
          { label: "Open Reviews", href: "/review-queue", kind: "secondary" },
          { label: "Open Statements", href: "/reports", kind: "ghost" },
        ];

    return jsonResponse({
      conversation_id: body.conversation_id ?? crypto.randomUUID(),
      resolved_mode: mode,
      resolved_entities: resolvedEntities,
      answer_title:
        mode === "track"
          ? "Track summary"
          : mode === "artist"
            ? "Artist summary"
            : "Workspace summary",
      executive_answer: executiveAnswer,
      why_this_matters: whyThisMatters,
      evidence: {
        row_count: scopedRows.length,
        scanned_rows: rows.length,
        from_date: fromDate,
        to_date: toDate,
        provenance: ["get_track_insights_list_v1"],
        system_confidence: confidence,
      },
      kpis: [
        { label: `${modeLabel} net revenue`, value: compactMoney(totalNet) },
        { label: "Units in scope", value: Math.round(totalQty).toLocaleString() },
        { label: "Avg 3M trend", value: `${avgTrend.toFixed(1)}%` },
      ],
      visual: {
        type: "bar",
        title: "Top Tracks by Net Revenue",
        x: "track",
        y: ["net_revenue"],
        rows: visualRows,
      },
      actions,
      follow_up_questions: followUp,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error." }, 500);
  }
});
