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
  quality_outcome?: "pass" | "clarify" | "constrained";
  resolved_scope?: Record<string, unknown>;
  plan_trace?: Record<string, unknown>;
  claims?: Array<Record<string, unknown>>;
  citations?: Array<Record<string, unknown>>;
  answer_blocks?: Array<Record<string, unknown>>;
  render_hints?: Record<string, unknown>;
  evidence_map?: Record<string, unknown>;
  unknowns?: string[];
  clarification?: {
    question?: string;
    reason?: string;
    options?: string[];
  };
  diagnostics?: {
    intent?: string;
    confidence?: "high" | "medium" | "low" | string;
    used_fields?: string[];
    missing_fields?: string[];
    strict_mode?: boolean;
  };
};

const RUNTIME_PATCH = "router-hotfix-2026-03-12-0228z";

type TrackNaturalChatPlanResponse = {
  plan_id?: string;
  sql_preview?: string;
  execution_token?: string;
};

type AdaptivePersona =
  | "publisher"
  | "marketer"
  | "tour_manager"
  | "label_head"
  | "executive_decision_maker";

type AdaptiveAnswerResponse = {
  conversation_id: string;
  resolved_mode: AiInsightsMode;
  resolved_entities: EntityContext;
  answer_title?: string;
  executive_answer: string;
  why_this_matters: string;
  evidence: {
    row_count: number;
    scanned_rows: number;
    from_date: string;
    to_date: string;
    provenance: string[];
    system_confidence: "high" | "medium" | "low";
  };
  actions: Array<{ label: string; href: string; kind?: "primary" | "secondary" | "ghost" | string }>;
  follow_up_questions: string[];
  visual: {
    type: "bar" | "line" | "table" | "none";
    title?: string;
    x?: string;
    y?: string[];
    rows?: Array<Record<string, string | number | null>>;
    columns?: string[];
  };
  kpis: Array<{ label: string; value: string }>;
  recommendations?: Array<Record<string, unknown>>;
  external_context?: {
    summary?: string;
    citations?: Array<Record<string, unknown>>;
  };
  diagnostics?: Record<string, unknown>;
  [key: string]: unknown;
};

