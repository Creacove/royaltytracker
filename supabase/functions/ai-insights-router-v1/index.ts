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

type WorkspaceArtistRollup = {
  artist_name: string;
  gross_revenue: number;
  net_revenue: number;
  quantity: number;
  track_count: number;
};

type TrackSnapshotDetail = {
  summary: {
    track_key: string;
    track_title: string;
    artist_name: string;
    net_revenue: number;
    gross_revenue: number;
    quantity: number;
    net_per_unit: number;
    failed_line_count: number;
  };
  platform_mix: Array<{ platform: string; net_revenue: number; quantity: number }>;
  territory_mix: Array<{ territory: string; net_revenue: number; quantity: number }>;
  usage_mix: Array<{ usage_type: string; net_revenue: number; quantity: number }>;
  high_usage_low_payout: Array<{
    territory: string;
    quantity: number;
    net_revenue: number;
    usage_share: number;
    payout_share: number;
  }>;
  quality: {
    failed_line_count: number;
    open_critical_task_count: number;
  };
};

function isTrackSnapshotQuestion(question: string): boolean {
  return /\bpublisher snapshot for this track\b/i.test(question) || /\bconcise publisher snapshot\b/i.test(question);
}

function percent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function computeShare(total: number, amount: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return (amount / total) * 100;
}

