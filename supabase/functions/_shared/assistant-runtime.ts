import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  AnalysisPlan,
  ArtistCatalog,
  compileSqlFromPlan,
  deriveAnalysisPlanFallback,
  validatePlannedSql,
  verifyQueryResult,
} from "./assistant-query-engine.ts";
import {
  planEvidence,
  type EvidencePack,
  type EvidencePlan,
} from "./assistant-evidence/index.ts";
import {
  planAnswerEvidence,
  type MultiEvidencePlan,
  type SqlEvidenceJob,
} from "./answer-planner.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export const ASSISTANT_RUNTIME_PATCH = "shared-runtime-2026-04-24";

const PLAN_TOKEN_TTL_MINUTES = 15;
const SQL_ROW_LIMIT = 200;
const SQL_TIMEOUT_MS = 4000;

type Action = "plan_query" | "run_query" | "send_turn";
type ScopeMode = "track" | "artist" | "workspace";

type PlanTokenPayload = {
  plan_id: string;
  user_id: string;
  scope_mode: ScopeMode;
  scope_value: string | null;
  from_date: string;
  to_date: string;
  sql_preview: string;
  question: string;
  expires_at: string;
};

export type SqlExecutionResponse = {
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  row_count?: number;
  duration_ms?: number;
  query_provenance?: string[];
  applied_scope?: Record<string, unknown>;
};

export type RuntimeScope = {
  scopeValue: string | null;
  entityContext: Record<string, string>;
};

export type ThreadState = {
  conversation_id: string;
  scope_token: string;
  scope_epoch: number;
  intent?: string;
  constraints?: {
    platform?: string[];
    territory?: string[];
    requested_granularity?: "city" | "territory" | "platform" | "track" | "unknown";
  };
  selected_columns?: string[];
  missing_columns?: string[];
  clarification?: {
    pending: boolean;
    reason?: string;
    question?: string;
    options?: string[];
  };
};

type QueryConstraints = {
  platform: string[];
  territory: string[];
  asks_city: boolean;
  asks_track: boolean;
  asks_platform: boolean;
  asks_territory: boolean;
  requested_granularity: "city" | "territory" | "platform" | "track" | "unknown";
};

type ColumnCapability = {
  field_key: string;
  aliases: string[];
  semantic_type: "money" | "rate" | "dimension" | "date" | "id" | "text" | "count";
  quality_hints: { coverage_pct: number; confidence: "high" | "medium" | "low" };
};

export type AssistantRuntimeConfig = {
  mode: ScopeMode;
  scopeField?: "track_key" | "artist_key";
  scopeLabel: "Track" | "Artist" | "Workspace";
  safetyFlag: "track_scoped" | "artist_scoped" | "workspace_scoped";
  catalogProvenance: string;
  sqlSourceRef: string;
  runtimePatch?: string;
  resolveScope: (body: Record<string, unknown>) => RuntimeScope;
  fetchCatalog: (
    userClient: any,
    scope: RuntimeScope,
    fromDate: string,
    toDate: string,
  ) => Promise<ArtistCatalog>;
  runSql: (
    userClient: any,
    scope: RuntimeScope,
    fromDate: string,
    toDate: string,
    sql: string,
  ) => Promise<SqlExecutionResponse>;
  runEvidencePlan?: (
    userClient: any,
    scope: RuntimeScope,
    fromDate: string,
    toDate: string,
    evidencePlan: EvidencePlan,
  ) => Promise<EvidencePack>;
  logTurn?: (
    adminClient: any | null,
    payload: Record<string, unknown>,
  ) => Promise<void>;
};

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asArrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => asString(item)).filter((item): item is string => !!item)
    : [];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter((v) => v.length > 0)));
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

function normalizeDateRange(fromDate: unknown, toDate: unknown): { fromDate: string; toDate: string } {
  const today = new Date();
  const fallbackFrom = new Date(today);
  fallbackFrom.setMonth(fallbackFrom.getMonth() - 12);
  const from = asString(fromDate) ? new Date(asString(fromDate)!) : fallbackFrom;
  const to = asString(toDate) ? new Date(asString(toDate)!) : today;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error("Invalid date.");
  const normalized = { fromDate: from.toISOString().slice(0, 10), toDate: to.toISOString().slice(0, 10) };
  if (normalized.fromDate > normalized.toDate) throw new Error("from_date cannot be after to_date.");
  return normalized;
}

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): string {
  const base = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - (base.length % 4)) % 4);
  return atob(base + pad);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function signExecutionToken(secret: string, payload: PlanTokenPayload): Promise<string> {
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  return `${payloadB64}.${await hmacHex(secret, payloadB64)}`;
}

async function verifyExecutionToken(secret: string, token: string): Promise<PlanTokenPayload> {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) throw new Error("Invalid execution token format.");
  if (!timingSafeEqual(await hmacHex(secret, payloadB64), signature)) throw new Error("Invalid execution token signature.");
  const payload = JSON.parse(fromBase64Url(payloadB64)) as PlanTokenPayload;
  if (Number.isNaN(new Date(payload.expires_at).getTime()) || new Date(payload.expires_at).getTime() < Date.now()) {
    throw new Error("Execution token expired.");
  }
  return payload;
}

function sanitizeRows(rows: unknown): Array<Record<string, string | number | null>> {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const out: Record<string, string | number | null> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      out[k] = v === null || v === undefined ? null : typeof v === "string" || typeof v === "number" ? v : JSON.stringify(v);
    }
    return [out];
  });
}

function sanitizeKpis(input: unknown): Array<{ label: string; value: string; change?: string }> {
  if (!Array.isArray(input)) return [];
  return input.flatMap((kpi) => {
    if (!kpi || typeof kpi !== "object" || Array.isArray(kpi)) return [];
    const record = kpi as Record<string, unknown>;
    const label = asString(record.label);
    const value = asString(record.value);
    const change = asString(record.change);
    return label && value ? [change ? { label, value, change } : { label, value }] : [];
  }).slice(0, 6);
}

function stableHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