type DecisionFrame = {
  objective: "allocation" | "growth" | "diagnostic" | "risk_control" | "exploration";
  decision_type: "strategy" | "ranking" | "comparison" | "forecast" | "investigation";
  horizon: "short_term" | "annual" | "multi_year" | "unspecified";
  entity_scope: "track" | "artist" | "catalog" | "workspace";
  persona: AdaptivePersona;
  asks_external_context: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAdaptiveCandidate(body: unknown): body is AdaptiveAnswerResponse {
  if (!isRecord(body)) return false;
  if (Array.isArray((body as Record<string, unknown>).answer_blocks)) return false;
  return (
    typeof body.conversation_id === "string" &&
    typeof body.executive_answer === "string" &&
    isRecord(body.evidence) &&
    Array.isArray(body.actions) &&
    Array.isArray(body.follow_up_questions) &&
    isRecord(body.visual) &&
    Array.isArray(body.kpis)
  );
}

function detectPersonaFromText(text: string): AdaptivePersona {
  const q = text.toLowerCase();
  if (/\b(tour|touring|venue|city|route|routing|booking|festival|concert|live show|booking dates?)\b/.test(q)) return "tour_manager";
  if (/\b(campaign|audience|creative|channel|content|marketing|acquisition)\b/.test(q)) return "marketer";
  if (/\b(catalog|portfolio|signing|release strategy|a&r|label)\b/.test(q)) return "label_head";
  if (/\b(publish|rights|sync|royalty leak|leakage|cmo)\b/.test(q)) return "publisher";
  return "executive_decision_maker";
}

function detectIntentFromBody(body: AdaptiveAnswerResponse): string {
  const diagIntent = isRecord(body.diagnostics) && typeof body.diagnostics.intent === "string"
    ? body.diagnostics.intent
    : null;
  if (diagIntent) return diagIntent;
  const text = `${body.answer_title ?? ""} ${body.executive_answer} ${body.why_this_matters}`.toLowerCase();
  if (/\b(tour|venue|city|market entry|routing)\b/.test(text)) return "touring_live";
  if (/\b(campaign|audience|channel|activation)\b/.test(text)) return "audience_marketing";
  if (/\b(rights|publisher|leakage|risk|compliance)\b/.test(text)) return "rights_revenue_risk";
  if (/\b(catalog|portfolio|allocation|top tracks)\b/.test(text)) return "catalog_strategy";
  if (/\b(compare|vs|benchmark|peer)\b/.test(text)) return "competitive_market_context";
  return "open_exploratory";
}

function isTouringQuestion(question: string): boolean {
  return /\b(?:tour|touring|live\s+show|live\s+shows|concert|venue|venues|city|cities|routing|route|booking|booking\s+dates?|tour\s+dates?)\b/.test(question.toLowerCase());
}

type TourTerritoryAggregate = {
  territory: string;
  gross: number;
  net: number;
  qty: number;
  score: number;
};

function rankTourTerritories(rows: Array<Record<string, unknown>>): TourTerritoryAggregate[] {
  const agg = new Map<string, { territory: string; gross: number; net: number; qty: number }>();
  for (const row of rows) {
    const territory = String(row.territory ?? "").trim();
    if (!territory || isLikelyUnknown(territory)) continue;
    const gross = toNum(row.gross_revenue) ?? 0;
    const net = toNum(row.net_revenue) ?? 0;
    const qty = toNum(row.quantity) ?? toNum(row.performance_count) ?? 0;
    const current = agg.get(territory) ?? { territory, gross: 0, net: 0, qty: 0 };
    current.gross += gross;
    current.net += net;
    current.qty += qty;
    agg.set(territory, current);
  }
  const values = Array.from(agg.values());
  if (values.length === 0) return [];

  const grossRank = [...values].sort((a, b) => b.gross - a.gross).map((v) => v.territory);
  const netRank = [...values].sort((a, b) => b.net - a.net).map((v) => v.territory);
  const qtyRank = [...values].sort((a, b) => b.qty - a.qty).map((v) => v.territory);
  const scoreByTerritory = new Map<string, number>();
  const addRankScore = (ranked: string[], weight: number) => {
    ranked.forEach((territory, idx) => {
      const points = Math.max(0, ranked.length - idx) * weight;
      scoreByTerritory.set(territory, (scoreByTerritory.get(territory) ?? 0) + points);
    });
  };
  addRankScore(grossRank, 1.0);
  addRankScore(netRank, 1.5);
  addRankScore(qtyRank, 0.75);

  const totalGross = values.reduce((sum, t) => sum + t.gross, 0);
  const totalNet = values.reduce((sum, t) => sum + t.net, 0);
  return values
    .map((v) => {
      const grossShare = totalGross > 0 ? v.gross / totalGross : 0;
      const netShare = totalNet > 0 ? v.net / totalNet : 0;
      const score = (scoreByTerritory.get(v.territory) ?? 0) + (grossShare * 10) + (netShare * 8);
      return { ...v, score };
    })
    .sort((a, b) => b.score - a.score);
}

function buildTourDecisionBrief(visual: AdaptiveAnswerResponse["visual"]): { executive: string; why: string; kpis: Array<{ label: string; value: string }> } | null {
  const rows = Array.isArray(visual.rows) ? visual.rows : [];
  if (rows.length === 0) return null;
  const ranked = rankTourTerritories(rows as Array<Record<string, unknown>>);
  if (ranked.length === 0) return null;
  const top3 = ranked.slice(0, 3);
  const totalGross = ranked.reduce((sum, t) => sum + t.gross, 0);
  const top = top3[0];
  const share = totalGross > 0 ? (top.gross / totalGross) * 100 : null;
  const executive = `Priority touring territories: ${top3.map((t) => t.territory).join(", ")}. ${top.territory} leads the current monetization signal${share !== null ? ` at ${share.toFixed(1)}% share of observed gross` : ""}.`;
  const why = "Before booking dates, validate city-level demand concentration, venue hold availability, competing-events window, and pricing-band fit in each priority territory.";
  const kpis = [
    { label: "Priority 1", value: top.territory },
    { label: "Priority 2", value: top3[1]?.territory ?? "n/a" },
    { label: "Priority 3", value: top3[2]?.territory ?? "n/a" },
    { label: "Top territory gross", value: compactMoney(top.gross) },
  ];
  return { executive, why, kpis };
}

function buildDecisionFrame(
  question: string,
  mode: AiInsightsMode,
  context: EntityContext,
  persona: AdaptivePersona,
): DecisionFrame {
  const q = question.toLowerCase();
  const objective: DecisionFrame["objective"] =
    /\bfocus|allocate|budget|priorit|invest|double down\b/.test(q)
      ? "allocation"
      : /\bgrow|scale|increase|boost\b/.test(q)
        ? "growth"
        : /\brisk|leak|uncertain|confidence|quality\b/.test(q)
          ? "risk_control"
          : /\bwhy|what happened|driver|root cause|diagnos\b/.test(q)
            ? "diagnostic"
            : "exploration";
  const decision_type: DecisionFrame["decision_type"] =
    /\btop|highest|best|most|rank\b/.test(q)
      ? "ranking"
      : /\bcompare|vs|versus|against\b/.test(q)
        ? "comparison"
        : /\bforecast|scenario|predict|outlook\b/.test(q)
          ? "forecast"
          : /\binvestigate|deep dive|drill\b/.test(q)
            ? "investigation"
            : "strategy";
  const horizon: DecisionFrame["horizon"] =
    /\b2026|2027|year\b/.test(q)
      ? "annual"
      : /\bquarter|month|30 days|90 days|next 2 weeks\b/.test(q)
        ? "short_term"
        : /\b3 years|5 years|long term|multi-year\b/.test(q)
          ? "multi_year"
          : "unspecified";
  const entity_scope: DecisionFrame["entity_scope"] =
    context.track_key || mode === "track"
      ? "track"
      : context.artist_key || context.artist_name || mode === "artist"
        ? "artist"
        : /\bcatalog|catalogue|portfolio\b/.test(q)
          ? "catalog"
          : "workspace";
  const asks_external_context = /\btour|venue|city|playlist|editorial|campaign|market trend|audience\b/.test(q);

  return { objective, decision_type, horizon, entity_scope, persona, asks_external_context };
}

function makeClaimId(seed: string, idx: number): string {
  let h = 0;
  const input = `${seed}:${idx}`;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return `claim_${Math.abs(h)}`;
}

function buildAdaptiveBlocks(body: AdaptiveAnswerResponse): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  const confidence = body.evidence?.system_confidence ?? "low";
  const hasVisualRows = Array.isArray(body.visual?.rows) && body.visual.rows.length > 0;

  blocks.push({
    id: "direct-answer",
    type: "direct_answer",
    priority: 1,
    source: "workspace_data",
    confidence,
    payload: {
      title: body.answer_title ?? "AI answer",
      text: body.executive_answer,
    },
  });

  if (isNonEmptyString(body.why_this_matters)) {
    blocks.push({
      id: "deep-summary",
      type: "deep_summary",
      priority: 2,
      source: "workspace_data",
      confidence,
      payload: {
        text: body.why_this_matters,
      },
    });
  }

  if (isNonEmptyString(body.external_context?.summary)) {
    blocks.push({
      id: "external-context",
      type: "deep_summary",
      priority: 3,
      source: "external",
      confidence,
      payload: {
        text: body.external_context?.summary,
      },
    });
  }

  if (body.kpis.length > 0) {
    blocks.push({
      id: "kpi-strip",
      type: "kpi_strip",
      priority: 3,
      source: "workspace_data",
      confidence,
      payload: { items: body.kpis.slice(0, 6) },
    });
  }

  if (body.visual.type === "table" && hasVisualRows) {
    blocks.push({
      id: "table-main",
      type: "table",
      priority: 4,
      source: "workspace_data",
      confidence,
      title: body.visual.title ?? "Evidence Table",
      payload: {
        columns: body.visual.columns ?? [],
        rows: body.visual.rows ?? [],
      },
    });
  }

  if (body.visual.type === "bar" && hasVisualRows) {
    blocks.push({
      id: "bar-main",
      type: "bar_chart",
      priority: 4,
      source: "workspace_data",
      confidence,
      title: body.visual.title ?? "Evidence Chart",
      payload: {
        x: body.visual.x ?? "",
        y: body.visual.y ?? [],
        rows: body.visual.rows ?? [],
      },
    });
  }

  if (body.visual.type === "line" && hasVisualRows) {
    blocks.push({
      id: "line-main",
      type: "line_chart",
      priority: 4,
      source: "workspace_data",
      confidence,
      title: body.visual.title ?? "Trend",
      payload: {
        x: body.visual.x ?? "",
        y: body.visual.y ?? [],
        rows: body.visual.rows ?? [],
      },
    });
    blocks.push({
      id: "past-pattern",
      type: "past_pattern_inference",
      priority: 6,
      source: "workspace_data",
      confidence,
      payload: {
        text: "Historical pattern suggests this trajectory should be monitored for sustained movement over the next 4-8 weeks.",
      },
    });
  }

  const recommendationItems = Array.isArray(body.recommendations) ? body.recommendations : [];
  if (recommendationItems.length > 0) {
    blocks.push({
      id: "recommendations",
      type: "recommendations",
      priority: 5,
      source: "workspace_data",
      confidence,
      payload: { items: recommendationItems.slice(0, 4) },
    });
  }

  const citationItems = [
    ...(Array.isArray(body.citations) ? body.citations : []),
    ...(Array.isArray(body.external_context?.citations) ? body.external_context.citations : []),
  ];
  if (citationItems.length > 0) {
    blocks.push({
      id: "citations",
      type: "citations",
      priority: 9,
      source: "external",
      confidence,
      payload: { items: citationItems.slice(0, 8) },
    });
  }

  const resolveMissingFieldsForRisk = (): string[] => {
    const diagnostics = isRecord(body.diagnostics) ? body.diagnostics : {};
    const intentFromDiagnostics = typeof diagnostics.intent === "string" ? diagnostics.intent.toLowerCase() : "";
    const intent = intentFromDiagnostics || detectIntentFromBody(body).toLowerCase();
    const requiredRaw = Array.isArray(diagnostics.required_columns)
      ? diagnostics.required_columns.filter((v): v is string => typeof v === "string")
      : [];
    const chosenRaw = Array.isArray(diagnostics.chosen_columns)
      ? diagnostics.chosen_columns.filter((v): v is string => typeof v === "string")
      : [];
    const declaredMissingRaw = Array.isArray(diagnostics.missing_fields)
      ? diagnostics.missing_fields.filter((v): v is string => typeof v === "string")
      : [];

    const present = new Set<string>([
      ...inferVisualColumns(body.visual),
      ...chosenRaw.map((c) => toCanonicalKey(c)).filter((c) => c.length > 0),
    ]);

    const inferCriticalFields = (): string[] => {
      const visualCols = new Set(inferVisualColumns(body.visual));
      const includesAny = (keys: string[]) => keys.some((k) => visualCols.has(toCanonicalKey(k)));
      const fromIntent = (() => {
        if (/(rights|quality_risk|gap_analysis|leakage|attribution)/.test(intent)) {
          return ["mapping_confidence", "validation_status", "rights_type", "gross_revenue", "net_revenue"];
        }
        if (/(tour|territory_analysis|touring_live)/.test(intent)) {
          return ["territory", "gross_revenue", "net_revenue"];
        }
        if (/(platform|concentration|dsp)/.test(intent)) {
          return ["platform", "net_revenue", "gross_revenue"];
        }
        if (/(period_comparison|trend|compare)/.test(intent)) {
          return ["period_bucket", "event_date", "week_start", "month_start", "quarter_start", "net_revenue", "gross_revenue"];
        }
        return ["track_title", "net_revenue", "gross_revenue"];
      })();
      if (includesAny(fromIntent)) return fromIntent;
      return fromIntent.slice(0, 3);
    };

    const criticalSet = new Set(
      inferCriticalFields()
        .map((f) => toCanonicalKey(f))
        .filter((f) => f.length > 0),
    );
    const toCriticalMissing = (fields: string[]): string[] =>
      fields
        .filter((field) => !field.startsWith("__"))
        .map((field) => ({ original: field, canonical: toCanonicalKey(field) }))
        .filter((entry) => entry.canonical.length > 0)
        .filter((entry) => criticalSet.size === 0 || criticalSet.has(entry.canonical))
        .filter((entry) => !present.has(entry.canonical))
        .map((entry) => entry.original);

    const criticalFields = inferCriticalFields().map((f) => toCanonicalKey(f)).filter((f) => f.length > 0);
    if (requiredRaw.length > 0) {
      return toCriticalMissing(requiredRaw);
    }

    if (criticalFields.length === 0) return [];
    return toCriticalMissing(declaredMissingRaw);
  };

  const riskItems: string[] = [];
  if (confidence !== "high") riskItems.push("Confidence is not high; validate with broader scope before major spend decisions.");
  if (body.evidence.row_count <= 3) riskItems.push("Low row count can hide market variability.");
  const missingFields = resolveMissingFieldsForRisk();
  if (missingFields.length > 0) {
    riskItems.push(`Missing fields detected: ${missingFields.join(", ")}.`);
  }
  if (Array.isArray(body.diagnostics?.data_notes)) {
    for (const note of body.diagnostics.data_notes.slice(0, 3)) {
      if (typeof note === "string" && note.trim().length > 0) riskItems.push(note);
    }
  }
  if (Array.isArray(body.diagnostics?.anomaly_flags)) {
    for (const flag of body.diagnostics.anomaly_flags.slice(0, 3)) {
      if (typeof flag === "string" && flag.trim().length > 0) riskItems.push(flag);
    }
  }
  const uniqueRiskItems = Array.from(new Set(riskItems.map((item) => item.trim()).filter((item) => item.length > 0)));
  if (uniqueRiskItems.length > 0) {
    blocks.push({
      id: "risk-flags",
      type: "risk_flags",
      priority: 8,
      source: "workspace_data",
      confidence,
      payload: { items: uniqueRiskItems },
    });
  }

  return blocks.sort((a, b) => Number(a.priority) - Number(b.priority));
}