async function fetchTrackSnapshotDetail(
  userClient: ReturnType<typeof createClient>,
  trackKey: string,
  fromDate: string,
  toDate: string,
): Promise<TrackSnapshotDetail | null> {
  const { data, error } = await userClient.rpc("get_track_insight_detail_v1", {
    p_track_key: trackKey,
    from_date: fromDate,
    to_date: toDate,
    filters_json: {},
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as TrackSnapshotDetail;
}

function buildTrackSnapshotSummaryResponse({
  detail,
  row,
  fromDate,
  toDate,
  resolvedEntities,
  conversationId,
}: {
  detail: TrackSnapshotDetail;
  row: InsightRow | undefined;
  fromDate: string;
  toDate: string;
  resolvedEntities: EntityContext;
  conversationId?: string;
}) {
  const summary = detail.summary;
  const topPlatform = detail.platform_mix[0];
  const topTerritory = detail.territory_mix[0];
  const underMonetized = detail.high_usage_low_payout[0];
  const totalPlatformRevenue = detail.platform_mix.reduce((sum, item) => sum + (item.net_revenue || 0), 0);
  const totalTerritoryRevenue = detail.territory_mix.reduce((sum, item) => sum + (item.net_revenue || 0), 0);
  const topPlatformShare = computeShare(totalPlatformRevenue, topPlatform?.net_revenue ?? 0);
  const topTerritoryShare = computeShare(totalTerritoryRevenue, topTerritory?.net_revenue ?? 0);
  const trend = row?.trend_3m_pct ?? 0;

  const summaryParts = [
    `${summary.track_title} generated ${compactMoney(summary.net_revenue)} from ${Math.round(summary.quantity || 0).toLocaleString()} units in the selected window.`,
  ];

  if (trend >= 15) {
    summaryParts.push(`Momentum is building, with the track up ${percent(trend)} over the last 3 months.`);
  } else if (trend <= -10) {
    summaryParts.push(`Recent momentum has softened, with the track down ${percent(Math.abs(trend))} over the last 3 months.`);
  }

  if (underMonetized) {
    summaryParts.push(
      `${underMonetized.territory} shows the clearest monetization gap, carrying ${percent((underMonetized.usage_share ?? 0) * 100)} of usage but only ${percent((underMonetized.payout_share ?? 0) * 100)} of payout.`,
    );
  } else if (topPlatform && topPlatformShare >= 55) {
    summaryParts.push(`${topPlatform.platform} is carrying ${percent(topPlatformShare)} of revenue, so performance is strong but concentrated.`);
  } else if (topTerritory && topTerritoryShare >= 40) {
    summaryParts.push(`${topTerritory.territory} is carrying ${percent(topTerritoryShare)} of revenue, making that market the clearest driver right now.`);
  }

  if ((detail.quality.open_critical_task_count ?? 0) > 0 || (detail.quality.failed_line_count ?? 0) > 0) {
    summaryParts.push(
      `Data confidence needs attention because this track still has ${detail.quality.failed_line_count ?? 0} failed lines and ${detail.quality.open_critical_task_count ?? 0} open critical review tasks.`,
    );
  }

  let whyThisMatters = "Use this snapshot to decide where to push the track next and where revenue quality needs review.";
  if (underMonetized) {
    whyThisMatters = `The biggest immediate action is to inspect rights coverage and payout mechanics in ${underMonetized.territory}, where usage is materially outrunning payout.`;
  } else if ((detail.quality.open_critical_task_count ?? 0) > 0) {
    whyThisMatters = "Revenue may be understated until the open critical review items are resolved, so cleanup can directly improve payout confidence.";
  } else if (trend >= 15) {
    whyThisMatters = "Positive momentum makes this a strong candidate for another marketing or playlist push while demand is rising.";
  }

  return {
    conversation_id: conversationId ?? crypto.randomUUID(),
    resolved_mode: "track" as const,
    resolved_entities: resolvedEntities,
    answer_title: "Track Snapshot",
    executive_answer: summaryParts.join(" "),
    why_this_matters: whyThisMatters,
    evidence: {
      row_count: 1,
      scanned_rows: 1,
      from_date: fromDate,
      to_date: toDate,
      provenance: ["get_track_insight_detail_v1"],
      system_confidence: "high" as const,
    },
    kpis: [
      { label: "Net revenue", value: compactMoney(summary.net_revenue) },
      { label: "Units", value: Math.round(summary.quantity || 0).toLocaleString() },
      { label: "3M trend", value: percent(trend) },
      { label: "Top platform", value: topPlatform?.platform ?? row?.top_platform ?? "Unknown" },
    ],
    visual: {
      type: "table" as const,
      title: "Track Snapshot Anchors",
      columns: ["track_title", "artist_name", "net_revenue", "quantity", "top_territory", "top_platform"],
      rows: [{
        track_title: summary.track_title,
        artist_name: summary.artist_name,
        net_revenue: Number((summary.net_revenue || 0).toFixed(2)),
        quantity: Math.round(summary.quantity || 0),
        top_territory: topTerritory?.territory ?? row?.top_territory ?? "Unknown",
        top_platform: topPlatform?.platform ?? row?.top_platform ?? "Unknown",
      }],
    },
    actions: [
      { label: "Open Track Insights", href: `/insights/${encodeURIComponent(summary.track_key)}?from=${fromDate}&to=${toDate}&track_key=${encodeURIComponent(summary.track_key)}`, kind: "primary" as const },
      { label: "Open Transactions", href: `/transactions?track_key=${encodeURIComponent(summary.track_key)}`, kind: "secondary" as const },
      { label: "Open Reviews", href: "/review-queue", kind: "ghost" as const },
    ],
    follow_up_questions: [
      "Which territories show the biggest payout leakage for this track?",
      "How is this track trending month over month?",
      "Which platform should get the next push for this track?",
    ],
    diagnostics: {
      intent: "track_snapshot_summary",
      confidence: "high",
      used_fields: ["net_revenue", "quantity", "platform_mix", "territory_mix", "high_usage_low_payout", "quality"],
      missing_fields: [],
      strict_mode: false,
      fallback_mode: "router_track_snapshot_detail",
    },
  };
}

function topNFromQuestion(question: string, fallback = 5): number {
  const match = question.toLowerCase().match(/\btop\s+(\d{1,2})\b/);
  if (!match) return fallback;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(20, parsed));
}

function buildWorkspaceArtistRollup(rows: InsightRow[]): WorkspaceArtistRollup[] {
  const map = new Map<string, WorkspaceArtistRollup>();
  const trackSets = new Map<string, Set<string>>();
  for (const row of rows) {
    const artist = (row.artist_name || "Unknown Artist").trim() || "Unknown Artist";
    if (!map.has(artist)) {
      map.set(artist, {
        artist_name: artist,
        gross_revenue: 0,
        net_revenue: 0,
        quantity: 0,
        track_count: 0,
      });
      trackSets.set(artist, new Set<string>());
    }
    const item = map.get(artist)!;
    item.gross_revenue += row.gross_revenue || 0;
    item.net_revenue += row.net_revenue || 0;
    item.quantity += row.quantity || 0;
    trackSets.get(artist)!.add(row.track_key);
  }
  for (const [artist, set] of trackSets.entries()) {
    const item = map.get(artist);
    if (item) item.track_count = set.size;
  }
  return Array.from(map.values());
}

function parseArtistNeedle(question: string): string | null {
  const q = question.trim();
  const patterns = [
    /\b(?:gross|net)?\s*revenue\s+(?:made\s+)?(?:by|from|for)\s+(.+)$/i,
    /\bhow\s+much\s+has\s+(.+?)\s+made\b/i,
    /\bhow\s+much\s+did\s+(.+?)\s+make\b/i,
  ];
  for (const p of patterns) {
    const m = q.match(p);
    if (!m) continue;
    const candidate = m[1]
      .replace(/[?.!,]+$/g, "")
      .replace(/\b(?:in|on|for)\s+this\s+catalogue\b/gi, "")
      .replace(/\b(?:catalogue|catalog)\b/gi, "")
      .trim();
    if (candidate.length >= 2) return candidate;
  }
  return null;
}

function isArtistRevenueQuestion(question: string): boolean {
  const q = question.toLowerCase();
  return /\b(revenue|made|make|earn|money|royalt|gross|net)\b/.test(q);
}

function buildDeterministicFallbackResponse({
  mode,
  question,
  fromDate,
  toDate,
  rows,
  scopedRows,
  resolvedEntities,
  conversationId,
}: {
  mode: AiInsightsMode;
  question: string;
  fromDate: string;
  toDate: string;
  rows: InsightRow[];
  scopedRows: InsightRow[];
  resolvedEntities: EntityContext;
  conversationId?: string;
}) {
  const safeScopedRows = scopedRows.length > 0 ? scopedRows : topByNet(rows, 12);
  const totalNet = safeScopedRows.reduce((sum, row) => sum + (row.net_revenue || 0), 0);
  const totalQty = safeScopedRows.reduce((sum, row) => sum + (row.quantity || 0), 0);
  const avgTrend = safeScopedRows.length
    ? safeScopedRows.reduce((sum, row) => sum + (row.trend_3m_pct || 0), 0) / safeScopedRows.length
    : 0;
  const topItem = topByNet(safeScopedRows, 1)[0];
  const confidence = inferConfidence(safeScopedRows);
  const modeLabel = mode === "track" ? "track" : mode === "artist" ? "artist" : "workspace";

  const executiveAnswer =
    mode === "track" && topItem
      ? `${topItem.track_title} by ${topItem.artist_name} generated ${compactMoney(totalNet)} in the selected range.`
      : mode === "artist" && resolvedEntities.artist_name
        ? `${resolvedEntities.artist_name} generated ${compactMoney(totalNet)} across ${safeScopedRows.length} tracks in scope.`
        : `Your workspace generated ${compactMoney(totalNet)} across ${safeScopedRows.length} prioritized tracks in scope.`;

  const whyThisMatters =
    avgTrend >= 0
      ? `Momentum is positive (${avgTrend.toFixed(1)}% avg trend), so act now on top performers to compound growth.`
      : `Momentum is soft (${avgTrend.toFixed(1)}% avg trend), so prioritize recovery actions on leakage and quality risks.`;

  const visualRows = topByNet(safeScopedRows, 8).map((row) => ({
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

  return {
    conversation_id: conversationId ?? crypto.randomUUID(),
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
      row_count: safeScopedRows.length,
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
    diagnostics: {
      intent: "fallback_summary",
      confidence,
      used_fields: ["track_title", "artist_name", "net_revenue", "quantity", "trend_3m_pct"],
      missing_fields: [],
      strict_mode: false,
      fallback_mode: "router_deterministic_scope_rows",
      reason: `fallback_applied_for_${mode}`,
      question,
    },
  };
}

function buildDeterministicTrackFallback({
  question,
  fromDate,
  toDate,
  rows,
  scopedRows,
  resolvedEntities,
  conversationId,
}: {
  question: string;
  fromDate: string;
  toDate: string;
  rows: InsightRow[];
  scopedRows: InsightRow[];
  resolvedEntities: EntityContext;
  conversationId?: string;
}) {
  const track = scopedRows[0] ?? rows.find((r) => r.track_key === resolvedEntities.track_key) ?? rows[0];
  if (!track) {
    return buildDeterministicFallbackResponse({
      mode: "track",
      question,
      fromDate,
      toDate,
      rows,
      scopedRows,
      resolvedEntities,
      conversationId,
    });
  }

  const q = question.toLowerCase();
  const asksTerritory = /\b(territory|country|market|region|geo|geography|tour|touring|concert|live show|shows?|city|cities)\b/.test(q);
  const asksPlatform = /\b(platform|dsp|service|spotify|apple|youtube|amazon|tidal|deezer)\b/.test(q);
  const asksGross = /\bgross\b/.test(q);
  const asksNet = /\bnet\b/.test(q);
  const metricLabel = asksGross ? "Gross revenue" : asksNet ? "Net revenue" : "Net revenue";
  const metricValue = asksGross ? track.gross_revenue || 0 : track.net_revenue || 0;

  const asksOpportunityRisk = /\b(opportunity|potential)\b.*\b(risk|data risk|quality risk)\b|\b(highest opportunity)\b.*\b(highest data risk)\b/.test(q);
  const asksRevenuePerformance = /\b(revenue|performance|earning|royalty|money|gross|net)\b/.test(q) && !asksTerritory && !asksPlatform;

  if (asksOpportunityRisk) {
    return {
      conversation_id: conversationId ?? crypto.randomUUID(),
      resolved_mode: "track" as const,
      resolved_entities: resolvedEntities,
      answer_title: "Track Opportunity + Risk",
      executive_answer: `I analyzed the risk profile for "${track.track_title}". It has an opportunity score of ${track.opportunity_score}/100 and is flagged as ${track.quality_flag} risk.`,
      why_this_matters: "A high opportunity score combined with quality flags suggests this track needs cleanup to ensure you aren't leaking revenue or under-reporting earnings.",
      evidence: {
        row_count: 1,
        scanned_rows: scopedRows.length || 1,
        from_date: fromDate,
        to_date: toDate,
        provenance: ["get_track_insights_list_v1"],
        system_confidence: "high" as const,
      },
      kpis: [
        { label: "Opportunity Score", value: String(track.opportunity_score) },
        { label: "Quality Flag", value: track.quality_flag || "unknown" },
        { label: "Critical Tasks", value: String(track.open_critical_task_count || 0) },
      ],
      visual: {
        type: "table" as const,
        title: "Track Data Quality Risk",
        columns: ["track_title", "opportunity_score", "quality_flag", "failed_line_count", "open_critical_task_count"],
        rows: [{
          track_title: track.track_title,
          opportunity_score: track.opportunity_score,
          quality_flag: track.quality_flag,
          failed_line_count: track.failed_line_count,
          open_critical_task_count: track.open_critical_task_count,
        }],
      },
      actions: [
        { label: "Open Track Insights", href: `/insights/${encodeURIComponent(track.track_key)}?from=${fromDate}&to=${toDate}&track_key=${encodeURIComponent(track.track_key)}`, kind: "primary" as const },
        { label: "Open Transactions", href: `/transactions?track_key=${encodeURIComponent(track.track_key)}`, kind: "secondary" as const },
        { label: "Open Reviews", href: "/review-queue", kind: "ghost" as const },
      ],
      follow_up_questions: [
        "Which territories are driving this risk?",
        "Show platform breakdown for this track.",
        "How can I resolve the open critical tasks?",
      ],
      diagnostics: {
        intent: "track_quality_fallback",
        confidence: "high",
        used_fields: ["opportunity_score", "quality_flag", "failed_line_count", "open_critical_task_count"],
        missing_fields: [],
        strict_mode: true,
        fallback_mode: "router_deterministic_track_intent",
      },
    };
  }

  if (asksRevenuePerformance || (!asksTerritory && !asksPlatform)) {
    return {
      conversation_id: conversationId ?? crypto.randomUUID(),
      resolved_mode: "track" as const,
      resolved_entities: resolvedEntities,
      answer_title: "Track Performance Snapshot",
      executive_answer: `"${track.track_title}" by ${track.artist_name} generated ${compactMoney(metricValue)} in ${metricLabel.toLowerCase()} within the selected period.`,
      why_this_matters: "Monitoring performance at the track level allows for precise promotion adjustments and accurate royalty forecasting.",
      evidence: {
        row_count: 1,
        scanned_rows: scopedRows.length || 1,
        from_date: fromDate,
        to_date: toDate,
        provenance: ["get_track_insights_list_v1"],
        system_confidence: "high" as const,
      },
      kpis: [
        { label: metricLabel, value: compactMoney(metricValue) },
        { label: "Quantity", value: Math.round(track.quantity || 0).toLocaleString() },
        { label: "Opportunity", value: String(track.opportunity_score) },
      ],
      visual: {
        type: "table" as const,
        title: "Track Key Metrics",
        columns: ["track_title", "net_revenue", "gross_revenue", "quantity", "top_territory", "top_platform"],
        rows: [{
          track_title: track.track_title,
          net_revenue: Number((track.net_revenue || 0).toFixed(2)),
          gross_revenue: Number((track.gross_revenue || 0).toFixed(2)),
          quantity: Number((track.quantity || 0).toFixed(2)),
          top_territory: track.top_territory || "Unknown",
          top_platform: track.top_platform || "Unknown",
        }],
      },
      actions: [
        { label: "Open Track Insights", href: `/insights/${encodeURIComponent(track.track_key)}?from=${fromDate}&to=${toDate}&track_key=${encodeURIComponent(track.track_key)}`, kind: "primary" as const },
        { label: "Open Transactions", href: `/transactions?track_key=${encodeURIComponent(track.track_key)}`, kind: "secondary" as const },
        { label: "Open Reviews", href: "/review-queue", kind: "ghost" as const },
      ],
      follow_up_questions: [
        "Which territory is strongest for this track?",
        "Which platform drives the most revenue?",
        "Is there any data-risk for this track?",
      ],
      diagnostics: {
        intent: "track_revenue_fallback",
        confidence: "high",
        used_fields: ["net_revenue", "gross_revenue", "quantity", "top_territory", "top_platform"],
        missing_fields: [],
        strict_mode: true,
        fallback_mode: "router_deterministic_track_intent",
      },
    };
  }

  if (asksTerritory) {
    return {
      conversation_id: conversationId ?? crypto.randomUUID(),
      resolved_mode: "track" as const,
      resolved_entities: resolvedEntities,
      answer_title: "Top Territory",
      executive_answer: `${track.top_territory || "Unknown"} is the strongest territory for this track in the selected range.`,
      why_this_matters: "Use top-performing territories to focus marketing and audience expansion where traction is already highest.",
      evidence: {
        row_count: 1,
        scanned_rows: scopedRows.length || 1,
        from_date: fromDate,
        to_date: toDate,
        provenance: ["get_track_insights_list_v1"],
        system_confidence: "high" as const,
      },
      kpis: [
        { label: metricLabel, value: compactMoney(metricValue) },
        { label: "Units", value: Math.round(track.quantity || 0).toLocaleString() },
        { label: "Top territory", value: track.top_territory || "Unknown" },
      ],
      visual: {
        type: "table" as const,
        title: "Track Territory Snapshot",
        columns: ["track_title", "artist_name", "top_territory", "net_revenue", "gross_revenue", "quantity"],
        rows: [{
          track_title: track.track_title,
          artist_name: track.artist_name,
          top_territory: track.top_territory || "Unknown",
          net_revenue: Number((track.net_revenue || 0).toFixed(2)),
          gross_revenue: Number((track.gross_revenue || 0).toFixed(2)),
          quantity: Number((track.quantity || 0).toFixed(2)),
        }],
      },
      actions: [
        { label: "Open Track Insights", href: `/insights/${encodeURIComponent(track.track_key)}?from=${fromDate}&to=${toDate}&track_key=${encodeURIComponent(track.track_key)}`, kind: "primary" as const },
        { label: "Open Transactions", href: `/transactions?track_key=${encodeURIComponent(track.track_key)}`, kind: "secondary" as const },
        { label: "Open Reviews", href: "/review-queue", kind: "ghost" as const },
      ],
      follow_up_questions: [
        "Which platform is strongest for this track?",
        "How does this territory compare month over month?",
        "Where is this track underperforming by territory?",
      ],
      diagnostics: {
        intent: "track_territory_fallback",
        confidence: "high",
        used_fields: ["top_territory", "net_revenue", "gross_revenue", "quantity"],
        missing_fields: [],
        strict_mode: true,
        fallback_mode: "router_deterministic_track_intent",
      },
    };
  }

  if (asksPlatform) {
    return {
      conversation_id: conversationId ?? crypto.randomUUID(),
      resolved_mode: "track" as const,
      resolved_entities: resolvedEntities,
      answer_title: "Top Platform",
      executive_answer: `${track.top_platform || "Unknown"} is the strongest platform for this track in the selected range.`,
      why_this_matters: "Prioritize promotion and negotiation where platform demand is already strongest.",
      evidence: {
        row_count: 1,
        scanned_rows: scopedRows.length || 1,
        from_date: fromDate,
        to_date: toDate,
        provenance: ["get_track_insights_list_v1"],
        system_confidence: "high" as const,
      },
      kpis: [
        { label: metricLabel, value: compactMoney(metricValue) },
        { label: "Units", value: Math.round(track.quantity || 0).toLocaleString() },
        { label: "Top platform", value: track.top_platform || "Unknown" },
      ],
      visual: {
        type: "table" as const,
        title: "Track Platform Snapshot",
        columns: ["track_title", "artist_name", "top_platform", "net_revenue", "gross_revenue", "quantity"],
        rows: [{
          track_title: track.track_title,
          artist_name: track.artist_name,
          top_platform: track.top_platform || "Unknown",
          net_revenue: Number((track.net_revenue || 0).toFixed(2)),
          gross_revenue: Number((track.gross_revenue || 0).toFixed(2)),
          quantity: Number((track.quantity || 0).toFixed(2)),
        }],
      },
      actions: [
        { label: "Open Track Insights", href: `/insights/${encodeURIComponent(track.track_key)}?from=${fromDate}&to=${toDate}&track_key=${encodeURIComponent(track.track_key)}`, kind: "primary" as const },
        { label: "Open Transactions", href: `/transactions?track_key=${encodeURIComponent(track.track_key)}`, kind: "secondary" as const },
        { label: "Open Reviews", href: "/review-queue", kind: "ghost" as const },
      ],
      follow_up_questions: [
        "Which territory is strongest for this track?",
        "How does this platform trend month over month?",
        "Where is this track leaking value by platform?",
      ],
      diagnostics: {
        intent: "track_platform_fallback",
        confidence: "high",
        used_fields: ["top_platform", "net_revenue", "gross_revenue", "quantity"],
        missing_fields: [],
        strict_mode: true,
        fallback_mode: "router_deterministic_track_intent",
      },
    };
  }

  return buildDeterministicFallbackResponse({
    mode: "track",
    question,
    fromDate,
    toDate,
    rows,
    scopedRows,
    resolvedEntities,
    conversationId,
  });
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
    let mode = detectMode(question, entityContext);
    const hasTrackContext = isNonEmptyString(entityContext.track_key);
    const hasArtistContext = isNonEmptyString(entityContext.artist_key) || isNonEmptyString(entityContext.artist_name);
    if ((mode === "artist" && !hasArtistContext) || (mode === "track" && !hasTrackContext)) {
      mode = "workspace-general";
    }

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

      if (isTrackSnapshotQuestion(question)) {
        const snapshotDetail = await fetchTrackSnapshotDetail(userClient, entityContext.track_key, fromDate, toDate);
        if (snapshotDetail?.summary) {
          return jsonResponse(
            buildTrackSnapshotSummaryResponse({
              detail: snapshotDetail,
              row: track,
              fromDate,
              toDate,
              resolvedEntities,
              conversationId: body.conversation_id,
            }),
          );
        }
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
        "insights-track-chat",
        { body: sendTurnPayload },
      );

      if (!sendTurnError) {
        assistantPayload = (sendTurnData ?? {}) as TrackAssistantTurnResponse;
      } else {
        const { data: planData, error: planError } = await userClient.functions.invoke(
          "insights-track-chat",
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

        if (!planError) {
          const plan = (planData ?? {}) as TrackNaturalChatPlanResponse;
          if (isNonEmptyString(plan.plan_id) && isNonEmptyString(plan.sql_preview) && isNonEmptyString(plan.execution_token)) {
            const { data: runData, error: runError } = await userClient.functions.invoke(
              "insights-track-chat",
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
            if (!runError) assistantPayload = (runData ?? {}) as TrackAssistantTurnResponse;
          }
        }
      }

      if (!assistantPayload || !isNonEmptyString(assistantPayload.answer_text)) {
        return jsonResponse(buildDeterministicTrackFallback({
          question,
          fromDate,
          toDate,
          rows,
          scopedRows,
          resolvedEntities,
          conversationId: body.conversation_id,
        }));
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

    if (mode === "workspace-general") {
      scopedRows = rows;
      const q = question.toLowerCase();
      const artistRollup = buildWorkspaceArtistRollup(rows);
      const asksArtistLeaderboard =
        /\b(top|highest|best|most)\b.*\b(artist|artiste)s?\b/.test(q) &&
        /\b(revenue|money|earning|made|royalt|gross|net)\b/.test(q);
      const artistNeedle = parseArtistNeedle(question);
      const asksArtistRevenue = Boolean(artistNeedle) && isArtistRevenueQuestion(question);

      if (asksArtistLeaderboard && artistRollup.length > 0) {
        const metric = /\bgross\b/.test(q) ? "gross_revenue" : "net_revenue";
        const topN = topNFromQuestion(question, 5);
        const ranked = [...artistRollup]
          .sort((a, b) => (b[metric] || 0) - (a[metric] || 0))
          .slice(0, topN);
        const top = ranked[0];
        return jsonResponse({
          conversation_id: body.conversation_id ?? crypto.randomUUID(),
          resolved_mode: "workspace-general",
          resolved_entities: resolvedEntities,
          answer_title: `Top ${ranked.length} Artists by ${metric === "gross_revenue" ? "Gross" : "Net"} Revenue`,
          executive_answer: top
            ? `${top.artist_name} leads with ${compactMoney(top[metric])} (${metric === "gross_revenue" ? "gross" : "net"} revenue) in the selected range.`
            : "No artist rows were found for this range.",
          why_this_matters: "Use this ranking to prioritize budget, release support, and marketing on the artists driving the biggest return.",
          evidence: {
            row_count: ranked.length,
            scanned_rows: artistRollup.length,
            from_date: fromDate,
            to_date: toDate,
            provenance: ["get_track_insights_list_v1"],
            system_confidence: ranked.length > 0 ? "high" : "low",
          },
          kpis: [
            { label: "Artists in scope", value: artistRollup.length.toLocaleString() },
            { label: "Rows returned", value: ranked.length.toLocaleString() },
            { label: "Metric", value: metric === "gross_revenue" ? "Gross revenue" : "Net revenue" },
          ],
          visual: {
            type: "table",
            title: "Artist Revenue Leaderboard",
            columns: ["artist_name", "gross_revenue", "net_revenue", "track_count"],
            rows: ranked.map((r) => ({
              artist_name: r.artist_name,
              gross_revenue: Number(r.gross_revenue.toFixed(2)),
              net_revenue: Number(r.net_revenue.toFixed(2)),
              track_count: r.track_count,
            })),
          },
          actions: [
            { label: "Open Transactions", href: "/transactions", kind: "primary" },
            { label: "Open Reviews", href: "/review-queue", kind: "secondary" },
            { label: "Open Statements", href: "/reports", kind: "ghost" },
          ],
          follow_up_questions: [
            "Show this leaderboard by territory contribution.",
            "Which of these artists has the biggest data-risk exposure?",
            "Compare these artists month over month.",
          ],
          diagnostics: {
            intent: "workspace_artist_leaderboard",
            confidence: "high",
            used_fields: ["artist_name", metric, "track_key"],
            missing_fields: [],
            strict_mode: true,
            resolver: "router_deterministic_workspace_artist_rollup",
          },
        });
      }

      if (asksArtistRevenue && artistNeedle && artistRollup.length > 0) {
        const metric = /\bgross\b/.test(q) ? "gross_revenue" : /\bnet\b/.test(q) ? "net_revenue" : "net_revenue";
        const needle = artistNeedle.toLowerCase();
        const matches = artistRollup
          .filter((r) => r.artist_name.toLowerCase().includes(needle))
          .sort((a, b) => (b[metric] || 0) - (a[metric] || 0))
          .slice(0, 5);
        if (matches.length > 0) {
          const primary = matches[0];
          const primaryLabel = matches.length === 1 ? primary.artist_name : `${matches.length} artists matched "${artistNeedle}"`;
          return jsonResponse({
            conversation_id: body.conversation_id ?? crypto.randomUUID(),
            resolved_mode: "workspace-general",
            resolved_entities: resolvedEntities,
            answer_title: `${primaryLabel} Revenue`,
            executive_answer: matches.length === 1
              ? `${primary.artist_name} ${metric === "gross_revenue" ? "gross" : "net"} revenue is ${compactMoney(primary[metric])} in the selected range.`
              : `Found ${matches.length} artist matches for "${artistNeedle}". Highest ${metric === "gross_revenue" ? "gross" : "net"} revenue is ${compactMoney(primary[metric])} (${primary.artist_name}).`,
            why_this_matters: "This isolates artist-level performance from workspace totals so you can make accurate catalog decisions.",
            evidence: {
              row_count: matches.length,
              scanned_rows: artistRollup.length,
              from_date: fromDate,
              to_date: toDate,
              provenance: ["get_track_insights_list_v1"],
              system_confidence: "high",
            },
            kpis: [
              { label: "Search needle", value: artistNeedle },
              { label: "Matches", value: matches.length.toLocaleString() },
              { label: "Primary metric", value: metric === "gross_revenue" ? "Gross revenue" : "Net revenue" },
            ],
            visual: {
              type: "table",
              title: "Matched Artists",
              columns: ["artist_name", "gross_revenue", "net_revenue", "track_count"],
              rows: matches.map((r) => ({
                artist_name: r.artist_name,
                gross_revenue: Number(r.gross_revenue.toFixed(2)),
                net_revenue: Number(r.net_revenue.toFixed(2)),
                track_count: r.track_count,
              })),
            },
            actions: [
              { label: "Open Transactions", href: `/transactions?q=${encodeURIComponent(artistNeedle)}`, kind: "primary" },
              { label: "Open Reviews", href: "/review-queue", kind: "secondary" },
              { label: "Open Statements", href: "/reports", kind: "ghost" },
            ],
            follow_up_questions: [
              "Show this artist result by territory.",
              "Show this artist by platform contribution.",
              "Compare this artist to the next closest match.",
            ],
            diagnostics: {
              intent: "workspace_artist_revenue_lookup",
              confidence: "high",
              used_fields: ["artist_name", metric, "track_key"],
              missing_fields: [],
              strict_mode: true,
              resolver: "router_deterministic_workspace_artist_lookup",
            },
          });
        }
      }

      const { data: sendTurnData, error: sendTurnError } = await userClient.functions.invoke(
        "insights-workspace-chat",
        {
          body: {
            action: "send_turn",
            from_date: fromDate,
            to_date: toDate,
            question,
            conversation_id: body.conversation_id,
          },
        },
      );

      if (sendTurnError) {
        return jsonResponse(buildDeterministicFallbackResponse({
          mode: "workspace-general",
          question,
          fromDate,
          toDate,
          rows,
          scopedRows,
          resolvedEntities,
          conversationId: body.conversation_id,
        }));
      }

      const assistantPayload = (sendTurnData ?? {}) as TrackAssistantTurnResponse;
      if (!assistantPayload || !isNonEmptyString(assistantPayload.answer_text)) {
        return jsonResponse(buildDeterministicFallbackResponse({
          mode: "workspace-general",
          question,
          fromDate,
          toDate,
          rows,
          scopedRows,
          resolvedEntities,
          conversationId: body.conversation_id,
        }));
      }

      const rowCount = Number(assistantPayload.evidence?.row_count ?? 0);
      const kpis = normalizeAssistantKpis(assistantPayload.kpis);
      const followUps = normalizeAssistantFollowUps(assistantPayload.follow_up_questions);
      const visual = toAiVisual(assistantPayload);

      return jsonResponse({
        conversation_id: assistantPayload.conversation_id ?? body.conversation_id ?? crypto.randomUUID(),
        resolved_mode: "workspace-general",
        resolved_entities: resolvedEntities,
        answer_title:
          (isNonEmptyString(assistantPayload.answer_title) && assistantPayload.answer_title) ||
          "Workspace AI answer",
        executive_answer: assistantPayload.answer_text,
        why_this_matters:
          (isNonEmptyString(assistantPayload.why_this_matters) && assistantPayload.why_this_matters) ||
          (isNonEmptyString(assistantPayload.answer_title) ? assistantPayload.answer_title : "Workspace-level reviewed evidence in scope."),
        evidence: {
          row_count: rowCount,
          scanned_rows: rowCount,
          from_date: assistantPayload.evidence?.from_date ?? fromDate,
          to_date: assistantPayload.evidence?.to_date ?? toDate,
          provenance: Array.isArray(assistantPayload.evidence?.provenance) ? assistantPayload.evidence?.provenance : ["run_workspace_chat_sql_v1"],
          system_confidence: rowCount > 0 ? "high" : "low",
        },
        kpis,
        visual,
        actions: [
          { label: "Open Transactions", href: "/transactions", kind: "primary" },
          { label: "Open Reviews", href: "/review-queue", kind: "secondary" },
          { label: "Open Statements", href: "/reports", kind: "ghost" },
        ],
        follow_up_questions:
          followUps.length > 0
            ? followUps
            : [
              "Which artists should we prioritize this week?",
              "Where are the biggest quality blockers across the workspace?",
              "Which tracks combine high opportunity with high risk?",
            ],
        diagnostics: assistantPayload.diagnostics ?? undefined,
      });
    }

    if (mode === "track") {
      return jsonResponse(buildDeterministicTrackFallback({
        question,
        fromDate,
        toDate,
        rows,
        scopedRows,
        resolvedEntities,
        conversationId: body.conversation_id,
      }));
    }

    return jsonResponse(buildDeterministicFallbackResponse({
      mode,
      question,
      fromDate,
      toDate,
      rows,
      scopedRows,
      resolvedEntities,
      conversationId: body.conversation_id,
    }));
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error." }, 500);
  }
});