function inferSemanticType(fieldKey: string, inferred: string): ColumnCapability["semantic_type"] {
  if (/(_id|^id$|_key$|isrc|iswc|ipi)/i.test(fieldKey)) return "id";
  if (/date|period/i.test(fieldKey) || inferred === "date") return "date";
  if (/revenue|gross|net|commission|amount|payout/i.test(fieldKey)) return "money";
  if (/pct|percent|ratio|rate|confidence|share|trend|growth/i.test(fieldKey)) return "rate";
  if (/qty|quantity|count|rows?/i.test(fieldKey)) return "count";
  if (/territory|platform|usage|artist|track|currency|party|work|recording/i.test(fieldKey)) return "dimension";
  return "text";
}

function buildColumnRegistry(catalog: ArtistCatalog): ColumnCapability[] {
  return catalog.columns.map((c) => ({
    field_key: c.field_key,
    aliases: c.aliases ?? [],
    semantic_type: inferSemanticType(c.field_key, String(c.inferred_type ?? "text")),
    quality_hints: {
      coverage_pct: Number(c.coverage_pct ?? 0),
      confidence: Number(c.coverage_pct ?? 0) >= 80 ? "high" : Number(c.coverage_pct ?? 0) >= 45 ? "medium" : "low",
    },
  }));
}

function parseConstraints(question: string, prior?: ThreadState["constraints"]): QueryConstraints {
  const platform = unique([
    ...(prior?.platform ?? []),
    ...[/\bspotify\b/i, /\bapple\b/i, /\byoutube\b/i, /\bamazon\b/i, /\btidal\b/i, /\bdeezer\b/i]
      .flatMap((pattern, idx) => pattern.test(question) ? [["spotify", "apple music", "youtube", "amazon", "tidal", "deezer"][idx]] : []),
  ]);
  const territory = unique([...(prior?.territory ?? []), ...((question.match(/\b([A-Z]{2})\b/g) ?? []).map((t) => t.toUpperCase()))]);
  const asksCity = /\bcity|cities|berlin|lagos|london|new york|paris\b/i.test(question);
  const asksPlatform = /\bplatform|dsp|service|spotify|apple|youtube|amazon|tidal|deezer\b/i.test(question);
  const asksTerritory = /\bterritory|country|market|region|geo\b/i.test(question);
  const asksTrack = /\btrack|song|title|isrc|work|recording\b/i.test(question);
  return {
    platform,
    territory,
    asks_city: asksCity,
    asks_track: asksTrack,
    asks_platform: asksPlatform,
    asks_territory: asksTerritory,
    requested_granularity: asksCity ? "city" : asksTerritory ? "territory" : asksPlatform ? "platform" : asksTrack ? "track" : "unknown",
  };
}

function filterRelevantColumns(registry: ColumnCapability[], question: string, constraints: QueryConstraints): ColumnCapability[] {
  const q = question.toLowerCase();
  const required = new Set<string>();
  if (/\brevenue|earning|money|royalt|gross|net\b/.test(q)) required.add("net_revenue");
  if (constraints.asks_platform || constraints.platform.length > 0) required.add("platform");
  if (constraints.asks_territory || constraints.territory.length > 0) required.add("territory");
  if (/\btrend|month|week|day|growth|over time\b/.test(q)) required.add("event_date");
  if (constraints.asks_track) ["track_title", "work_title", "recording_title"].forEach((field) => required.add(field));
  const subset = registry.filter((r) => required.has(r.field_key) || r.aliases.some((a) => q.includes(a.toLowerCase())));
  return subset.length > 0 ? subset.slice(0, 20) : registry.slice(0, 14);
}

function computeScopeToken(mode: ScopeMode, scopeValue: string | null, fromDate: string, toDate: string): string {
  return `${mode}:${stableHash(`${scopeValue ?? "workspace"}:${fromDate}:${toDate}`)}`;
}

async function loadThreadState(adminClient: any | null, userId: string, conversationId: string): Promise<ThreadState | null> {
  if (!adminClient) return null;
  try {
    const { data, error } = await adminClient.from("ai_track_thread_state_v1").select("conversation_id,scope_token,scope_epoch,state_json").eq("user_id", userId).eq("conversation_id", conversationId).maybeSingle();
    if (error || !data) return null;
    const state = ((data as Record<string, unknown>).state_json ?? {}) as Record<string, unknown>;
    return {
      conversation_id: asString((data as Record<string, unknown>).conversation_id) ?? conversationId,
      scope_token: asString((data as Record<string, unknown>).scope_token) ?? "",
      scope_epoch: Number((data as Record<string, unknown>).scope_epoch ?? 1),
      intent: asString(state.intent) ?? undefined,
      constraints: (state.constraints as ThreadState["constraints"]) ?? undefined,
      selected_columns: Array.isArray(state.selected_columns) ? (state.selected_columns as string[]) : undefined,
      missing_columns: Array.isArray(state.missing_columns) ? (state.missing_columns as string[]) : undefined,
      clarification: state.clarification as ThreadState["clarification"] | undefined,
    };
  } catch {
    return null;
  }
}