function withAdaptiveAnswer(body: AdaptiveAnswerResponse): AdaptiveAnswerResponse {
  const answerTextForPersona = `${body.answer_title ?? ""} ${body.executive_answer} ${body.why_this_matters}`;
  const detected_intent = detectIntentFromBody(body);
  const detected_persona = detectPersonaFromText(answerTextForPersona);
  const normalizedBody: AdaptiveAnswerResponse = (() => {
    const existing = Array.isArray(body.recommendations) ? body.recommendations : [];
    if (existing.length > 0) return body;
    const needsDecisionGuidance =
      detected_intent === "catalog_strategy" ||
      detected_intent === "touring_live" ||
      detected_intent === "audience_marketing" ||
      detected_intent === "rights_revenue_risk";
    if (!needsDecisionGuidance) return body;
    return {
      ...body,
      recommendations: [{
        action: "Choose one priority move and execute it for 14 days with explicit success thresholds.",
        rationale: body.why_this_matters,
        impact: "Transforms analysis into a testable decision path.",
        risk: "If thresholds are not defined upfront, results become non-actionable.",
      }],
    };
  })();
  const answer_blocks = buildAdaptiveBlocks(normalizedBody);
  const evidence_map: Record<string, "workspace_data" | "external"> = {};
  for (const block of answer_blocks) {
    if (typeof block.id === "string") {
      evidence_map[block.id] = block.source === "external" ? "external" : "workspace_data";
    }
  }
  const render_hints = {
    layout: "adaptive_card_stack",
    density: answer_blocks.length > 6 ? "expanded" : "compact",
    visual_preference: body.visual.type === "bar" || body.visual.type === "line"
      ? "chart"
      : body.visual.type === "table"
        ? "table"
        : "none",
    show_confidence_badges: true,
  };

  const citationBlock = answer_blocks.find((b) => b.type === "citations");
  const citations = isRecord(citationBlock?.payload) && Array.isArray(citationBlock.payload.items)
    ? (citationBlock.payload.items as Array<Record<string, unknown>>).map((item) => ({
      title: String(item.title ?? "Source"),
      source_type: String(item.source_type ?? "workspace_data"),
      claim_ids: Array.isArray(item.claim_ids) ? item.claim_ids : [],
    }))
    : [];

  const recommendationBlock = answer_blocks.find((b) => b.type === "recommendations");
  const recommendations = isRecord(recommendationBlock?.payload) && Array.isArray(recommendationBlock.payload.items)
    ? recommendationBlock.payload.items
    : [];

  const unknowns: string[] = [];
  if (body.evidence.system_confidence !== "high") unknowns.push("Confidence is below high for this answer.");
  if (body.evidence.row_count === 0) unknowns.push("No validated rows were returned for this scope.");

  return {
    ...normalizedBody,
    detected_intent,
    detected_persona,
    answer_blocks,
    render_hints,
    evidence_map,
    recommendations: recommendations as Array<Record<string, unknown>>,
    citations,
    unknowns,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  const adaptiveBody = status < 400 && isAdaptiveCandidate(body) ? withAdaptiveAnswer(body) : body;
  if (status < 400 && isRecord(adaptiveBody)) {
    adaptiveBody.runtime_patch = RUNTIME_PATCH;
  }
  return new Response(JSON.stringify(adaptiveBody), {
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

function asksForCurrentArtist(question: string): boolean {
  return /\b(this|that|current|selected)\s+(artist|artiste)\b/i.test(question);
}

function asksForCurrentTrack(question: string): boolean {
  return /\b(this|that|current|selected)\s+(track|song)\b/i.test(question);
}

function toNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[^0-9.\-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toCanonicalKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function inferVisualColumns(visual: AdaptiveAnswerResponse["visual"]): string[] {
  const declared = Array.isArray(visual.columns) ? visual.columns : [];
  const fromDeclared = declared
    .filter((col): col is string => typeof col === "string" && col.trim().length > 0)
    .map((col) => toCanonicalKey(col));
  if (fromDeclared.length > 0) return Array.from(new Set(fromDeclared));
  const rows = Array.isArray(visual.rows) ? visual.rows : [];
  const first = rows[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return [];
  return Array.from(
    new Set(
      Object.keys(first)
        .filter((key) => key.trim().length > 0)
        .map((key) => toCanonicalKey(key)),
    ),
  );
}

function isLikelyUnknown(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.length === 0 || v === "unknown" || v === "n/a" || v === "na";
}

function normalizeTerritoryValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isLikelyUnknown(trimmed)) return "Unknown";
  if (/^[A-Za-z]{2,3}$/.test(trimmed)) return trimmed.toUpperCase();
  return null;
}

function normalizePlatformValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isLikelyUnknown(trimmed)) return "Unknown";
  if (/^[A-Za-z0-9 .&+\-]{2,40}$/.test(trimmed)) return trimmed;
  return null;
}

function normalizedVisualForDecision(visual: AdaptiveAnswerResponse["visual"]): AdaptiveAnswerResponse["visual"] {
  const rows = Array.isArray(visual.rows) ? visual.rows : [];
  const columns = inferVisualColumns(visual);
  if (rows.length === 0 || columns.length === 0) return visual;
  const metric = columns.includes("net_revenue")
    ? "net_revenue"
    : columns.includes("gross_revenue")
      ? "gross_revenue"
      : null;

  const cleaned = rows.map((row) => {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      next[toCanonicalKey(key)] = value;
    }
    if ("territory" in next) {
      const normalized = normalizeTerritoryValue(next.territory);
      next.territory = normalized ?? "Unknown";
    }
    if ("platform" in next) {
      const normalized = normalizePlatformValue(next.platform);
      next.platform = normalized ?? "Unknown";
    }
    return next;
  });

  if (metric) {
    cleaned.sort((a, b) => (toNum(b[metric]) ?? 0) - (toNum(a[metric]) ?? 0));
  }
  return { ...visual, columns, rows: cleaned as Array<Record<string, string | number | null>> };
}

function computeQuestionEvidenceFit(question: string, visual: AdaptiveAnswerResponse["visual"]): { score: number; reasons: string[] } {
  const q = question.toLowerCase();
  const cols = inferVisualColumns(visual);
  const reasons: string[] = [];
  let score = 1;
  const needsTrack = /\btrack|tracks|song|songs\b/.test(q);
  const needsPlatform = /\bplatform|dsp|spotify|apple|youtube|amazon|deezer|tidal\b/.test(q);
  const needsTerritory = /\bterritory|market|country|region|tour|live|venue|city\b/.test(q);
  const needsUsageMonetization = /\bunder-?monet|usage|relative to usage|payout share|usage share\b/.test(q);
  const hasMoney = cols.includes("net_revenue") || cols.includes("gross_revenue");
  if (!hasMoney) {
    score -= 0.4;
    reasons.push("missing_revenue_metric");
  }
  if (needsTrack && !cols.includes("track_title")) {
    score -= 0.3;
    reasons.push("missing_track_dimension");
  }
  if (needsPlatform && !cols.includes("platform")) {
    score -= 0.25;
    reasons.push("missing_platform_dimension");
  }
  if (needsTerritory && !cols.includes("territory")) {
    score -= 0.25;
    reasons.push("missing_territory_dimension");
  }
  if (needsUsageMonetization) {
    const hasUsage = cols.includes("usage_share") || cols.includes("quantity");
    const hasPayout = cols.includes("payout_share") || hasMoney;
    if (!hasUsage || !hasPayout) {
      score -= 0.35;
      reasons.push("missing_usage_vs_payout_fields");
    }
  }
  return { score: Math.max(0, Math.min(1, score)), reasons };
}

function isTrendComparisonQuestion(question: string): boolean {
  const q = question.toLowerCase();
  return /\b(trend|over time|qoq|yoy|mom|growth rate|month over month|quarter over quarter|week over week|month by month|week by week|day by day|quarter by quarter|last\s+\d+\s+(?:days?|weeks?|months?|quarters?)|prior\s+\d+\s+(?:days?|weeks?|months?|quarters?)|vs\s+prior|compared\s+to\s+prior)\b/.test(q);
}

function parseRequestedTopN(question: string): number | null {
  const q = question.toLowerCase();
  const explicitTop = q.match(/\btop\s+(\d{1,3})\b/);
  if (explicitTop) {
    const n = Number(explicitTop[1]);
    if (Number.isFinite(n) && n > 0) return Math.min(50, Math.floor(n));
  }
  const highestN = q.match(/\bhighest\s+(\d{1,3})\b/);
  if (highestN) {
    const n = Number(highestN[1]);
    if (Number.isFinite(n) && n > 0) return Math.min(50, Math.floor(n));
  }
  return null;
}

function recommendationSemanticKey(action: string): string {
  const text = action.toLowerCase();
  if (/\bunknown\b.*\bplatform\b|\bplatform\b.*\bunknown\b/.test(text) && /\b(attribution|classify|audit|cleanup|close)\b/.test(text)) {
    return "platform_unknown_attribution_cleanup";
  }
  if (/\bvalidation checkpoint\b|\b14[- ]day\b|\bgo\/no-go\b|\bgo no-go\b/.test(text)) {
    return "validation_checkpoint";
  }
  if (/\bfocused experiment\b|\bpilot\b.*\btest\b|\bcontrolled test\b/.test(text)) {
    return "single_pilot_test";
  }
  if (/\bplaylist\b|\bcreator content\b|\bsync\b/.test(text)) {
    return "track_growth_activation";
  }
  if (/\bcity shortlist\b|\blive routing\b|\bvenue hold\b|\brouting\b/.test(text)) {
    return "tour_routing_validation";
  }
  return text
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an|for|to|of|and|with|before|after|next|this|that|your)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 8)
    .join(" ");
}

function buildLargestChangeStatement(question: string, visual: AdaptiveAnswerResponse["visual"]): string | null {
  if (!isTrendComparisonQuestion(question)) return null;
  const rows = Array.isArray(visual.rows) ? visual.rows : [];
  if (rows.length === 0) return null;
  const first = rows[0] as Record<string, unknown>;
  const keys = Object.keys(first).map((k) => k.toLowerCase());
  if (!keys.includes("period_bucket")) return null;

  const metricKey = keys.includes("net_revenue")
    ? "net_revenue"
    : keys.includes("gross_revenue")
      ? "gross_revenue"
      : null;
  if (!metricKey) return null;

  const entityKeys = ["platform", "territory", "track_title", "artist_name"].filter((k) => keys.includes(k));
  const bucketed = new Map<string, { entityLabel: string; last: number; prior: number }>();
  for (const rawRow of rows) {
    const row = rawRow as Record<string, unknown>;
    const bucket = String(row.period_bucket ?? "").toLowerCase();
    if (!bucket) continue;
    const metric = toNum(row[metricKey]) ?? 0;
    const entityLabel = entityKeys.length > 0
      ? entityKeys.map((k) => String(row[k] ?? "Unknown").trim() || "Unknown").join(" / ")
      : "Overall";
    const current = bucketed.get(entityLabel) ?? { entityLabel, last: 0, prior: 0 };
    if (bucket.startsWith("last_")) current.last += metric;
    if (bucket.startsWith("prior_")) current.prior += metric;
    bucketed.set(entityLabel, current);
  }
  if (bucketed.size === 0) return null;

  let winner: { entityLabel: string; delta: number; deltaPct: number | null } | null = null;
  for (const item of bucketed.values()) {
    const delta = item.last - item.prior;
    const deltaPct = item.prior > 0 ? (delta / item.prior) * 100 : null;
    if (!winner || Math.abs(delta) > Math.abs(winner.delta)) {
      winner = { entityLabel: item.entityLabel, delta, deltaPct };
    }
  }
  if (!winner) return null;

  const metricLabel = metricKey === "net_revenue" ? "net revenue" : "gross revenue";
  const direction = winner.delta >= 0 ? "up" : "down";
  const pctText = winner.deltaPct === null || !Number.isFinite(winner.deltaPct)
    ? ""
    : ` (${Math.abs(winner.deltaPct).toFixed(1)}%)`;
  return `Largest change: ${winner.entityLabel} is ${direction} by ${compactMoney(Math.abs(winner.delta))}${pctText} in ${metricLabel}.`;
}

function buildEarlyDataCaveat(params: {
  rowCount: number;
  visual: AdaptiveAnswerResponse["visual"];
  diagnostics?: Record<string, unknown>;
}): string | null {
  const { rowCount, visual, diagnostics } = params;
  const rows = Array.isArray(visual.rows) ? visual.rows : [];
  const lowRowCountHard = rowCount > 0 && rowCount <= 2;
  const lowRowCountSoft = rowCount === 3;
  const grossNetSkewRows = rows.filter((r) => {
    const row = r as Record<string, unknown>;
    const gross = toNum(row.gross_revenue);
    const net = toNum(row.net_revenue);
    if (gross === null || net === null) return false;
    if (gross < 1_000_000) return false;
    const denominator = Math.max(Math.abs(net), 0.01);
    const ratio = Math.abs(gross) / denominator;
    return ratio >= 1_000_000;
  }).length;
  const hasGrossNetSkew = grossNetSkewRows >= 2;
  const qtyValues = rows.map((r) => toNum((r as Record<string, unknown>).quantity)).filter((v): v is number => v !== null);
  const zeroQtyCount = qtyValues.filter((v) => Math.abs(v) < 0.0001).length;
  const mostlyZeroQty = qtyValues.length >= 5 && (zeroQtyCount / qtyValues.length) >= 0.8;
  const diagNotes = Array.isArray(diagnostics?.data_notes)
    ? diagnostics.data_notes.filter((n) => typeof n === "string").map((n) => String(n).toLowerCase())
    : [];
  const notesFlag = diagNotes.some((n) => n.includes("anomaly") || n.includes("currency normalization"));

  const signalCount = [lowRowCountSoft, hasGrossNetSkew, mostlyZeroQty, notesFlag].filter(Boolean).length;
  if (!(lowRowCountHard || signalCount >= 2)) return null;
  return "Data-quality caveat: this result is directionally useful, but signal reliability is limited in this scope.";
}

function isStrategyQuestionText(question: string): boolean {
  return /\b(focus|strategy|priorit|budget|no-regret|what should|next step|allocate|plan|levers?|moves?)\b/.test(question.toLowerCase());
}

function inferRecommendationFloor(question: string): number | null {
  const q = question.toLowerCase();
  const asksOrderedPlan =
    /\b(order|ordered|sequence|sequenced|roadmap|playbook|remediation order|first.*then|30[-\s]?day|60[-\s]?day|90[-\s]?day)\b/.test(q);
  if (asksOrderedPlan) return 3;

  const asksGenericActions = /\b(actions?|moves?|steps?|mitigations?|recommendations?)\b/.test(q);
  const asksPluralDecision = /\bwhat should\b/.test(q) || /\bnext quarter\b/.test(q) || /\bthis quarter\b/.test(q);
  if (asksGenericActions && asksPluralDecision) return 3;

  return null;
}

function recommendationOwner(theme: string): string {
  if (theme === "tour") return "Tour Lead";
  if (theme === "rights") return "Rights Ops Lead";
  if (theme === "platform") return "Growth Lead";
  if (theme === "track") return "Catalog Lead";
  return "Strategy Lead";
}

function recommendationSuccessMetric(theme: string): string {
  if (theme === "tour") return "City validation pass-rate and ticket velocity";
  if (theme === "rights") return "Recovered net revenue and reduced critical validation rows";
  if (theme === "platform") return "Platform ROI floor compliance and net revenue share mix";
  if (theme === "trend") return "Period-over-period net revenue delta vs baseline";
  if (theme === "track") return "Weekly conversion and net revenue lift on priority track";
  return "KPI delta vs baseline after one execution cycle";
}

function inferRecommendationTimeline(action: string, theme: string): string {
  const a = action.toLowerCase();
  if (/\bweek\s*1\b/.test(a) || /\b7-day\b/.test(a)) return "Week 1";
  if (/\bweek\s*2\b/.test(a) || /\b14-day\b/.test(a) || /\b2-week\b/.test(a)) return "Weeks 1-2";
  if (/\b30-day\b/.test(a)) return "30 days";
  if (/\bquarter\b/.test(a)) return "This quarter";
  if (theme === "tour") return "Weeks 1-4";
  if (theme === "rights") return "30 days";
  return "Next cycle";
}

function inferRecommendationOwner(action: string, theme: string): string {
  const a = action.toLowerCase();
  if (/\b(rights|mapping|attribution|validation)\b/.test(a)) return "Rights Ops Lead";
  if (/\b(venue|routing|city|tour|booking)\b/.test(a)) return "Tour Lead";
  if (/\b(platform|playlist|dsp|channel)\b/.test(a)) return "Growth Lead";
  if (/\b(track|catalog|sync|creator content)\b/.test(a)) return "Catalog Lead";
  if (/\b(threshold|checkpoint|roi|allocation|budget)\b/.test(a)) return "Strategy Lead";
  return recommendationOwner(theme);
}

function inferRecommendationSuccessMetric(action: string, theme: string): string {
  const a = action.toLowerCase();
  if (/\b(ticket|routing|venue|city)\b/.test(a)) return "Ticket velocity and city validation pass-rate";
  if (/\b(mapping|validation|rights|attribution)\b/.test(a)) return "Mapping confidence lift and critical-row reduction";
  if (/\b(platform|channel|roi|threshold)\b/.test(a)) return "Platform ROI compliance and net revenue mix";
  if (/\b(track|playlist|sync|creator)\b/.test(a)) return "Track conversion lift and weekly net revenue delta";
  if (/\b(compare|delta|period)\b/.test(a)) return "Period-over-period delta vs baseline";
  return recommendationSuccessMetric(theme);
}

function enrichRecommendationRecords(
  rows: Array<Record<string, unknown>>,
  theme: string,
): Array<Record<string, unknown>> {
  return rows.map((row, idx) => {
    const action = typeof row.action === "string" ? row.action : "";
    const timeline = typeof row.timeline === "string" && row.timeline.trim().length > 0
      ? row.timeline
      : inferRecommendationTimeline(action, theme);
    const owner = typeof row.owner === "string" && row.owner.trim().length > 0
      ? row.owner
      : inferRecommendationOwner(action, theme);
    const successMetric = typeof row.success_metric === "string" && row.success_metric.trim().length > 0
      ? row.success_metric
      : inferRecommendationSuccessMetric(action, theme);
    return {
      ...row,
      sequence: typeof row.sequence === "number" && Number.isFinite(row.sequence) ? row.sequence : idx + 1,
      timeline,
      owner,
      success_metric: successMetric,
    };
  });
}