async function saveThreadState(adminClient: any | null, userId: string, state: ThreadState): Promise<void> {
  if (!adminClient) return;
  try {
    await adminClient.from("ai_track_thread_state_v1").upsert({
      user_id: userId,
      conversation_id: state.conversation_id,
      scope_token: state.scope_token,
      scope_epoch: state.scope_epoch,
      state_json: {
        intent: state.intent ?? null,
        constraints: state.constraints ?? {},
        selected_columns: state.selected_columns ?? [],
        missing_columns: state.missing_columns ?? [],
        clarification: state.clarification ?? null,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,conversation_id" });
  } catch {
    // best effort
  }
}

async function buildPlan(args: {
  question: string;
  catalog: ArtistCatalog;
  columnRegistrySubset: ColumnCapability[];
  priorThreadState: ThreadState | null;
  constraints: QueryConstraints;
  openAiKey: string | null;
  model: string;
}) {
  const requiredFromConstraints = unique([
    ...(args.constraints.asks_platform || args.constraints.platform.length > 0 ? ["platform"] : []),
    ...(args.constraints.asks_territory || args.constraints.territory.length > 0 ? ["territory"] : []),
    ...(args.constraints.asks_track ? ["track_title"] : []),
  ]);
  const available = new Set(args.catalog.columns.map((c) => c.field_key));
  const missingRequested = requiredFromConstraints.filter((field) => !available.has(field));
  const fallback = normalizePlan(deriveAnalysisPlanFallback(args.question, args.catalog), args.question, args.catalog);
  if (!args.openAiKey) {
    return {
      plan: fallback,
      plan_source: "fallback" as const,
      column_requirements: {
        required: unique([...fallback.required_columns, ...requiredFromConstraints]),
        optional: unique(args.priorThreadState?.selected_columns ?? []).slice(0, 6),
        missing_requested: missingRequested,
      },
      sql_intent: fallback.intent,
    };
  }

  const fieldList = (args.columnRegistrySubset.length > 0 ? args.columnRegistrySubset : buildColumnRegistry(args.catalog))
    .map((c) => `${c.field_key} [${c.semantic_type}]${c.aliases.length > 0 ? ` (aliases: ${c.aliases.join(", ")})` : ""}`)
    .join("\n");
  try {
    const raw = await callOpenAiJson<Partial<AnalysisPlan>>({
      apiKey: args.openAiKey,
      model: args.model,
      systemPrompt: [
        "You are a query planner for a music royalties analytics engine.",
        "Return valid JSON only with keys from AnalysisPlan. Use only exact field_key values from the list below.",
        fieldList,
      ].join("\n"),
      userPrompt: JSON.stringify({ question: args.question, constraints: args.constraints }),
    });
    const modelPlan = normalizePlan({
      intent: asString(raw.intent) ?? fallback.intent,
      metrics: asArrayOfStrings(raw.metrics).slice(0, 4),
      dimensions: asArrayOfStrings(raw.dimensions).slice(0, 4),
      filters: Array.isArray(raw.filters) ? raw.filters as AnalysisPlan["filters"] : [],
      grain: raw.grain === "day" || raw.grain === "week" || raw.grain === "month" || raw.grain === "quarter" ? raw.grain : fallback.grain,
      time_window: raw.time_window === "explicit" ? "explicit" : "implicit",
      confidence: raw.confidence === "high" || raw.confidence === "medium" ? raw.confidence : "low",
      required_columns: asArrayOfStrings(raw.required_columns).slice(0, 8),
      top_n: typeof raw.top_n === "number" ? Math.min(50, Math.max(1, Math.round(raw.top_n))) : fallback.top_n,
      sort_by: asString(raw.sort_by) ?? fallback.sort_by,
      sort_dir: raw.sort_dir === "asc" ? "asc" : "desc",
    }, args.question, args.catalog);
    return {
      plan: modelPlan,
      plan_source: "model" as const,
      column_requirements: {
        required: unique([...modelPlan.required_columns, ...requiredFromConstraints]),
        optional: unique(args.priorThreadState?.selected_columns ?? []).slice(0, 6),
        missing_requested: missingRequested,
      },
      sql_intent: modelPlan.intent,
    };
  } catch {
    return {
      plan: fallback,
      plan_source: "fallback" as const,
      column_requirements: {
        required: unique([...fallback.required_columns, ...requiredFromConstraints]),
        optional: unique(args.priorThreadState?.selected_columns ?? []).slice(0, 6),
        missing_requested: missingRequested,
      },
      sql_intent: fallback.intent,
    };
  }
}

function normalizePlan(plan: AnalysisPlan, question: string, catalog: ArtistCatalog): AnalysisPlan {
  const q = question.toLowerCase();
  const required = unique([
    ...plan.required_columns,
    ...plan.metrics,
    ...plan.dimensions,
    ...plan.filters.map((f) => f.column),
    ...(/\b(platform|dsp|service|spotify|apple|youtube|amazon|tidal|deezer)\b/i.test(q) ? ["platform"] : []),
    ...(/\b(revenue|money|earning|royalt|gross|net)\b/i.test(q) ? ["net_revenue"] : []),
    ...(/\b(trend|over time|month|quarter|week|day|growth|qoq|yoy|mom)\b/i.test(q) ? ["event_date"] : []),
  ]);
  const catalogFields = new Set(catalog.columns.map((c) => c.field_key));
  const correctedRevenue = required.includes("net_revenue") || required.includes("gross_revenue")
    ? required
    : required.concat(catalogFields.has("net_revenue") ? ["net_revenue"] : catalogFields.has("gross_revenue") ? ["gross_revenue"] : []);
  return {
    ...plan,
    required_columns: unique(correctedRevenue),
    top_n: Math.min(50, Math.max(1, Number(plan.top_n || 5))),
    sort_by: asString(plan.sort_by) ?? (plan.metrics[0] ?? "net_revenue"),
    sort_dir: plan.sort_dir === "asc" ? "asc" : "desc",
  };
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  let depth = 0;
  let start = -1;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (trimmed[i] === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) return trimmed.slice(start, i + 1);
    }
  }
  throw new Error("Model did not return valid JSON.");
}

async function callOpenAiJson<T>({ apiKey, model, systemPrompt, userPrompt }: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<T> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI error (${resp.status}): ${await resp.text()}`);
  const payload = await resp.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenAI response missing content.");
  return JSON.parse(extractJsonObject(content)) as T;
}

function toEvidence(sqlResult: SqlExecutionResponse, fromDate: string, toDate: string, provenance: string) {
  return {
    row_count: Number(sqlResult.row_count ?? 0),
    duration_ms: Number(sqlResult.duration_ms ?? 0),
    from_date: asString(sqlResult.applied_scope?.from_date) ?? fromDate,
    to_date: asString(sqlResult.applied_scope?.to_date) ?? toDate,
    provenance: Array.isArray(sqlResult.query_provenance)
      ? sqlResult.query_provenance.filter((item) => typeof item === "string")
      : [provenance],
  };
}

function buildClaimsFromRows(columns: string[], rows: Array<Record<string, string | number | null>>, sourceRef: string) {
  if (rows.length === 0) return [];
  const top = rows[0];
  return columns.slice(0, 6).flatMap((key) =>
    key in top
      ? [{
        claim_id: `${key}_${stableHash(String(top[key] ?? "null"))}`,
        text: `${key}: ${String(top[key] ?? "null")}`,
        supporting_fields: [key],
        source_ref: sourceRef,
      }]
      : []
  );
}

function evaluateQualityOutcome(args: {
  constraints: QueryConstraints;
  rows: Array<Record<string, string | number | null>>;
  evidence: { row_count: number };
  missingRequested: string[];
}) {
  const unknowns: string[] = [];
  if (args.missingRequested.length > 0) {
    return {
      quality_outcome: "clarify" as const,
      clarification: {
        question: `I can answer this better if you confirm the closest available dimension. Do you want this by ${args.missingRequested.join(", ")} or by available territory/platform?`,
        reason: `Requested dimensions are unavailable: ${args.missingRequested.join(", ")}`,
        options: ["territory", "platform", "track_title"],
      },
      unknowns: [`Missing requested columns: ${args.missingRequested.join(", ")}`],
    };
  }
  if (args.constraints.asks_city) {
    return {
      quality_outcome: "clarify" as const,
      clarification: {
        question: "I currently have territory-level data, not city-level fields. Should I proceed with territory-level recommendations?",
        reason: "City granularity requested but no city field is available in the scoped dataset.",
        options: ["proceed with territory", "change question", "broaden scope"],
      },
      unknowns: ["City-level granularity unavailable in current schema."],
    };
  }
  if (args.evidence.row_count < 3) {
    unknowns.push("Low row count can reduce decision confidence.");
    return { quality_outcome: "constrained" as const, unknowns };
  }
  return { quality_outcome: "pass" as const, unknowns };
}

function buildAnswerBlocks(args: {
  title: string;
  text: string;
  why: string;
  kpis: Array<{ label: string; value: string; change?: string }>;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
  claims: Array<Record<string, unknown>>;
  unknowns: string[];
  clarification?: { question: string; reason: string; options?: string[] };
  quality_outcome: "pass" | "clarify" | "constrained";
}) {
  const blocks: Array<Record<string, unknown>> = [{
    id: "direct-answer",
    type: "direct_answer",
    priority: 1,
    source: "workspace_data",
    payload: { title: args.title, text: args.text },
  }];
  if (args.quality_outcome === "clarify" && args.clarification) {
    blocks.push({
      id: "clarification",
      type: "scenario_options",
      priority: 2,
      source: "workspace_data",
      payload: {
        items: (args.clarification.options ?? []).map((opt) => ({ action: opt, rationale: args.clarification?.reason })),
        question: args.clarification.question,
      },
    });
  } else {
    if (args.why) blocks.push({ id: "deep-summary", type: "deep_summary", priority: 2, source: "workspace_data", payload: { text: args.why } });
    if (args.kpis.length > 0) blocks.push({ id: "kpi-strip", type: "kpi_strip", priority: 3, source: "workspace_data", payload: { items: args.kpis } });
    if (args.rows.length > 0) blocks.push({ id: "table-main", type: "table", priority: 4, source: "workspace_data", payload: { columns: args.columns, rows: args.rows } });
  }
  if (args.unknowns.length > 0) blocks.push({ id: "risk-flags", type: "risk_flags", priority: 8, source: "workspace_data", payload: { items: args.unknowns } });
  if (args.claims.length > 0) {
    blocks.push({
      id: "citations",
      type: "citations",
      priority: 9,
      source: "workspace_data",
      payload: { items: args.claims.map((c) => ({ title: String(c.source_ref ?? "workspace_data"), claim_ids: [String(c.claim_id ?? "")], source_type: "workspace_data" })) },
    });
  }
  return blocks;
}

function evidencePackRowCount(pack: EvidencePack): number {
  return pack.resolved_entities.length +
    pack.revenue_evidence.length +
    pack.rights_evidence.length +
    pack.split_evidence.length +
    pack.computed_allocations.length +
    pack.source_documents.length +
    pack.quality_flags.length +
    pack.missing_evidence.length;
}

function toTableRows(records: Array<Record<string, unknown>>, limit = 25): Array<Record<string, string | number | null>> {
  return sanitizeRows(records.slice(0, limit));
}

function evidencePackPrimaryTable(pack: EvidencePack): { columns: string[]; rows: Array<Record<string, string | number | null>> } | undefined {
  const allocationRows = pack.computed_allocations.map((allocation) => ({
    party_name: allocation.party_name,
    work_title: allocation.work_title,
    allocation_amount: allocation.allocation_amount,
    currency: allocation.currency,
    share_pct: allocation.share_pct,
    revenue_amount: allocation.revenue_amount,
    allocation_label: allocation.allocation_label,
    allocation_basis: allocation.allocation_basis,
  }));
  if (allocationRows.length > 0) {
    return {
      columns: ["party_name", "work_title", "allocation_amount", "currency", "share_pct", "revenue_amount", "allocation_label", "allocation_basis"],
      rows: toTableRows(allocationRows),
    };
  }

  const splitRows = pack.split_evidence.map((split) => ({
    party_name: split.party_name ?? null,
    work_title: split.work_title ?? null,
    share_pct: split.share_pct ?? null,
    canonical_rights_stream: split.canonical_rights_stream ?? null,
    source_rights_code: split.source_rights_code ?? null,
    review_status: split.review_status ?? null,
    confidence: split.confidence ?? null,
  }));
  if (splitRows.length > 0) {
    return {
      columns: ["party_name", "work_title", "share_pct", "canonical_rights_stream", "source_rights_code", "review_status", "confidence"],
      rows: toTableRows(splitRows),
    };
  }

  const revenueRows = pack.revenue_evidence.map((revenue) => ({
    work_title: revenue.work_title ?? revenue.recording_title ?? null,
    net_revenue: revenue.net_revenue ?? null,
    gross_revenue: revenue.gross_revenue ?? null,
    currency: revenue.currency ?? null,
    rights_stream: revenue.rights_stream ?? null,
    platform: revenue.platform ?? null,
    territory: revenue.territory ?? null,
  }));
  if (revenueRows.length > 0) {
    return {
      columns: ["work_title", "net_revenue", "gross_revenue", "currency", "rights_stream", "platform", "territory"],
      rows: toTableRows(revenueRows),
    };
  }

  return undefined;
}

function buildEvidencePackFallbackAnswer(pack: EvidencePack): { title: string; text: string; why: string; kpis: Array<{ label: string; value: string }> } {
  const kpis = [
    { label: "Revenue facts", value: String(pack.revenue_evidence.length) },
    { label: "Split facts", value: String(pack.split_evidence.length + pack.rights_evidence.length) },
    { label: "Allocations", value: String(pack.computed_allocations.length) },
  ];

  if (pack.computed_allocations.length > 0) {
    const top = pack.computed_allocations[0];
    const amount = `${top.currency ?? ""} ${top.allocation_amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`.trim();
    return {
      title: "Estimated Allocation",
      text: `${top.party_name} is linked to an ${top.allocation_label.replace(/_/g, " ")} of ${amount} for ${top.work_title ?? "the matched work"}, based on ${top.allocation_basis}.`,
      why: pack.answer_constraints.length > 0
        ? pack.answer_constraints.join(" ")
        : "The allocation is calculated from matched revenue and rights evidence; the model is only explaining the computed evidence.",
      kpis,
    };
  }

  const missingRevenue = pack.missing_evidence.some((item) => item.evidence_class === "revenue_evidence");
  const missingSplit = pack.missing_evidence.some((item) => item.evidence_class === "split_evidence");

  if (missingRevenue && pack.split_evidence.length + pack.rights_evidence.length > 0) {
    return {
      title: "Split Evidence Found, Revenue Missing",
      text: "I found split or rights evidence for this question, but there is no matching revenue evidence in the selected scope, so I cannot compute an allocation.",
      why: pack.answer_constraints.join(" "),
      kpis,
    };
  }

  if (missingSplit && pack.revenue_evidence.length > 0) {
    return {
      title: "Revenue Found, Split Evidence Missing",
      text: "I found revenue evidence for this question, but there is no matching split or rights evidence, so I cannot compute what the person should receive.",
      why: pack.answer_constraints.join(" "),
      kpis,
    };
  }

  return {
    title: "Evidence Pack Built",
    text: pack.missing_evidence.length > 0
      ? `I could not complete the answer because ${pack.missing_evidence.map((item) => item.reason).join(" ")}`
      : "I gathered the available rights and revenue evidence, but no deterministic allocation was produced.",
    why: pack.answer_constraints.join(" "),
    kpis,
  };
}

function evidencePackBlocks(pack: EvidencePack, title: string, text: string, table?: { columns: string[]; rows: Array<Record<string, string | number | null>> }) {
  const blocks: Array<Record<string, unknown>> = [{
    id: "direct-answer",
    type: "direct_answer",
    priority: 1,
    source: "workspace_data",
    payload: { title, text },
  }];

  if (table && table.rows.length > 0) {
    blocks.push({
      id: "evidence-pack-table",
      type: "table",
      priority: 4,
      source: "workspace_data",
      title: pack.computed_allocations.length > 0 ? "Allocation Basis" : "Evidence Used",
      payload: table,
    });
  }

  if (pack.quality_flags.length > 0 || pack.missing_evidence.length > 0) {
    blocks.push({
      id: "evidence-quality",
      type: "risk_flags",
      priority: 8,
      source: "workspace_data",
      title: "Evidence Limits",
      payload: {
        items: [
          ...pack.missing_evidence.map((item) => item.reason),
          ...pack.quality_flags.map((flag) => flag.message),
        ],
      },
    });
  }

  if (pack.source_documents.length > 0) {
    blocks.push({
      id: "citations",
      type: "citations",
      priority: 9,
      source: "workspace_data",
      title: "Sources",
      payload: {
        items: pack.source_documents.slice(0, 8).map((source, index) => ({
          title: asString(source.file_name) ?? asString(source.source_reference) ?? `Source ${index + 1}`,
          publisher: asString(source.cmo_name) ?? asString(source.source_system) ?? undefined,
          source_type: "workspace_data",
        })),
      },
    });
  }

  return blocks;
}

type SqlEvidenceJobResult = {
  job_id: string;
  purpose: string;
  requirement: "required" | "supporting" | "optional";
  required_for_answer: boolean;
  analysis_plan: AnalysisPlan;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
  row_count: number;
  chosen_columns: string[];
  verifier_status: "passed" | "failed";
  warnings: string[];
  error?: string;
};

function evidencePackCaveats(pack: EvidencePack | null): string[] {
  if (!pack) return [];
  return unique([
    ...pack.answer_constraints,
    ...pack.missing_evidence.map((item) => item.reason),
    ...pack.quality_flags.map((flag) => flag.message),
  ]).slice(0, 6);
}

function buildEvidenceBundle(args: {
  multiEvidencePlan: MultiEvidencePlan;
  sqlJobs: SqlEvidenceJobResult[];
  evidencePack: EvidencePack | null;
}) {
  return {
    multi_evidence_plan: args.multiEvidencePlan,
    sql_evidence_jobs: args.sqlJobs.map((job) => ({
      job_id: job.job_id,
      purpose: job.purpose,
      requirement: job.requirement,
      required_for_answer: job.required_for_answer,
      row_count: job.row_count,
      columns: job.columns,
      rows: job.rows.slice(0, 12),
      chosen_columns: job.chosen_columns,
      verifier_status: job.verifier_status,
      warnings: job.warnings,
      error: job.error,
    })),
    structured_sidecar_evidence: args.evidencePack
      ? {
        question_family: args.evidencePack.question_family,
        revenue_fact_count: args.evidencePack.revenue_evidence.length,
        split_fact_count: args.evidencePack.split_evidence.length,
        rights_fact_count: args.evidencePack.rights_evidence.length,
        allocation_count: args.evidencePack.computed_allocations.length,
        source_document_count: args.evidencePack.source_documents.length,
        missing_evidence: args.evidencePack.missing_evidence,
        caveats: evidencePackCaveats(args.evidencePack),
      }
      : null,
  };
}

async function executeSupportingSqlEvidenceJobs(args: {
  jobs: SqlEvidenceJob[];
  catalog: ArtistCatalog;
  config: AssistantRuntimeConfig;
  userClient: any;
  scope: RuntimeScope;
  fromDate: string;
  toDate: string;
  question: string;
}): Promise<SqlEvidenceJobResult[]> {
  const results: SqlEvidenceJobResult[] = [];
  for (const job of args.jobs.slice(0, 4)) {
    try {
      const compiled = compileSqlFromPlan(job.analysis_plan, args.catalog);
      const cleanedSql = validatePlannedSql(compiled.sql);
      const sqlResult = await args.config.runSql(args.userClient, args.scope, args.fromDate, args.toDate, cleanedSql);
      const columns = asArrayOfStrings(sqlResult.columns);
      const rows = sanitizeRows(sqlResult.rows);
      const verifier = verifyQueryResult({
        question: args.question,
        plan: job.analysis_plan,
        columns,
        rows: rows as Array<Record<string, unknown>>,
      });
      results.push({
        job_id: job.job_id,
        purpose: job.purpose,
        requirement: job.requirement,
        required_for_answer: job.required_for_answer,
        analysis_plan: job.analysis_plan,
        columns,
        rows: rows.slice(0, 25),
        row_count: Number(sqlResult.row_count ?? rows.length),
        chosen_columns: compiled.chosen_columns,
        verifier_status: verifier.status,
        warnings: verifier.warnings ?? [],
      });
    } catch (error) {
      results.push({
        job_id: job.job_id,
        purpose: job.purpose,
        requirement: job.requirement,
        required_for_answer: job.required_for_answer,
        analysis_plan: job.analysis_plan,
        columns: [],
        rows: [],
        row_count: 0,
        chosen_columns: [],
        verifier_status: "failed",
        warnings: [],
        error: error instanceof Error ? error.message : "SQL evidence job failed.",
      });
    }
  }
  return results;
}

async function defaultLogTurn(
  _adminClient: any | null,
  _payload: Record<string, unknown>,
) {
  // no-op
}

export function serveAssistantRuntime(config: AssistantRuntimeConfig) {
  const runtimePatch = config.runtimePatch ?? ASSISTANT_RUNTIME_PATCH;
  const logTurn = config.logTurn ?? defaultLogTurn;

  serve(async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? null;
      const signingSecret = Deno.env.get("INSIGHTS_SIGNING_SECRET") ?? null;
      const openAiKey = Deno.env.get("OPENAI_API_KEY") ?? null;
      const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
      if (!supabaseUrl || !anonKey) throw new Error("Required environment variables are missing.");

      const authHeader = req.headers.get("Authorization");
      if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) throw new Error("Missing bearer token.");
      const jwt = authHeader.slice(7).trim();
      const requesterId = parseJwtClaims(jwt)?.sub ?? parseJwtClaims(jwt)?.user_id;
      if (!requesterId) throw new Error("Unable to resolve authenticated user.");

      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const action = (asString(body.action) ?? "send_turn") as Action;
      if (!["send_turn", "plan_query", "run_query"].includes(action)) throw new Error("Unsupported action.");

      const scope = config.resolveScope(body);
      const question = asString(body.question);
      if ((action === "send_turn" || action === "plan_query") && !question) throw new Error("question is required.");

      const conversationId = asString(body.conversation_id) ?? crypto.randomUUID();
      const { fromDate, toDate } = normalizeDateRange(body.from_date, body.to_date);
      const scopeToken = computeScopeToken(config.mode, scope.scopeValue, fromDate, toDate);

      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
      const adminClient = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;
      const priorThreadState = await loadThreadState(adminClient, requesterId, conversationId);
      const scopeEpoch = priorThreadState ? (priorThreadState.scope_token === scopeToken ? priorThreadState.scope_epoch : priorThreadState.scope_epoch + 1) : 1;

      if (action === "run_query") {
        if (!signingSecret) throw new Error("INSIGHTS_SIGNING_SECRET is required for run_query.");
        const planId = asString(body.plan_id);
        const executionToken = asString(body.execution_token);
        const sqlPreview = asString(body.sql_preview);
        if (!planId || !executionToken || !sqlPreview) throw new Error("plan_id, execution_token, and sql_preview are required for run_query.");
        const verified = await verifyExecutionToken(signingSecret, executionToken);
        if (verified.user_id !== requesterId || verified.plan_id !== planId) throw new Error("Execution token mismatch.");
        if (verified.scope_mode !== config.mode || (verified.scope_value ?? null) !== (scope.scopeValue ?? null)) throw new Error("Execution token scope mismatch.");
        if (verified.from_date !== fromDate || verified.to_date !== toDate) throw new Error("Execution token date range mismatch.");
        const cleanedSql = validatePlannedSql(sqlPreview);
        if (cleanedSql !== verified.sql_preview) throw new Error("SQL does not match planned query.");

        const sqlResult = await config.runSql(userClient, scope, fromDate, toDate, cleanedSql);
        const columns = asArrayOfStrings(sqlResult.columns);
        const rows = sanitizeRows(sqlResult.rows);
        const evidence = toEvidence(sqlResult, fromDate, toDate, config.sqlSourceRef);
        const verifier = verifyQueryResult({ question: verified.question, plan: undefined, columns, rows: rows as Array<Record<string, unknown>> });
        if (verifier.status === "failed") {
          return new Response(JSON.stringify({ error: "Insufficient data for verified query response.", detail: verifier.reason, diagnostics: { verifier_status: verifier.status, insufficiency_reason: verifier.reason, stage: "verify" } }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({
          answer_title: `Verified ${config.scopeLabel} Result`,
          answer_text: `Verified result generated from ${evidence.row_count} row(s).`,
          kpis: [],
          table: rows.length > 0 ? { columns, rows: rows.slice(0, 20) } : undefined,
          chart: { type: "none", x: "", y: [] },
          evidence,
          follow_up_questions: [],
          diagnostics: { verifier_status: verifier.status, insufficiency_reason: null, stage: "verify" },
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const catalog = await config.fetchCatalog(userClient, scope, fromDate, toDate);
      const constraints = parseConstraints(question!, priorThreadState?.constraints);
      const registrySubset = filterRelevantColumns(buildColumnRegistry(catalog), question!, constraints);
      const { plan, plan_source, column_requirements, sql_intent } = await buildPlan({
        question: question!,
        catalog,
        columnRegistrySubset: registrySubset,
        priorThreadState,
        constraints,
        openAiKey,
        model,
      });
      const resolvedScope = { mode: config.mode, entity_context: scope.entityContext, from_date: fromDate, to_date: toDate, scope_token: scopeToken, scope_epoch: scopeEpoch };
      const requiredColumns = unique(column_requirements.required);
      const catalogFields = new Set(catalog.columns.map((c) => c.field_key.toLowerCase()));
      const missingFields = unique([...column_requirements.missing_requested, ...requiredColumns.filter((field) => !catalogFields.has(field.toLowerCase()))]);
      const multiEvidencePlan = planAnswerEvidence({
        question: question!,
        catalog,
        mode: config.mode,
        primaryPlan: plan,
      });

      if (catalog.total_rows <= 0) {
        return new Response(JSON.stringify({
          conversation_id: conversationId,
          answer_title: "Insufficient Data",
          answer_text: "",
          why_this_matters: "",
          kpis: [],
          chart: { type: "none", x: "", y: [] },
          evidence: { row_count: 0, duration_ms: 0, from_date: fromDate, to_date: toDate, provenance: [config.catalogProvenance] },
          follow_up_questions: [],
          diagnostics: { intent: plan.intent, confidence: plan.confidence, used_fields: unique([...plan.dimensions, ...plan.metrics, ...plan.filters.map((f) => f.column)]), missing_fields: [], strict_mode: true, analysis_plan: plan, required_columns: requiredColumns, top_n: plan.top_n, sort_by: plan.sort_by, sort_dir: plan.sort_dir, verifier_status: "failed", insufficiency_reason: "zero_scope_rows", stage: "verify" },
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "plan_query" && missingFields.length > 0) {
        return new Response(JSON.stringify({
          error: "Insufficient data for this question.",
          detail: `Missing fields: ${missingFields.join(", ")}`,
          diagnostics: { analysis_plan: plan, required_columns: requiredColumns, missing_fields: missingFields, column_requirements, top_n: plan.top_n, sort_by: plan.sort_by, sort_dir: plan.sort_dir, verifier_status: "failed", insufficiency_reason: "required_columns_missing", strict_mode: true, stage: "plan" },
        }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (action === "plan_query") {
        if (!signingSecret) throw new Error("INSIGHTS_SIGNING_SECRET is required for plan_query.");
        const compiled = compileSqlFromPlan(plan, catalog);
        const sqlPreview = validatePlannedSql(compiled.sql);
        const expiresAt = new Date(Date.now() + PLAN_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
        const planId = crypto.randomUUID();
        const executionToken = await signExecutionToken(signingSecret, { plan_id: planId, user_id: requesterId, scope_mode: config.mode, scope_value: scope.scopeValue, from_date: fromDate, to_date: toDate, sql_preview: sqlPreview, question: question!, expires_at: expiresAt });
        return new Response(JSON.stringify({
          plan_id: planId,
          understood_question: question,
          sql_preview: sqlPreview,
          expected_columns: unique([...plan.dimensions, ...plan.metrics]),
          multi_evidence_plan: multiEvidencePlan,
          sql_evidence_jobs: multiEvidencePlan.sql_jobs.map((job) => ({
            job_id: job.job_id,
            purpose: job.purpose,
            requirement: job.requirement,
            required_for_answer: job.required_for_answer,
            expected_columns: unique([...job.analysis_plan.dimensions, ...job.analysis_plan.metrics]),
          })),
          execution_token: executionToken,
          expires_at: expiresAt,
          diagnostics: { analysis_plan: plan, multi_evidence_plan: multiEvidencePlan, required_columns: requiredColumns, chosen_columns: compiled.chosen_columns, column_requirements, top_n: plan.top_n, sort_by: plan.sort_by, sort_dir: plan.sort_dir, verifier_status: "pending", insufficiency_reason: null, strict_mode: true, compiler_source: plan_source, stage: "compile", legacy_sql_planner_used: true },
          safety: { read_only: true, row_limit: SQL_ROW_LIMIT, timeout_ms: SQL_TIMEOUT_MS, [config.safetyFlag]: true },
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const compiled = compileSqlFromPlan(plan, catalog);
      const cleanedSql = validatePlannedSql(compiled.sql);
      const sqlResult = await config.runSql(userClient, scope, fromDate, toDate, cleanedSql);
      const columns = asArrayOfStrings(sqlResult.columns);
      const rows = sanitizeRows(sqlResult.rows);
      const evidence = toEvidence(sqlResult, fromDate, toDate, config.sqlSourceRef);
      const verifier = verifyQueryResult({ question: question!, plan, columns, rows: rows as Array<Record<string, unknown>> });
      if (verifier.status === "failed" && rows.length === 0) {
        return new Response(JSON.stringify({
          conversation_id: conversationId,
          answer_title: "Insufficient Data",
          answer_text: "",
          why_this_matters: "",
          kpis: [],
          chart: { type: "none", x: "", y: [] },
          evidence: { row_count: 0, duration_ms: 0, from_date: fromDate, to_date: toDate, provenance: [config.catalogProvenance] },
          follow_up_questions: [],
          diagnostics: { intent: plan.intent, confidence: plan.confidence, used_fields: unique([...plan.dimensions, ...plan.metrics, ...plan.filters.map((f) => f.column)]), missing_fields: missingFields, strict_mode: true, analysis_plan: plan, required_columns: requiredColumns, top_n: plan.top_n, sort_by: plan.sort_by, sort_dir: plan.sort_dir, verifier_status: "failed", insufficiency_reason: verifier.reason ?? "no_rows_returned", stage: "verify" },
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const primarySqlJob: SqlEvidenceJobResult = {
        job_id: "primary",
        purpose: "answer the main revenue question",
        requirement: "required",
        required_for_answer: true,
        analysis_plan: plan,
        columns,
        rows: rows.slice(0, 25),
        row_count: evidence.row_count,
        chosen_columns: compiled.chosen_columns,
        verifier_status: verifier.status,
        warnings: verifier.warnings ?? [],
      };
      const supportingSqlJobs = await executeSupportingSqlEvidenceJobs({
        jobs: multiEvidencePlan.sql_jobs.filter((job) => job.job_id !== "primary"),
        catalog,
        config,
        userClient,
        scope,
        fromDate,
        toDate,
        question: question!,
      });
      let evidencePack: EvidencePack | null = null;
      if (config.runEvidencePlan && multiEvidencePlan.sidecar_jobs.length > 0) {
        try {
          const evidencePlan = planEvidence({
            question: question!,
            from_date: fromDate,
            to_date: toDate,
            scope_mode: config.mode,
            entity_context: scope.entityContext,
          });
          evidencePack = await config.runEvidencePlan(userClient, scope, fromDate, toDate, evidencePlan);
        } catch {
          evidencePack = null;
        }
      }
      const sqlEvidenceJobs = [primarySqlJob, ...supportingSqlJobs];
      const evidenceBundle = buildEvidenceBundle({ multiEvidencePlan, sqlJobs: sqlEvidenceJobs, evidencePack });
      const sidecarCaveats = evidencePackCaveats(evidencePack);

      let synthesized: { answer_title?: string; answer_text?: string; why_this_matters?: string; kpis?: unknown; chart?: { type?: "bar" | "line" | "none"; x?: string; y?: string[]; title?: string }; follow_up_questions?: string[] } | null = null;
      if (openAiKey) {
        try {
          synthesized = await callOpenAiJson({
            apiKey: openAiKey,
            model,
            systemPrompt: [
              "You are a music royalty analytics assistant.",
              "Use the SQL evidence jobs as the primary facts and the structured sidecar evidence only as supporting context.",
              "Do not let missing rights, splits, documents, or external context collapse an answer that is supported by SQL revenue evidence.",
              "If sidecar evidence is missing, add one short caveat and still answer from the available evidence.",
              "Return JSON with answer_title, answer_text, why_this_matters, kpis, chart, follow_up_questions.",
            ].join(" "),
            userPrompt: JSON.stringify({
              question,
              result: { columns, rows: rows.slice(0, 25), row_count: evidence.row_count },
              evidence_bundle: evidenceBundle,
            }),
          });
        } catch {
          synthesized = null;
        }
      }

      const quality = evaluateQualityOutcome({ constraints, rows, evidence, missingRequested: column_requirements.missing_requested });
      const answerTitle = asString(synthesized?.answer_title) ?? `Verified ${config.scopeLabel} Answer`;
      const answerText = quality.quality_outcome === "clarify" && quality.clarification
        ? quality.clarification.question
        : asString(synthesized?.answer_text) ?? (evidence.row_count === 0 ? `No rows matched this question in the current ${config.scopeLabel.toLowerCase()} scope.` : `Top row returned with ${evidence.row_count} verified row(s).`);
      const whyThisMatters = quality.quality_outcome === "clarify" && quality.clarification
        ? quality.clarification.reason
        : (asString(synthesized?.why_this_matters) ?? (quality.quality_outcome === "constrained" ? "Evidence is currently constrained; treat this as directional until data sufficiency improves." : ""));
      const kpis = sanitizeKpis(synthesized?.kpis);
      const claims = buildClaimsFromRows(columns, rows.slice(0, 25), config.sqlSourceRef);
      const unknowns = unique([...quality.unknowns, ...sidecarCaveats]);
      const answerBlocks = buildAnswerBlocks({ title: answerTitle, text: answerText, why: whyThisMatters, kpis, columns, rows: rows.slice(0, 25), claims, unknowns, clarification: quality.clarification, quality_outcome: quality.quality_outcome });
      const evidenceMap = Object.fromEntries(answerBlocks.filter((b) => typeof b.id === "string").map((b) => [String(b.id), "workspace_data"]));
      const chart = (() => {
        const proposed = synthesized?.chart;
        const chartType = proposed?.type === "bar" || proposed?.type === "line" || proposed?.type === "none" ? proposed.type : "none";
        if (chartType === "none") return { type: "none" as const, x: "", y: [], title: undefined };
        const x = asString(proposed?.x);
        const y = asArrayOfStrings(proposed?.y);
        return x && y.length > 0 && columns.includes(x) && y.every((col) => columns.includes(col))
          ? { type: chartType, x, y, title: asString(proposed?.title) ?? undefined }
          : { type: "none" as const, x: "", y: [], title: undefined };
      })();

      await saveThreadState(adminClient, requesterId, {
        conversation_id: conversationId,
        scope_token: scopeToken,
        scope_epoch: scopeEpoch,
        intent: sql_intent,
        constraints: { platform: constraints.platform, territory: constraints.territory, requested_granularity: constraints.requested_granularity },
        selected_columns: compiled.chosen_columns,
        missing_columns: missingFields,
        clarification: quality.clarification ? { pending: true, reason: quality.clarification.reason, question: quality.clarification.question, options: quality.clarification.options } : { pending: false },
      });
      await logTurn(adminClient, {
        user_id: requesterId,
        ...(config.scopeField && scope.scopeValue ? { [config.scopeField]: scope.scopeValue } : {}),
        question,
        analysis_plan: plan,
        required_columns: requiredColumns,
        chosen_columns: compiled.chosen_columns,
        sql_text: cleanedSql,
        sql_hash: stableHash(cleanedSql),
        row_count: evidence.row_count,
        verifier_status: verifier.status,
        insufficiency_reason: null,
        final_answer_meta: { conversation_id: conversationId, answer_title: answerTitle, kpi_count: kpis.length, row_count: evidence.row_count, top_row: rows[0] ?? null },
      });

      return new Response(JSON.stringify({
        conversation_id: conversationId,
        runtime_patch: runtimePatch,
        answer_title: answerTitle,
        answer_text: answerText,
        why_this_matters: whyThisMatters,
        kpis,
        table: rows.length > 0 ? { columns, rows: rows.slice(0, 25) } : undefined,
        chart,
        evidence,
        evidence_pack: evidencePack ?? undefined,
        evidence_bundle: evidenceBundle,
        follow_up_questions: asArrayOfStrings(synthesized?.follow_up_questions).slice(0, 3),
        quality_outcome: quality.quality_outcome,
        clarification: quality.clarification,
        resolved_scope: resolvedScope,
        plan_trace: { intent: sql_intent, selected_columns: compiled.chosen_columns, missing_columns: missingFields, column_requirements, constraints, multi_evidence_plan: multiEvidencePlan, evidence_pack_missing: evidencePack?.missing_evidence ?? [] },
        claims,
        answer_blocks: answerBlocks,
        render_hints: { layout: "adaptive_card_stack", density: quality.quality_outcome === "pass" ? "expanded" : "compact", visual_preference: chart.type === "none" ? "table" : "chart", show_confidence_badges: true },
        evidence_map: evidenceMap,
        unknowns,
        diagnostics: { intent: plan.intent, confidence: verifier.status === "passed" ? plan.confidence : "low", used_fields: unique([...plan.dimensions, ...plan.metrics, ...plan.filters.map((f) => f.column)]), missing_fields: missingFields, strict_mode: false, analysis_plan: plan, multi_evidence_plan: multiEvidencePlan, sql_evidence_jobs: evidenceBundle.sql_evidence_jobs, evidence_sidecar_used: evidencePack !== null, evidence_gap_policy: multiEvidencePlan.missing_evidence_policy, legacy_sql_planner_used: true, column_requirements, required_columns: requiredColumns, chosen_columns: compiled.chosen_columns, top_n: plan.top_n, sort_by: plan.sort_by, sort_dir: plan.sort_dir, verifier_status: verifier.status, insufficiency_reason: null, compiler_source: plan_source, stage: "verify" },
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } catch (error) {
      return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error", _fatal: true }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  });
}