function buildDataDrivenRecommendations(
  question: string,
  visual: AdaptiveAnswerResponse["visual"],
  whyThisMatters: string,
): Array<Record<string, unknown>> {
  const q = question.toLowerCase();
  const requestedMoves = (() => {
    const match = q.match(/\b(\d{1,2})\b(?:[\w\s-]{0,24})\b(moves?|actions?|levers?|mitigations?)\b/);
    if (!match) return null;
    const parsed = Number(match[1]);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(1, Math.min(6, Math.round(parsed)));
  })();
  const recommendationFloor = inferRecommendationFloor(question);
  const targetRecommendationCount = requestedMoves ?? recommendationFloor;
  const rows = Array.isArray(visual.rows) ? visual.rows : [];
  if (rows.length === 0) return [];

  const recs: Array<Record<string, unknown>> = [];
  const cols = inferVisualColumns(visual);
  const hasTerritory = cols.includes("territory");
  const hasPlatform = cols.includes("platform");
  const hasTrack = cols.includes("track_title");
  const hasArtist = cols.includes("artist_name");
  const hasUsageSignal = cols.includes("usage_share") || cols.includes("quantity");
  const hasPayoutSignal = cols.includes("payout_share") || cols.includes("net_revenue") || cols.includes("gross_revenue");
  const moneyKey = cols.includes("net_revenue") ? "net_revenue" : "gross_revenue";
  const topMoney = rows
    .map((r) => toNum((r as Record<string, unknown>)[moneyKey]))
    .filter((v): v is number => v !== null && v > 0);
  const totalMoney = topMoney.reduce((sum, n) => sum + n, 0);
  const topRow = rows[0] ?? {};
  const topTrack = String((topRow as Record<string, unknown>).track_title ?? "top track");
  const topPlatform = (() => {
    const firstKnown = rows.find((r) => {
      const platformValue = String((r as Record<string, unknown>).platform ?? "");
      return platformValue.trim().length > 0 && !isLikelyUnknown(platformValue);
    });
    if (firstKnown) return String((firstKnown as Record<string, unknown>).platform ?? "top platform");
    return String((topRow as Record<string, unknown>).platform ?? "top platform");
  })();
  const topTerritory = String((topRow as Record<string, unknown>).territory ?? "top territory");
  const topArtist = String((topRow as Record<string, unknown>).artist_name ?? "this artist");

  const isStrategyQuestion = /\bfocus|priorit|strategy|plan|what should|next step|2026|this year|next year|budget|no-regret|uplift|levers?\b/.test(q);
  const asksNoRegretBudget = /\b(budget|limited budget|no-regret)\b/.test(q);
  const asksTrendCompare = isTrendComparisonQuestion(question);
  const asksUplift = /\b(uplift|increase|grow|improve)\b/.test(q) && /\b(net revenue|revenue)\b/.test(q);
  const strictCountRequest = targetRecommendationCount !== null;
  const asksUnderMonetizedVsUsage = /\bunder-?monet|relative to usage|usage vs payout|usage share|payout share\b/.test(q);
  const asksRightsRisk = /\b(rights|royalty leak|leakage|payout leak|payout leakage|mapping|attribution|rights-related|validation status)\b/.test(q);
  const rightsOnlyMode = asksRightsRisk || /\b(attribution|mapping gaps|validation gaps)\b/.test(q);
  const asksMomentumBreak = /\b(momentum|broke|breakdown|break point|where momentum broke)\b/.test(q);
  const asksTouring = isTouringQuestion(question);

  const topTerritoriesForTour = hasTerritory
    ? rankTourTerritories(rows as Array<Record<string, unknown>>).slice(0, 3)
    : [];
  const periodCountForMomentum = rows.filter((r) => {
    const keys = Object.keys(r as Record<string, unknown>).map((k) => k.toLowerCase());
    return keys.includes("week_start") || keys.includes("day_start") || keys.includes("month_start") || keys.includes("quarter_start");
  }).length;
  const insufficientMomentumEvidence = asksMomentumBreak && periodCountForMomentum < 4;
  if (asksUnderMonetizedVsUsage && (!hasUsageSignal || !hasPayoutSignal)) {
    recs.push({
      action: "Pull usage-share and payout-share evidence for the same territories before making under-monetization decisions.",
      rationale: "This question needs both usage and monetization signals; current result does not include enough fields.",
      impact: "Prevents false positives when flagging markets as under-monetized.",
      risk: "Acting on revenue-only data can misallocate market development budget.",
    });
  }
  if (asksRightsRisk) {
    const hasRightsType = cols.includes("rights_type");
    const hasValidation = cols.includes("validation_status") || cols.includes("mapping_confidence");
    if (!hasRightsType || !hasValidation) {
      recs.push({
        action: "Run a rights-mapping audit first: expose rights type, mapping confidence, and validation status in the same query scope.",
        rationale: "Rights-leakage diagnosis is unreliable without rights and validation fields together.",
        impact: "Converts leakage analysis from directional to decision-grade.",
        risk: "Skipping this step can misidentify leakage root causes and waste remediation effort.",
      });
      recs.push({
        action: "Prioritize cleanup for high-gross / low-net rows where attribution or rights metadata is missing.",
        rationale: "Large gross-to-net gaps with weak metadata are the highest-probability leakage candidates.",
        impact: "Targets the highest-value recovery opportunities first.",
        risk: "If metadata is incomplete, recovered value may be overstated.",
      });
    }
  }
  if (isStrategyQuestion && !strictCountRequest && !insufficientMomentumEvidence && !rightsOnlyMode && !asksTouring) {
    if (hasTrack) {
      recs.push({
        action: `Set a 2026 primary growth bet on ${topTrack}, with explicit weekly KPIs (streams, saves, conversion, revenue).`,
        rationale: `${topTrack} is currently the strongest observed revenue driver in this scope.`,
        impact: "Creates a clear execution focus and improves budget efficiency versus broad untargeted spend.",
        risk: "If top-driver revenue is anomaly-inflated, strategy may over-concentrate; validate source and mapping first.",
      });
      recs.push({
        action: "Create a second-priority pipeline of 2-3 emerging tracks and allocate test budget to reduce concentration risk.",
        rationale: "Portfolio balance is required when one asset dominates current revenue.",
        impact: "Builds downside protection while preserving upside from the top asset.",
        risk: "Without disciplined test criteria, pipeline spend can dilute returns.",
      });
    }
    if (hasPlatform) {
      recs.push({
        action: `Build platform-specific 2026 plans: double down on ${topPlatform}, and set minimum lift targets for secondary DSPs.`,
        rationale: "Platform concentration drives where tactical optimization has highest leverage.",
        impact: "Improves channel ROI by matching creative and distribution to platform behavior.",
        risk: "Over-allocation to one DSP increases exposure to algorithm/editorial volatility.",
      });
    }
    if (hasTerritory && !isLikelyUnknown(topTerritory)) {
      recs.push({
        action: `Prioritize market development in ${topTerritory} first, then expand only to territories that clear conversion thresholds.`,
        rationale: "Territory sequencing should follow observed revenue traction.",
        impact: "Improves market expansion hit-rate and reduces premature expansion waste.",
        risk: "Territory-level signals may hide city-level execution issues.",
      });
    }
    if (hasArtist) {
      recs.push({
        action: `Run a quarterly strategy review for ${topArtist}: keep, scale, or reallocate budget based on measured contribution changes.`,
        rationale: "Strategy quality depends on continuous reallocation against real performance shifts.",
        impact: "Prevents stale plans and improves compounding returns across the year.",
        risk: "Requires strict measurement discipline and clean attribution.",
      });
    }
  }
  if (asksTrendCompare) {
    const timeKey = cols.includes("month_start")
      ? "month_start"
      : cols.includes("week_start")
        ? "week_start"
        : cols.includes("day_start")
          ? "day_start"
          : cols.includes("quarter_start")
            ? "quarter_start"
            : null;
    if (timeKey && topMoney.length >= 2) {
      const ordered = [...rows].sort((a, b) => {
        const av = String((a as Record<string, unknown>)[timeKey] ?? "");
        const bv = String((b as Record<string, unknown>)[timeKey] ?? "");
        return av.localeCompare(bv);
      });
      const latest = ordered[ordered.length - 1];
      const prev = ordered[ordered.length - 2];
      const latestVal = toNum((latest as Record<string, unknown>)[moneyKey]) ?? 0;
      const prevVal = toNum((prev as Record<string, unknown>)[moneyKey]) ?? 0;
      const deltaPct = prevVal > 0 ? ((latestVal - prevVal) / prevVal) * 100 : null;
      const boundedDeltaPct = deltaPct !== null && Number.isFinite(deltaPct) && Math.abs(deltaPct) <= 500
        ? deltaPct
        : null;
      const direction = deltaPct === null ? "changed" : deltaPct >= 0 ? "increased" : "decreased";
      recs.push({
        action: deltaPct !== null && deltaPct >= 0
          ? "Scale the top-performing channels from the latest period and lock a 2-week execution sprint."
          : "Run a recovery sprint on the weakest segment from the latest period before adding new spend.",
        rationale: boundedDeltaPct === null
          ? "Time-series evidence shows a measurable shift between recent periods."
          : `Latest period ${direction} by ${Math.abs(boundedDeltaPct).toFixed(1)}% versus prior period.`,
        impact: "Converts period-over-period signal into immediate execution priorities.",
        risk: "If attribution is unstable, short-term swings can overstate true trend.",
      });
      recs.push({
        action: "Set one hard checkpoint in 14 days: continue, rebalance, or stop based on measured delta vs baseline.",
        rationale: "Comparison questions need explicit control rules to avoid reactive budget drift.",
        impact: "Improves decision consistency and prevents overreaction to noise.",
        risk: "Without checkpoint discipline, trend-informed plans degrade into ad-hoc decisions.",
      });
    }
  }
  if (asksUplift) {
    const targetPctMatch = q.match(/\b(\d{1,3})\s*%/);
    const targetPct = targetPctMatch ? Number(targetPctMatch[1]) : null;
    const netNow = topMoney.length > 0 ? (topMoney[0] ?? 0) : 0;
    const upliftAmount = targetPct !== null ? (netNow * targetPct) / 100 : null;
    if (hasTrack) {
      recs.push({
        action: `Protect the top earner (${topTrack}) as Lever 1 and assign a weekly lift target against baseline.`,
        rationale: "The largest current contributor is the lowest-friction lever for near-term uplift.",
        impact: targetPct !== null && upliftAmount !== null
          ? `Most realistic path to ${targetPct}% uplift is scaling proven demand before expanding to weaker assets.`
          : "Most realistic near-term uplift usually starts with proven demand assets.",
        risk: "If top-asset performance is anomaly-driven, projected uplift can be overstated.",
      });
      recs.push({
        action: "Deploy Lever 2 as a controlled secondary-track test with hard pass/fail thresholds after 14 days.",
        rationale: "Secondary tests add upside while preventing over-concentration on one asset.",
        impact: "Builds an additional growth path without diluting core execution.",
        risk: "Loose thresholds convert experiments into non-actionable spend.",
      });
      recs.push({
        action: "Run Lever 3 as an attribution and payout-quality cleanup sprint on top-revenue rows.",
        rationale: "Data-quality noise can hide true net-revenue drivers and distort uplift planning.",
        impact: "Improves confidence in lift measurement and allocation decisions.",
        risk: "Skipping cleanup can misdirect budget even when topline appears strong.",
      });
    } else if (hasPlatform || hasTerritory) {
      const anchor = hasPlatform ? topPlatform : topTerritory;
      recs.push({
        action: `Lever 1: scale the strongest channel (${anchor}) with KPI-gated spend increments each week.`,
        rationale: "Concentrating first on strongest observed channel is typically highest-confidence for uplift.",
        impact: "Improves probability of measurable near-term revenue gains.",
        risk: "Channel concentration increases exposure to platform/market volatility.",
      });
      recs.push({
        action: "Lever 2: rebalance underperforming channels only after they pass conversion thresholds.",
        rationale: "Threshold gating prevents weak channels from consuming growth budget.",
        impact: "Raises capital efficiency while preserving upside options.",
        risk: "Overly strict thresholds can delay legitimate growth opportunities.",
      });
      recs.push({
        action: "Lever 3: close attribution gaps (unknown mappings) before the next budget reallocation.",
        rationale: "Reliable attribution is necessary to prove uplift and avoid false positives.",
        impact: "Improves decision reliability for subsequent scaling.",
        risk: "Unresolved attribution can invalidate uplift conclusions.",
      });
    } else {
      recs.push({
        action: "Lever 1: defend current top-revenue segment with explicit weekly KPI targets.",
        rationale: "Uplift plans should start with the most certain existing driver.",
        impact: "Maximizes chance of short-term positive movement.",
        risk: "Driver certainty may be overstated if data quality is weak.",
      });
      recs.push({
        action: "Lever 2: run one controlled growth test with a fixed budget and pre-set stop rules.",
        rationale: "Controlled tests create upside while limiting downside.",
        impact: "Adds optional growth without major risk expansion.",
        risk: "Without stop rules, tests drift into unbounded spend.",
      });
      recs.push({
        action: "Lever 3: improve measurement fidelity (mapping, confidence, reconciliation) before scaling.",
        rationale: "Measurement quality determines whether uplift is real or noise.",
        impact: "Raises confidence in strategic decisions and ROI claims.",
        risk: "Poor measurement can produce false confidence and misallocation.",
      });
    }
  }
  if (asksNoRegretBudget && hasTrack) {
    const secondTrack = rows[1] ? String((rows[1] as Record<string, unknown>).track_title ?? "").trim() : "";
    recs.push({
      action: `Put 70% of this quarter budget behind ${topTrack}, with one owner and weekly KPI checkpoints.`,
      rationale: `${topTrack} is the strongest observed revenue driver in current scope.`,
      impact: "Highest-probability short-term return from constrained spend.",
      risk: "If top-track revenue is anomaly-inflated, over-concentration can reduce resilience.",
    });
    recs.push({
      action: secondTrack.length > 0
        ? `Use 20% as a controlled upside test on ${secondTrack}; keep 10% as reserve for mid-quarter reallocations.`
        : "Use 20% for one controlled upside test track and keep 10% as reserve for mid-quarter reallocations.",
      rationale: "No-regret plans preserve upside while keeping flexibility under uncertainty.",
      impact: "Creates optionality without diluting core execution.",
      risk: "Without clear pass/fail thresholds, test spend can drift.",
    });
  }

  if (/\b(?:tour|touring|live\s+show|live\s+shows|concert|venue|venues|city|cities|routing|route|booking|booking\s+dates?|tour\s+dates?)\b/.test(q) && hasTerritory && !rightsOnlyMode) {
    const topTerritories = topTerritoriesForTour.map((t) => t.territory);
    if (topTerritories.length > 0) {
      const topValue = toNum((topRow as Record<string, unknown>)[moneyKey]) ?? 0;
      const topShare = totalMoney > 0 ? ((topValue / totalMoney) * 100) : null;
      recs.push({
        action: `Prioritize live routing in ${topTerritories.join(", ")} and validate city-level demand before locking dates.`,
        rationale: "These territories are leading current revenue contribution in your catalog scope.",
        impact: topShare !== null
          ? `Top territory contributes about ${topShare.toFixed(1)}% of observed revenue in this result.`
          : "Higher probability of sell-through by routing around proven demand zones.",
        risk: "Territory-level signals can hide city-level variance; confirm with city and venue indicators.",
      });
      recs.push({
        action: "Build a city shortlist (3-5 cities per priority territory) using streaming concentration and promoter/venue fit.",
        rationale: "Tour decisions need city-level conversion signals, not only territory totals.",
        impact: "Reduces routing waste and improves ticket conversion forecasting.",
        risk: "If city-level demand is not validated, routing can over-index weak submarkets.",
      });
      recs.push({
        action: "Stage spend in two waves: pilot dates first, then scale only territories that clear ticket velocity thresholds.",
        rationale: "Protects downside while preserving upside in high-performing markets.",
        impact: "Improves capital efficiency and reduces over-commitment risk.",
        risk: "Requires strict post-show measurement discipline to work.",
      });
      recs.push({
        action: "Run market-readiness checks per priority territory: venue hold availability, competing events window, and pricing-band fit before locking contracts.",
        rationale: "Routing quality depends on external market conditions in addition to internal demand signals.",
        impact: "Reduces booking risk and improves margin certainty per date.",
        risk: "Skipping readiness checks can convert strong demand signals into weak on-ground performance.",
      });
      recs.push({
        action: "Execute a 30-day routing sequence: Week 1 city shortlist, Week 2 venue/promo partner outreach, Week 3 pilot-date holds, Week 4 go/no-go allocation by ticket velocity proxies.",
        rationale: "Tour planning converts best when market selection and execution checkpoints are sequenced, not parallelized blindly.",
        impact: "Raises booking quality and reduces late-stage routing rework.",
        risk: "Without stage-gates, teams commit dates before market readiness is validated.",
      });
    }
  }

  if (/\bplatform|dsp|spotify|apple|youtube|amazon|deezer|tidal\b/.test(q) && hasPlatform && !insufficientMomentumEvidence && !rightsOnlyMode && !asksTouring) {
    const anchor = !isLikelyUnknown(topPlatform)
      ? topPlatform
      : (() => {
        const candidate = rows.find((r) => {
          const p = String((r as Record<string, unknown>).platform ?? "");
          return p.trim().length > 0 && !isLikelyUnknown(p);
        });
        return candidate ? String((candidate as Record<string, unknown>).platform ?? topPlatform) : topPlatform;
      })();
    const anchorRow = rows.find((r) => {
      const p = String((r as Record<string, unknown>).platform ?? "");
      return p.trim().toLowerCase() === anchor.trim().toLowerCase();
    }) ?? topRow;
    const anchorRevenue = toNum((anchorRow as Record<string, unknown>)[moneyKey]);
    if (!isLikelyUnknown(anchor)) {
      recs.push({
        action: `Treat ${anchor} as the priority channel for the next cycle with platform-specific creative and playlist strategy.`,
        rationale: anchorRevenue !== null
          ? `${anchor} is currently carrying a large share of monetized performance (${compactMoney(anchorRevenue)} observed).`
          : `This segment currently leads observed performance in your scoped data.`,
        impact: "Concentrates spend where observed return is strongest.",
        risk: "Concentration risk if top segment is anomaly-driven; validate against prior periods.",
      });
    }
    recs.push({
      action: "Audit and classify all 'Unknown' platform revenue before reallocating budget.",
      rationale: "Unattributed platform revenue blocks reliable channel ROI decisions.",
      impact: "Improves attribution quality and makes platform-level budget allocation defendable.",
      risk: "Skipping this step can over-invest in the wrong channel.",
    });
    if (asksTrendCompare) {
      const periodRows = rows.filter((r) => String((r as Record<string, unknown>).platform ?? "").trim().toLowerCase() === anchor.trim().toLowerCase());
      if (periodRows.length >= 2) {
        const byPeriod = new Map<string, number>();
        for (const r of periodRows) {
          const bucket = String((r as Record<string, unknown>).period_bucket ?? "");
          const value = toNum((r as Record<string, unknown>)[moneyKey]) ?? 0;
          byPeriod.set(bucket, value);
        }
        const lastEntry = Array.from(byPeriod.entries()).find(([k]) => /^last_/i.test(k));
        const priorEntry = Array.from(byPeriod.entries()).find(([k]) => /^prior_/i.test(k));
        if (lastEntry && priorEntry) {
          const delta = lastEntry[1] - priorEntry[1];
          const deltaPct = priorEntry[1] > 0 ? (delta / priorEntry[1]) * 100 : null;
          recs.push({
            action: delta >= 0
              ? `Set a platform delta target for ${anchor}: sustain and extend lift from ${lastEntry[0]} versus ${priorEntry[0]}.`
              : `Launch a recovery plan for ${anchor}: close the decline from ${priorEntry[0]} to ${lastEntry[0]} before scaling spend.`,
            rationale: deltaPct === null
              ? `${anchor} shows a measurable shift across compared periods.`
              : `${anchor} changed by ${deltaPct.toFixed(1)}% between compared periods.`,
            impact: "Turns period comparison into a specific, measurable execution target.",
            risk: "If period attribution is incomplete, delta targets can be misread.",
          });
        }
      }
    }
  }

  if (/\bmarketing|campaign|promot|strategy|grow|scale\b/.test(q) && (hasPlatform || hasTrack) && !insufficientMomentumEvidence && !rightsOnlyMode && !asksTouring) {
    const anchor = hasPlatform ? topPlatform : hasTrack ? topTrack : "top segment";
    const anchorRevenue = toNum((topRow as Record<string, unknown>)[moneyKey]);
    recs.push({
      action: `Build a focused 2-week campaign around ${anchor} with clear conversion checkpoints.`,
      rationale: anchorRevenue !== null
        ? `${anchor} is currently carrying a large share of monetized performance (${compactMoney(anchorRevenue)} observed).`
        : `This segment currently leads observed performance in your scoped data.`,
      impact: "Concentrates spend where observed return is strongest, then iterates using real conversion evidence.",
      risk: "Concentration risk if top segment is anomaly-driven; validate against prior periods.",
    });
  }

  if (asksMomentumBreak) {
    if (insufficientMomentumEvidence) {
      recs.push({
        action: "Insufficient time points to identify a true momentum break. Expand the time window or include at least 4 periods before taking directional action.",
        rationale: "Momentum-break analysis needs a minimum historical sequence, not a single-point snapshot.",
        impact: "Prevents false trend conclusions and misallocated campaign spend.",
        risk: "Acting on one or two points can invert priorities due to noise.",
      });
    }
  }

  if (/\btrack|tracks|songs|money|revenue|earning|top\b/.test(q) && hasTrack && !rightsOnlyMode) {
    recs.push({
      action: `Run a track-level growth plan for ${topTrack}: playlist outreach, creator content, and sync shortlist in parallel.`,
      rationale: "Top-track concentration usually gives fastest near-term uplift when execution is coordinated.",
      impact: "Accelerates monetization of the strongest current asset.",
      risk: "Over-concentration risk if underlying revenue is anomaly-driven.",
    });
  }

  const recommendationTheme: "tour" | "rights" | "platform" | "track" | "trend" | "uplift" | "general" = asksTouring
    ? "tour"
    : rightsOnlyMode
    ? "rights"
    : asksUplift
    ? "uplift"
    : asksTrendCompare
    ? "trend"
    : hasPlatform && /\bplatform|dsp|spotify|apple|youtube|amazon|deezer|tidal\b/.test(q)
    ? "platform"
    : hasTrack
    ? "track"
    : "general";

  if (recs.length === 0 && isStrategyQuestion) {
    if (recommendationTheme === "tour" && hasTerritory && topTerritoriesForTour.length > 0) {
      recs.push({
        action: `Sequence routing decisions by territory readiness: ${topTerritoriesForTour.map((t) => t.territory).join(", ")} first, then expand only after pilot ticket-velocity checks.`,
        rationale: "Tour planning quality depends on proving city-level conversion before committing wider routes.",
        impact: "Reduces routing waste and increases probability of profitable dates.",
        risk: "Skipping pilot validation can lock budget into weak submarkets.",
      });
    } else if (recommendationTheme === "platform" && hasPlatform) {
      recs.push({
        action: `Run a platform allocation split anchored on ${topPlatform}: core budget on proven return, controlled test budget on secondary channels.`,
        rationale: "Channel concentration should be managed with explicit guardrails, not all-in or all-out moves.",
        impact: "Improves channel ROI while limiting concentration exposure.",
        risk: "Without guardrails, reallocation decisions become reactive to noisy swings.",
      });
    } else if (recommendationTheme === "rights") {
      recs.push({
        action: "Prioritize remediation by financial impact: fix high-gross rows with weak rights/mapping confidence before lower-value cleanup.",
        rationale: "Leakage recovery is fastest when ordered by recoverable value, not row volume.",
        impact: "Maximizes near-term payout recovery from limited ops capacity.",
        risk: "A broad untargeted cleanup can consume time with low financial return.",
      });
    } else {
      recs.push({
        action: "Protect 70-80% of budget for proven drivers; reserve 20-30% for controlled tests with explicit pass/fail thresholds.",
        rationale: "This allocation pattern balances short-term certainty with measurable upside discovery.",
        impact: "Improves capital efficiency under uncertainty.",
        risk: "Loose threshold discipline can turn test spend into leakage.",
      });
    }
  }

  if (recs.length === 0 && !isStrategyQuestion && !asksUplift && whyThisMatters.trim().length > 0) {
    if (recommendationTheme === "trend") {
      recs.push({
        action: "Lock one period-over-period target and run a 2-week corrective sprint on the segment with the largest recent delta.",
        rationale: whyThisMatters,
        impact: "Turns trend readouts into a measurable execution loop.",
        risk: "If period attribution is noisy, deltas can be over-interpreted.",
      });
    } else if (recommendationTheme === "track") {
      recs.push({
        action: `Set one concrete growth objective on ${topTrack} and monitor weekly conversion signals before expanding spend.`,
        rationale: whyThisMatters,
        impact: "Improves execution focus and avoids diluted effort across low-signal moves.",
        risk: "Over-concentration can reduce resilience if the top driver is unstable.",
      });
    } else if (recommendationTheme === "platform") {
      recs.push({
        action: `Define a platform-specific next move for ${topPlatform} with one KPI and one stop condition.`,
        rationale: whyThisMatters,
        impact: "Improves actionability while preserving downside control.",
        risk: "Without stop conditions, channel spend drifts without clear learning.",
      });
    } else if (recommendationTheme === "rights") {
      recs.push({
        action: "Run a rights-attribution verification pass on the top financial rows and re-score the decision after cleanup.",
        rationale: whyThisMatters,
        impact: "Improves confidence in net-revenue decisions before scaling changes.",
        risk: "Skipping verification can encode data defects into strategy.",
      });
    } else {
      recs.push({
        action: "Choose one concrete next move tied to the strongest signal in this result and measure outcome before expanding scope.",
        rationale: whyThisMatters,
        impact: "Creates decision-quality learning from current evidence.",
        risk: "Acting broadly on weak signals can increase misallocation risk.",
      });
    }
  }
  const deduped = Array.from(
    new Map(
      recs
        .filter((r) => typeof r.action === "string" && r.action.trim().length > 0)
        .map((r) => [recommendationSemanticKey(String(r.action)), r]),
    ).values(),
  );
  const singleActionText = deduped.length > 0 ? String((deduped[0] as Record<string, unknown>).action ?? "").toLowerCase() : "";
  const shouldAddValidationCheckpoint = deduped.length === 1 &&
    !isStrategyQuestion &&
    /\b(test|pilot|experiment|directional|provisional|low confidence|uncertain|validate)\b/.test(`${singleActionText} ${whyThisMatters.toLowerCase()}`);
  if (shouldAddValidationCheckpoint) {
    deduped.push({
      action: recommendationTheme === "tour"
        ? "Set a pre-booking checkpoint in 14 days: continue, reroute, or pause based on city-level demand validation."
        : "Define one validation checkpoint for the next 14 days to confirm this direction before scaling spend.",
      rationale: recommendationTheme === "tour"
        ? "Tour sequencing requires a hard go/no-go gate before commitments expand."
        : "Fast validation prevents low-signal strategy lock-in.",
      impact: "Improves decision confidence before major allocation changes.",
      risk: "Skipping validation increases probability of expensive misallocation.",
    });
  }
  if ((targetRecommendationCount ?? 0) >= 2 && deduped.length < 2 && !isStrategyQuestion) {
    if (recommendationTheme === "rights") {
      deduped.push({
        action: "Define the first 7-day remediation tranche on the highest-value leakage rows before widening scope.",
        rationale: "Sequencing rights fixes by value prevents low-impact work from blocking recovery.",
        impact: "Improves early payout recovery and clarifies team execution order.",
        risk: "Without tranche boundaries, remediation efforts diffuse across low-impact tasks.",
      });
    } else {
      deduped.push({
        action: "Protect downside by capping spend to a pilot budget until attribution and signal quality are confirmed.",
        rationale: "No-regret planning favors reversible decisions under uncertainty.",
        impact: "Reduces budget burn while preserving option value.",
        risk: "May slow upside capture if evidence quality is actually strong.",
      });
    }
  }
  if ((targetRecommendationCount ?? 0) > 0 && deduped.length < targetRecommendationCount && !(asksTrendCompare && hasPlatform)) {
    const gap = targetRecommendationCount - deduped.length;
    for (let i = 0; i < gap; i++) {
      if (recommendationTheme === "tour") {
        deduped.push({
          action: i % 2 === 0
            ? "Validate promoter/venue fit for priority cities before confirming additional holds."
            : "Set ticket-velocity thresholds per city and auto-stop low-conversion routes.",
          rationale: "Tour decisions improve when market-readiness checks are explicit and sequenced.",
          impact: "Protects routing efficiency and margin quality.",
          risk: "Without city gates, territory-level signals can hide weak execution pockets.",
        });
      } else if (recommendationTheme === "platform") {
        const hasUnknownAttributionRec = deduped.some((rec) => {
          const action = String((rec as Record<string, unknown>).action ?? "").toLowerCase();
          return /\bunknown\b/.test(action) && /\bplatform\b/.test(action) && /\b(attribution|audit|classify|cleanup|close)\b/.test(action);
        });
        deduped.push({
          action: i % 2 === 0
            ? (hasUnknownAttributionRec
              ? "Set platform-level ROI thresholds and pause channels below floor targets."
              : "Close unknown-platform attribution before the next budget reallocation.")
            : "Define a secondary-channel uplift target and rebalance only channels that clear it.",
          rationale: "Channel strategy is only as strong as attribution and threshold discipline.",
          impact: "Improves channel allocation defensibility and ROI consistency.",
          risk: "Weak attribution or no thresholds increases budget drift risk.",
        });
      } else if (recommendationTheme === "rights") {
        deduped.push({
          action: i % 2 === 0
            ? "Order rights cleanup by recoverable value: fix highest gross-to-net gaps first, then medium-impact rows, then residual long-tail issues."
            : "Set a 30-day remediation cadence with weekly checkpoints for mapping confidence, validation-critical rows, and recovered net revenue.",
          rationale: "Rights remediation performs best when sequencing and measurement are explicit.",
          impact: "Improves payout recovery speed and makes remediation progress auditable.",
          risk: "Without a sequence and cadence, teams can burn effort on low-impact fixes.",
        });
      } else {
        deduped.push({
          action: i % 2 === 0
            ? "Improve attribution fidelity for top revenue segments before scaling budget allocation."
            : "Define explicit pass/fail thresholds for every spend move before execution.",
          rationale: "When evidence is thin, execution discipline is the fastest way to raise decision quality.",
          impact: "Reduces avoidable spend leakage and improves learning speed.",
          risk: "If ignored, low-signal moves can accumulate into expensive misallocation.",
        });
      }
    }
  }
  if ((targetRecommendationCount ?? 0) > 0 && deduped.length > targetRecommendationCount) {
    return enrichRecommendationRecords(deduped.slice(0, targetRecommendationCount), recommendationTheme);
  }
  return enrichRecommendationRecords(deduped.slice(0, targetRecommendationCount ?? 4), recommendationTheme);
}

async function maybeFetchExternalContext(params: {
  question: string;
  artistName?: string;
  visual: AdaptiveAnswerResponse["visual"];
}): Promise<{ summary: string; citations: Array<Record<string, unknown>> } | null> {
  const searchUrl = Deno.env.get("WEB_SEARCH_API_URL") ?? null;
  const searchKey = Deno.env.get("WEB_SEARCH_API_KEY") ?? null;
  if (!searchUrl || !searchKey) return null;

  const q = params.question.toLowerCase();
  const isTouring = isTouringQuestion(params.question);
  const shouldEnrich = /\btour|live|venue|cities|marketing|campaign|strategy|playlist|spotify\b/.test(q);
  if (!shouldEnrich) return null;

  const rows = Array.isArray(params.visual.rows) ? params.visual.rows : [];
  const top = rows[0] ?? {};
  const topTerritories = rows
    .map((r) => (typeof (r as Record<string, unknown>).territory === "string" ? String((r as Record<string, unknown>).territory).trim() : ""))
    .filter((v) => v.length > 0 && !isLikelyUnknown(v))
    .slice(0, 3);
  const anchors = {
    artist_name: params.artistName ?? null,
    territory: typeof (top as Record<string, unknown>).territory === "string" ? (top as Record<string, unknown>).territory : null,
    platform: typeof (top as Record<string, unknown>).platform === "string" ? (top as Record<string, unknown>).platform : null,
    track_title: typeof (top as Record<string, unknown>).track_title === "string" ? (top as Record<string, unknown>).track_title : null,
    top_territories: topTerritories,
    intent: isTouring ? "touring_live_enrichment" : "general_enrichment",
  };

  try {
    const resp = await fetch(searchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${searchKey}`,
      },
      body: JSON.stringify({
        question: params.question,
        anchors,
        max_results: isTouring ? 6 : 3,
        enrichment_prompt: isTouring
          ? "Prioritize city-level touring context: venue ecosystem, competing events, seasonality, pricing signals, and route feasibility."
          : "Provide concise external market context relevant to this decision.",
      }),
    });
    if (!resp.ok) return null;
    const payload = (await resp.json()) as Record<string, unknown>;
    const summary = typeof payload.summary === "string" ? payload.summary : "";
    const results = Array.isArray(payload.results) ? payload.results : [];
    const citations: Array<Record<string, unknown>> = results.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      return [{
        title: typeof row.title === "string" ? row.title : "External Source",
        url: typeof row.url === "string" ? row.url : undefined,
        source_type: "external",
        claim_ids: [makeClaimId(JSON.stringify(row), 0)],
      }];
    });
    if (!summary && citations.length === 0) return null;
    return { summary, citations };
  } catch {
    return null;
  }
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
  userClient: any,
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
  const asksTerritory = /\b(territory|country|market|region|geo|geography|tour|touring|concert|live show|city|cities)\b/.test(q);
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
    if (mode === "artist" && !hasArtistContext && asksForCurrentArtist(question)) {
      return jsonResponse(
        {
          error: "Artist scope is missing.",
          quality_outcome: "clarify",
          clarification: {
            question: "Select an artist first, then ask the question again.",
            reason: "This question references a specific current artist but no artist context was provided.",
            options: ["Select artist in left rail", "Switch to workspace question"],
          },
        },
        422,
      );
    }
    if (mode === "track" && !hasTrackContext && asksForCurrentTrack(question)) {
      return jsonResponse(
        {
          error: "Track scope is missing.",
          quality_outcome: "clarify",
          clarification: {
            question: "Select a track first, then ask the question again.",
            reason: "This question references a specific current track but no track context was provided.",
            options: ["Select track in left rail", "Switch to workspace question"],
          },
        },
        422,
      );
    }
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
      const visual = normalizedVisualForDecision(toAiVisual(assistantPayload));
      const diag = (assistantPayload.diagnostics ?? {}) as Record<string, unknown>;
      const diagNotesRaw = Array.isArray(diag.data_notes) ? diag.data_notes : [];
      const trendQuestion = isTrendComparisonQuestion(question);
      const diagNotes = diagNotesRaw.filter((note) => {
        if (typeof note !== "string") return false;
        if (!trendQuestion && note.includes("missing_time_dimension")) return false;
        return true;
      });
      const verifierStatusResolved = typeof diag.verifier_status === "string" ? diag.verifier_status : "passed";
      const persona = detectPersonaFromText(question);
      const decisionFrame = buildDecisionFrame(question, "artist", resolvedEntities, persona);
      const evidenceFit = computeQuestionEvidenceFit(question, visual);
      const isTouring = isTouringQuestion(question);
      const tourBrief = isTouring ? buildTourDecisionBrief(visual) : null;
      const confidence: "high" | "medium" | "low" = rowCount === 0
        ? "low"
        : verifierStatusResolved === "failed"
          ? "low"
          : diagNotes.length > 0
            ? "medium"
            : "high";
      const resolvedWhy =
        (isNonEmptyString(assistantPayload.why_this_matters) && assistantPayload.why_this_matters) ||
        (isNonEmptyString(assistantPayload.answer_title) ? assistantPayload.answer_title : "Artist-level reviewed evidence in scope.");
      const recommendations = buildDataDrivenRecommendations(question, visual, resolvedWhy);
      const externalContext = decisionFrame.asks_external_context ? await maybeFetchExternalContext({
        question,
        artistName: resolvedEntities.artist_name ?? entityContext.artist_name,
        visual,
      }) : null;
      const mergedCitations = (() => {
        const merged = [
          ...(Array.isArray(assistantPayload.citations) ? assistantPayload.citations : []),
          ...(Array.isArray(externalContext?.citations) ? externalContext!.citations : []),
        ];
        const seen = new Set<string>();
        const out: Array<Record<string, unknown>> = [];
        for (const item of merged) {
          if (!item || typeof item !== "object" || Array.isArray(item)) continue;
          const row = item as Record<string, unknown>;
          const key = `${String(row.url ?? "")}|${String(row.title ?? "")}`.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(row);
        }
        return out;
      })();
      const isStrategyQuestion = isStrategyQuestionText(question);
      const qualityOutcome = evidenceFit.score < 0.4 ? "constrained" : (assistantPayload.quality_outcome ?? undefined);
      const topRow = Array.isArray(visual.rows) && visual.rows.length > 0 ? visual.rows[0] : null;
      const requestedTopN = parseRequestedTopN(question);
      const returnedRows = Array.isArray(visual.rows) ? visual.rows.length : 0;
      const topTrack = topRow && typeof topRow.track_title === "string" ? topRow.track_title : null;
      const topPlatform = topRow && typeof topRow.platform === "string" ? topRow.platform : null;
      const strategyExecutiveFallback = topTrack
        ? `Primary focus should be ${topTrack}, then run one controlled secondary bet to reduce concentration risk while preserving upside.`
        : topPlatform
          ? `Primary focus should be ${topPlatform}, then run one controlled secondary channel test to reduce concentration risk while preserving upside.`
          : "Primary focus should stay on the strongest proven driver, with one controlled secondary test to preserve upside and reduce concentration risk.";
      const finalExecutive = qualityOutcome === "constrained" && !isStrategyQuestion
        ? "I found relevant artist data, but evidence fit to this question is partial. Use these recommendations as provisional until missing evidence is added."
        : (isStrategyQuestion && (!isNonEmptyString(assistantPayload.answer_text) || /constrained artist answer/i.test(assistantPayload.answer_text))
          ? strategyExecutiveFallback
          : assistantPayload.answer_text);
      const finalWhy = qualityOutcome === "constrained" && !isStrategyQuestion
        ? "The decision is directionally useful, but key evidence fields for a high-confidence answer are missing."
        : resolvedWhy;
      const topCountCaveat = requestedTopN !== null && requestedTopN > returnedRows && returnedRows > 0
        ? `Requested top ${requestedTopN}; only ${returnedRows} ranked row${returnedRows === 1 ? "" : "s"} are available in current scope.`
        : null;
      const largestChange = buildLargestChangeStatement(question, visual);
      const qualityCaveat = buildEarlyDataCaveat({
        rowCount,
        visual,
        diagnostics: assistantPayload.diagnostics as Record<string, unknown> | undefined,
      });
      const executiveBase = tourBrief ? tourBrief.executive : finalExecutive;
      const executiveOut = [executiveBase, topCountCaveat, largestChange, qualityCaveat].filter(Boolean).join(" ");
      const whyOut = tourBrief ? tourBrief.why : finalWhy;
      const kpisOut = tourBrief
        ? [...tourBrief.kpis, ...kpis].slice(0, 6)
        : kpis;

      return jsonResponse({
        conversation_id: assistantPayload.conversation_id ?? body.conversation_id ?? crypto.randomUUID(),
        resolved_mode: "artist",
        resolved_entities: resolvedEntities,
        answer_title: isStrategyQuestion
          ? "Strategic Priorities"
          : ((isNonEmptyString(assistantPayload.answer_title) && assistantPayload.answer_title) || "Artist AI answer"),
        executive_answer: executiveOut,
        why_this_matters: whyOut,
        evidence: {
          row_count: rowCount,
          scanned_rows: rowCount,
          from_date: assistantPayload.evidence?.from_date ?? fromDate,
          to_date: assistantPayload.evidence?.to_date ?? toDate,
          provenance: Array.isArray(assistantPayload.evidence?.provenance) ? assistantPayload.evidence?.provenance : ["run_artist_chat_sql_v1"],
          system_confidence: confidence,
        },
        kpis: kpisOut,
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
        recommendations,
        external_context: externalContext ?? undefined,
        quality_outcome: qualityOutcome,
        resolved_scope: assistantPayload.resolved_scope ?? undefined,
        plan_trace: assistantPayload.plan_trace ?? undefined,
        claims: Array.isArray(assistantPayload.claims) ? assistantPayload.claims : undefined,
        citations: mergedCitations.length > 0 ? mergedCitations : undefined,
        answer_blocks: undefined,
        render_hints: assistantPayload.render_hints ?? undefined,
        evidence_map: assistantPayload.evidence_map ?? undefined,
        unknowns: Array.isArray(assistantPayload.unknowns) ? assistantPayload.unknowns : undefined,
        clarification: assistantPayload.clarification ?? undefined,
        diagnostics: {
          ...(assistantPayload.diagnostics ?? {}),
          data_notes: diagNotes,
          decision_frame: decisionFrame,
          evidence_fit: evidenceFit,
        },
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
              row: trackRow,
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
        quality_outcome: assistantPayload.quality_outcome ?? undefined,
        resolved_scope: assistantPayload.resolved_scope ?? undefined,
        plan_trace: assistantPayload.plan_trace ?? undefined,
        claims: Array.isArray(assistantPayload.claims) ? assistantPayload.claims : undefined,
        citations: Array.isArray(assistantPayload.citations) ? assistantPayload.citations : undefined,
        answer_blocks: undefined,
        render_hints: assistantPayload.render_hints ?? undefined,
        evidence_map: assistantPayload.evidence_map ?? undefined,
        unknowns: Array.isArray(assistantPayload.unknowns) ? assistantPayload.unknowns : undefined,
        clarification: assistantPayload.clarification ?? undefined,
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
        quality_outcome: assistantPayload.quality_outcome ?? undefined,
        resolved_scope: assistantPayload.resolved_scope ?? undefined,
        plan_trace: assistantPayload.plan_trace ?? undefined,
        claims: Array.isArray(assistantPayload.claims) ? assistantPayload.claims : undefined,
        citations: Array.isArray(assistantPayload.citations) ? assistantPayload.citations : undefined,
        answer_blocks: undefined,
        render_hints: assistantPayload.render_hints ?? undefined,
        evidence_map: assistantPayload.evidence_map ?? undefined,
        unknowns: Array.isArray(assistantPayload.unknowns) ? assistantPayload.unknowns : undefined,
        clarification: assistantPayload.clarification ?? undefined,
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
