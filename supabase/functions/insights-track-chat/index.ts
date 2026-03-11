import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  AnalysisPlan,
  ArtistCatalog,
  buildCatalog,
  compileSqlFromPlan,
  deriveAnalysisPlanFallback,
  validatePlannedSql,
  verifyQueryResult,
} from "./query_engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PLAN_TOKEN_TTL_MINUTES = 15;
const SQL_ROW_LIMIT = 200;
const SQL_TIMEOUT_MS = 4000;

type Action = "plan_query" | "run_query" | "send_turn";

type PlanTokenPayload = {
  plan_id: string;
  user_id: string;
  track_key: string;
  from_date: string;
  to_date: string;
  sql_preview: string;
  question: string;
  expires_at: string;
};

type SqlExecutionResponse = {
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  row_count?: number;
  duration_ms?: number;
  query_provenance?: string[];
  applied_scope?: {
    track_key?: string;
    from_date?: string;
    to_date?: string;
    row_limit?: number;
    timeout_ms?: number;
  };
};

type AssistantSynthesisResponse = {
  answer_title?: string;
  answer_text?: string;
  why_this_matters?: string;
  kpis?: Array<{ label?: string; value?: string; change?: string }>;
  chart?: { type?: "bar" | "line" | "none"; x?: string; y?: string[]; title?: string };
  follow_up_questions?: string[];
};

type AnalysisPlanModelResponse = Partial<{
  intent: string;
  metrics: string[];
  dimensions: string[];
  filters: Array<{ column: string; op: "=" | "in" | "contains"; value: string | string[] }>;
  grain: "none" | "day" | "week" | "month" | "quarter";
  time_window: "explicit" | "implicit";
  confidence: "high" | "medium" | "low";
  required_columns: string[];
  top_n: number;
  sort_by: string;
  sort_dir: "asc" | "desc";
}>;

type ScopeMode = "track";

type ResolvedScope = {
  mode: ScopeMode;
  entity_context: { track_key: string };
  from_date: string;
  to_date: string;
  scope_token: string;
  scope_epoch: number;
};

type ThreadState = {
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

type ColumnCapability = {
  field_key: string;
  aliases: string[];
  semantic_type: "money" | "rate" | "dimension" | "date" | "id" | "text" | "count";
  allowed_ops: Array<"group" | "filter" | "sort" | "aggregate">;
  quality_hints: {
    coverage_pct: number;
    confidence: "high" | "medium" | "low";
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

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asArrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter((item): item is string => !!item);
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
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function signExecutionToken(secret: string, payload: PlanTokenPayload): Promise<string> {
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const signature = await hmacHex(secret, payloadB64);
  return `${payloadB64}.${signature}`;
}

async function verifyExecutionToken(secret: string, token: string): Promise<PlanTokenPayload> {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) throw new Error("Invalid execution token format.");
  const expectedSig = await hmacHex(secret, payloadB64);
  if (!timingSafeEqual(expectedSig, signature)) throw new Error("Invalid execution token signature.");
  const payloadText = fromBase64Url(payloadB64);
  const payload = JSON.parse(payloadText) as PlanTokenPayload;
  const expiresAt = new Date(payload.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
    throw new Error("Execution token expired.");
  }
  return payload;
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  let depth = 0;
  let start = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) return trimmed.slice(start, i + 1);
    }
  }
  throw new Error("Model did not return valid JSON.");
}

async function callOpenAiJson<T>({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
}: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<T> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`OpenAI error (${resp.status}): ${body}`);
  }

  const payload = await resp.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenAI response missing content.");
  return JSON.parse(extractJsonObject(content)) as T;
}

function sanitizeCell(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(value);
}

function sanitizeRows(rows: unknown): Array<Record<string, string | number | null>> {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      const out: Record<string, string | number | null> = {};
      for (const [k, v] of Object.entries(row as Record<string, unknown>)) out[k] = sanitizeCell(v);
      return out;
    })
    .filter((row): row is Record<string, string | number | null> => !!row);
}

function sanitizeColumns(columns: unknown): string[] {
  return asArrayOfStrings(columns);
}

function sanitizeKpis(input: unknown): Array<{ label: string; value: string; change?: string }> {
  if (!Array.isArray(input)) return [];
  return input
    .map((kpi) => {
      if (!kpi || typeof kpi !== "object" || Array.isArray(kpi)) return null;
      const record = kpi as Record<string, unknown>;
      const label = asString(record.label);
      const value = asString(record.value);
      if (!label || !value) return null;
      const change = asString(record.change);
      if (!change) return { label, value };
      return { label, value, change };
    })
    .filter((kpi): kpi is { label: string; value: string; change?: string } => kpi !== null)
    .slice(0, 6);
}

function toEvidence(sqlResult: SqlExecutionResponse, fromDate: string, toDate: string) {
  return {
    row_count: Number(sqlResult.row_count ?? 0),
    duration_ms: Number(sqlResult.duration_ms ?? 0),
    from_date: asString(sqlResult.applied_scope?.from_date) ?? fromDate,
    to_date: asString(sqlResult.applied_scope?.to_date) ?? toDate,
    provenance: Array.isArray(sqlResult.query_provenance)
      ? sqlResult.query_provenance.filter((item) => typeof item === "string")
      : ["run_track_chat_sql_v2"],
  };
}

function stableHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

function inferSemanticType(fieldKey: string, inferred: string): ColumnCapability["semantic_type"] {
  if (/(_id|^id$|_key$|isrc|iswc)/i.test(fieldKey)) return "id";
  if (/date|period/i.test(fieldKey) || inferred === "date") return "date";
  if (/revenue|gross|net|commission|amount|payout/i.test(fieldKey)) return "money";
  if (/pct|percent|ratio|rate|confidence|share|trend|growth/i.test(fieldKey)) return "rate";
  if (/qty|quantity|count|rows?/i.test(fieldKey)) return "count";
  if (/territory|platform|usage|artist|track|currency/i.test(fieldKey)) return "dimension";
  if (inferred === "number") return "count";
  return "text";
}

function defaultAllowedOps(semantic: ColumnCapability["semantic_type"]): ColumnCapability["allowed_ops"] {
  if (semantic === "money" || semantic === "rate" || semantic === "count") return ["aggregate", "sort", "filter"];
  if (semantic === "date") return ["group", "sort", "filter"];
  return ["group", "filter", "sort"];
}

function confidenceFromCoverage(coverage: number): "high" | "medium" | "low" {
  if (coverage >= 80) return "high";
  if (coverage >= 45) return "medium";
  return "low";
}

function buildColumnRegistry(catalog: ArtistCatalog): ColumnCapability[] {
  return catalog.columns.map((c) => {
    const semantic = inferSemanticType(c.field_key, String(c.inferred_type ?? "text"));
    return {
      field_key: c.field_key,
      aliases: c.aliases ?? [],
      semantic_type: semantic,
      allowed_ops: defaultAllowedOps(semantic),
      quality_hints: {
        coverage_pct: Number(c.coverage_pct ?? 0),
        confidence: confidenceFromCoverage(Number(c.coverage_pct ?? 0)),
      },
    };
  });
}

function parseConstraints(question: string, prior?: ThreadState["constraints"]): QueryConstraints {
  const q = question.toLowerCase();
  const platform: string[] = [];
  const territory: string[] = [];
  const platformMap: Array<[RegExp, string]> = [
    [/\bspotify\b/i, "spotify"],
    [/\bapple\b/i, "apple music"],
    [/\byoutube\b/i, "youtube"],
    [/\bamazon\b/i, "amazon"],
    [/\btidal\b/i, "tidal"],
    [/\bdeezer\b/i, "deezer"],
  ];
  for (const [pattern, value] of platformMap) {
    if (pattern.test(question)) platform.push(value);
  }
  const territoryMatches = question.match(/\b([A-Z]{2})\b/g) ?? [];
  for (const t of territoryMatches) territory.push(t.toUpperCase());

  const asksCity = /\bcity|cities|berlin|lagos|london|new york|paris\b/i.test(question);
  const asksPlatform = /\bplatform|dsp|service|spotify|apple|youtube|amazon|tidal|deezer\b/i.test(question);
  const asksTerritory = /\bterritory|country|market|region|geo\b/i.test(question);
  const asksTrack = /\btrack|song|title|isrc\b/i.test(question);

  return {
    platform: unique([...(prior?.platform ?? []), ...platform]),
    territory: unique([...(prior?.territory ?? []), ...territory]),
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
  if (/\brevenue|earning|money|royalt|gross|net\b/.test(q)) {
    required.add("net_revenue");
    required.add("gross_revenue");
  }
  if (constraints.asks_platform || constraints.platform.length > 0) required.add("platform");
  if (constraints.asks_territory || constraints.territory.length > 0) required.add("territory");
  if (/\btrend|month|week|day|growth|over time\b/.test(q)) required.add("event_date");
  if (constraints.asks_track) required.add("track_title");
  if (required.size === 0) {
    return registry.slice(0, 14);
  }
  const subset = registry.filter((r) => required.has(r.field_key) || r.aliases.some((a) => q.includes(a.toLowerCase())));
  return subset.length > 0 ? subset.slice(0, 20) : registry.slice(0, 14);
}

function computeScopeToken(trackKey: string, fromDate: string, toDate: string): string {
  return `track:${stableHash(`${trackKey}:${fromDate}:${toDate}`)}`;
}

async function loadThreadState(
  adminClient: any | null,
  userId: string,
  conversationId: string,
): Promise<ThreadState | null> {
  if (!adminClient) return null;
  try {
    const { data, error } = await adminClient
      .from("ai_track_thread_state_v1")
      .select("conversation_id,scope_token,scope_epoch,state_json")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (error || !data) return null;
    const dataRow = data as Record<string, unknown>;
    const state = (dataRow.state_json ?? {}) as Record<string, unknown>;
    return {
      conversation_id: asString(dataRow.conversation_id) ?? conversationId,
      scope_token: asString(dataRow.scope_token) ?? "",
      scope_epoch: Number(dataRow.scope_epoch ?? 1),
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

async function saveThreadState(
  adminClient: any | null,
  userId: string,
  state: ThreadState,
): Promise<void> {
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

function buildClaimsFromRows(columns: string[], rows: Array<Record<string, string | number | null>>): Array<Record<string, unknown>> {
  if (rows.length === 0) return [];
  const top = rows[0];
  const claims: Array<Record<string, unknown>> = [];
  for (const key of columns.slice(0, 6)) {
    if (!(key in top)) continue;
    claims.push({
      claim_id: `${key}_${stableHash(String(top[key] ?? "null"))}`,
      text: `${key}: ${String(top[key] ?? "null")}`,
      supporting_fields: [key],
      source_ref: "run_track_chat_sql_v2",
    });
  }
  return claims;
}

function detectPlatformValues(rows: Array<Record<string, string | number | null>>): string[] {
  const values = new Set<string>();
  for (const row of rows) {
    const raw = row.platform;
    if (typeof raw === "string" && raw.trim().length > 0) values.add(raw.trim().toLowerCase());
  }
  return Array.from(values);
}

function evaluateQualityOutcome({
  constraints,
  rows,
  evidence,
  verifierWarnings,
  missingRequested,
}: {
  constraints: QueryConstraints;
  rows: Array<Record<string, string | number | null>>;
  evidence: { row_count: number };
  verifierWarnings: string[];
  missingRequested: string[];
}): {
  quality_outcome: "pass" | "clarify" | "constrained";
  clarification?: { question: string; reason: string; options?: string[] };
  unknowns: string[];
} {
  const unknowns: string[] = [];
  if (missingRequested.length > 0) {
    return {
      quality_outcome: "clarify",
      clarification: {
        question: `I can answer this better if you confirm the closest available dimension. Do you want this by ${missingRequested.join(", ")} or by available territory/platform?`,
        reason: `Requested dimensions are unavailable: ${missingRequested.join(", ")}`,
        options: ["territory", "platform", "track_title"],
      },
      unknowns: [`Missing requested columns: ${missingRequested.join(", ")}`],
    };
  }

  if (constraints.platform.length > 0) {
    const platforms = detectPlatformValues(rows);
    const hasMatch = constraints.platform.some((wanted) => platforms.some((p) => p.includes(wanted)));
    if (!hasMatch) {
      return {
        quality_outcome: "clarify",
        clarification: {
          question: "Your question is platform-specific, but current scoped data does not include that platform. Should I answer using all available platforms or change platform scope?",
          reason: `Platform mismatch. Requested ${constraints.platform.join(", ")} but found ${platforms.join(", ") || "none"}.`,
          options: ["use available platforms", "change platform", "broaden date range"],
        },
        unknowns: [`Platform mismatch for requested ${constraints.platform.join(", ")}`],
      };
    }
  }

  if (constraints.asks_city) {
    return {
      quality_outcome: "clarify",
      clarification: {
        question: "I currently have territory-level data, not city-level fields. Should I proceed with territory-level recommendations, then enrich to city suggestions externally?",
        reason: "City granularity requested but no city field in scoped dataset.",
        options: ["proceed with territory", "change question", "broaden scope"],
      },
      unknowns: ["City-level granularity unavailable in current track schema."],
    };
  }

  if (evidence.row_count < 3) {
    unknowns.push("Low row count can reduce decision confidence.");
    return {
      quality_outcome: "constrained",
      unknowns,
    };
  }
  if (verifierWarnings.length > 0) {
    unknowns.push(...verifierWarnings.slice(0, 3));
  }
  return {
    quality_outcome: "pass",
    unknowns,
  };
}

function buildAdaptiveAnswerBlocks({
  answerTitle,
  answerText,
  whyThisMatters,
  kpis,
  columns,
  previewRows,
  claims,
  qualityOutcome,
  clarification,
  unknowns,
}: {
  answerTitle: string;
  answerText: string;
  whyThisMatters: string;
  kpis: Array<{ label: string; value: string; change?: string }>;
  columns: string[];
  previewRows: Array<Record<string, string | number | null>>;
  claims: Array<Record<string, unknown>>;
  qualityOutcome: "pass" | "clarify" | "constrained";
  clarification?: { question: string; reason: string; options?: string[] };
  unknowns: string[];
}): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [
    {
      id: "direct-answer",
      type: "direct_answer",
      priority: 1,
      source: "workspace_data",
      payload: { title: answerTitle, text: answerText },
    },
  ];
  if (qualityOutcome === "clarify" && clarification) {
    blocks.push({
      id: "clarification",
      type: "scenario_options",
      priority: 2,
      source: "workspace_data",
      payload: {
        items: (clarification.options ?? []).map((opt) => ({ action: opt, rationale: clarification.reason })),
        question: clarification.question,
      },
    });
  } else {
    if (whyThisMatters) {
      blocks.push({
        id: "deep-summary",
        type: "deep_summary",
        priority: 2,
        source: "workspace_data",
        payload: { text: whyThisMatters },
      });
    }
    if (kpis.length > 0) {
      blocks.push({
        id: "kpi-strip",
        type: "kpi_strip",
        priority: 3,
        source: "workspace_data",
        payload: { items: kpis },
      });
    }
    if (previewRows.length > 0) {
      blocks.push({
        id: "table-main",
        type: "table",
        priority: 4,
        source: "workspace_data",
        payload: { columns, rows: previewRows },
      });
    }
  }
  if (unknowns.length > 0) {
    blocks.push({
      id: "risk-flags",
      type: "risk_flags",
      priority: 8,
      source: "workspace_data",
      payload: { items: unknowns },
    });
  }
  blocks.push({
    id: "citations",
    type: "citations",
    priority: 9,
    source: "workspace_data",
    payload: { items: claims.map((c) => ({ title: String(c.source_ref ?? "run_track_chat_sql_v2"), claim_ids: [String(c.claim_id ?? "")], source_type: "workspace_data" })) },
  });
  return blocks;
}

async function maybeRunExternalAssessment({
  question,
  topRows,
}: {
  question: string;
  topRows: Array<Record<string, string | number | null>>;
}): Promise<{ notes: string; citations: Array<Record<string, unknown>> } | null> {
  const searchUrl = Deno.env.get("WEB_SEARCH_API_URL") ?? null;
  const searchKey = Deno.env.get("WEB_SEARCH_API_KEY") ?? null;
  if (!searchUrl || !searchKey || topRows.length === 0) return null;
  try {
    const anchors = {
      territory: topRows[0].territory ?? null,
      platform: topRows[0].platform ?? null,
      track_title: topRows[0].track_title ?? null,
    };
    const resp = await fetch(searchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${searchKey}`,
      },
      body: JSON.stringify({
        question,
        anchors,
        max_results: 3,
      }),
    });
    if (!resp.ok) return null;
    const payload = (await resp.json()) as Record<string, unknown>;
    const notes = asString(payload.summary) ?? "External market context was retrieved.";
    const results = Array.isArray(payload.results) ? payload.results : [];
    const citations: Array<Record<string, unknown>> = results.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const row = item as Record<string, unknown>;
      return [{
        title: asString(row.title) ?? "External Source",
        url: asString(row.url) ?? undefined,
        source_type: "external",
        claim_ids: [stableHash(JSON.stringify(row))],
      }];
    });
    return { notes, citations };
  } catch {
    return null;
  }
}

function parseAnalysisPlanModel(input: AnalysisPlanModelResponse | null): AnalysisPlan | null {
  if (!input) return null;
  const intent = asString(input.intent) ?? "exploratory_analysis";
  const metrics = asArrayOfStrings(input.metrics).slice(0, 4);
  const dimensions = asArrayOfStrings(input.dimensions).slice(0, 4);
  const required = asArrayOfStrings(input.required_columns).slice(0, 8);
  const filtersRaw = Array.isArray(input.filters) ? input.filters : [];
  const filters = filtersRaw
    .map((f) => {
      if (!f || typeof f !== "object" || Array.isArray(f)) return null;
      const row = f as Record<string, unknown>;
      const column = asString(row.column);
      const op = asString(row.op);
      const value = row.value;
      if (!column || !op || (op !== "=" && op !== "in" && op !== "contains")) return null;
      if (op === "in" && !Array.isArray(value)) return null;
      if (op !== "in" && typeof value !== "string") return null;
      return { column, op, value: op === "in" ? asArrayOfStrings(value) : String(value) } as AnalysisPlan["filters"][number];
    })
    .filter((f): f is AnalysisPlan["filters"][number] => !!f)
    .slice(0, 4);
  const grain = input.grain === "day" || input.grain === "week" || input.grain === "month" || input.grain === "quarter" ? input.grain : "none";
  const confidence = input.confidence === "high" || input.confidence === "medium" ? input.confidence : "low";
  const time_window = input.time_window === "explicit" ? "explicit" : "implicit";
  const topN = typeof input.top_n === "number" && Number.isFinite(input.top_n) ? Math.min(50, Math.max(1, Math.round(input.top_n))) : 5;
  const sortBy = asString(input.sort_by) ?? (metrics[0] ?? "net_revenue");
  const sortDir = input.sort_dir === "asc" ? "asc" : "desc";

  return {
    intent,
    metrics,
    dimensions,
    filters,
    grain,
    time_window,
    confidence,
    required_columns: unique(required),
    top_n: topN,
    sort_by: sortBy,
    sort_dir: sortDir,
  };
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
  const normalizedTopN = Math.min(50, Math.max(1, Number(plan.top_n || 5)));
  const normalizedSortBy = asString(plan.sort_by) ?? (plan.metrics[0] ?? "net_revenue");
  return { ...plan, required_columns: unique(correctedRevenue), top_n: normalizedTopN, sort_by: normalizedSortBy, sort_dir: plan.sort_dir === "asc" ? "asc" : "desc" };
}

function insufficiencyPayload({
  conversationId,
  fromDate,
  toDate,
  plan,
  reason,
  missingFields,
  requiredColumns,
}: {
  conversationId: string;
  fromDate: string;
  toDate: string;
  plan: AnalysisPlan;
  reason: string;
  missingFields: string[];
  requiredColumns: string[];
}) {
  return {
    conversation_id: conversationId,
    answer_title: "Insufficient Data",
    answer_text: "",
    why_this_matters: "",
    kpis: [],
    table: undefined,
    chart: { type: "none", x: "", y: [], title: undefined },
    evidence: {
      row_count: 0,
      duration_ms: 0,
      from_date: fromDate,
      to_date: toDate,
      provenance: ["get_track_assistant_catalog_v1"],
    },
    follow_up_questions: [],
    diagnostics: {
      intent: plan.intent,
      confidence: plan.confidence,
      used_fields: unique([...plan.dimensions, ...plan.metrics, ...plan.filters.map((f) => f.column)]),
      missing_fields: missingFields,
      strict_mode: true,
      analysis_plan: plan,
      required_columns: requiredColumns,
      top_n: plan.top_n,
      sort_by: plan.sort_by,
      sort_dir: plan.sort_dir,
      verifier_status: "failed",
      insufficiency_reason: reason,
      stage: "verify",
    },
  };
}

async function fetchCatalog(userClient: any, trackKey: string, fromDate: string, toDate: string): Promise<ArtistCatalog> {
  const { data, error } = await userClient.rpc("get_track_assistant_catalog_v1", {
    p_track_key: trackKey,
    from_date: fromDate,
    to_date: toDate,
  });
  if (!error) return buildCatalog(data);

  const fallback = await userClient.rpc("get_track_assistant_schema_v2", {
    p_track_key: trackKey,
    from_date: fromDate,
    to_date: toDate,
  });
  if (fallback.error) throw new Error(`Failed to load assistant catalog: ${fallback.error.message}`);
  const root = (fallback.data ?? {}) as Record<string, unknown>;
  const canonical = Array.isArray(root.canonical_columns) ? root.canonical_columns : [];
  const custom = Array.isArray(root.custom_columns) ? root.custom_columns : [];
  const columns = [...canonical, ...custom].map((col) => ({
    ...(col as Record<string, unknown>),
    source: custom.includes(col) ? "custom" : "canonical",
  }));
  return buildCatalog({
    total_rows: root.total_rows ?? 0,
    columns,
    aliases: {},
  });
}

async function logTurn(
  adminClient: any | null,
  _payload: Record<string, unknown>,
) {
  if (!adminClient) return;
  // Best-effort hook intentionally no-op until track observability table is added.
}

async function buildPlan({
  question,
  catalog,
  columnRegistrySubset,
  priorThreadState,
  constraints,
  openAiKey,
  model,
}: {
  question: string;
  catalog: ArtistCatalog;
  columnRegistrySubset: ColumnCapability[];
  priorThreadState: ThreadState | null;
  constraints: QueryConstraints;
  openAiKey: string | null;
  model: string;
}): Promise<{
  plan: AnalysisPlan;
  plan_source: "model" | "fallback";
  column_requirements: { required: string[]; optional: string[]; missing_requested: string[] };
  sql_intent: string;
}> {
  const requiredFromConstraints = unique([
    ...(constraints.asks_platform || constraints.platform.length > 0 ? ["platform"] : []),
    ...(constraints.asks_territory || constraints.territory.length > 0 ? ["territory"] : []),
    ...(constraints.asks_track ? ["track_title"] : []),
  ]);
  const available = new Set(catalog.columns.map((c) => c.field_key));
  const missingRequested = requiredFromConstraints.filter((field) => !available.has(field));

  if (!openAiKey) {
    const fallback = deriveAnalysisPlanFallback(question, catalog);
    const normalized = normalizePlan(fallback, question, catalog);
    return {
      plan: normalized,
      plan_source: "fallback",
      column_requirements: {
        required: unique([...normalized.required_columns, ...requiredFromConstraints]),
        optional: unique(priorThreadState?.selected_columns ?? []).slice(0, 6),
        missing_requested: missingRequested,
      },
      sql_intent: normalized.intent,
    };
  }

  // Build a concise filtered column list for the planner so it always picks real field names
  const registryForPlanner = columnRegistrySubset.length > 0 ? columnRegistrySubset : buildColumnRegistry(catalog);
  const catalogFieldList = registryForPlanner
    .map((c) => {
      const aliasNote = c.aliases.length > 0 ? ` (aliases: ${c.aliases.join(", ")})` : "";
      return `${c.field_key} [${c.semantic_type}]${aliasNote}`;
    })
    .join("\n");

  const plannerSystem = [
    "You are a query planner for a music royalties analytics engine.",
    "Return JSON only with keys: intent, metrics, dimensions, filters, grain, time_window, confidence, required_columns, top_n, sort_by, sort_dir.",
    "CRITICAL: You MUST use ONLY the exact field_key values listed below. Do NOT invent column names.",
    "If the user asks about a concept that maps to an aliased column, use the canonical field_key (e.g. use 'platform' not 'dsp').",
    "Available columns (field_key [type] — optional aliases):",
    catalogFieldList,
    "Rules:",
    "- If user asks top/highest/best/most, set top_n and sort_dir='desc'.",
    "- If user asks worst/lowest/poorest/bottom, set sort_dir='asc'.",
    "- Always set at least one metric from the numeric columns above.",
    "- For track questions about performance, include 'track_title' in dimensions.",
    "- For territory questions include 'territory'. For platform questions include 'platform'.",
    "- confidence should be 'high' when question directly maps to available columns.",
    "No prose, no SQL. Return valid JSON only.",
    `Prior constraints from thread: ${JSON.stringify(priorThreadState?.constraints ?? {})}`,
    `Current constraints: ${JSON.stringify(constraints)}`,
  ].join("\n");

  const plannerUser = JSON.stringify({
    question,
    available_fields: registryForPlanner.map((c) => c.field_key),
    catalog: {
      total_rows: catalog.total_rows,
      columns: registryForPlanner.map((c) => ({
        field_key: c.field_key,
        inferred_type: c.semantic_type,
        coverage_pct: c.quality_hints.coverage_pct,
        source: "registry",
        aliases: c.aliases,
      })),
      aliases: Object.fromEntries(registryForPlanner.map((c) => [c.field_key, c.aliases])),
    },
  });

  try {
    const modelPlan = await callOpenAiJson<AnalysisPlanModelResponse>({
      apiKey: openAiKey,
      model,
      systemPrompt: plannerSystem,
      userPrompt: plannerUser,
    });
    const parsed = parseAnalysisPlanModel(modelPlan);
    if (!parsed) throw new Error("invalid model plan");
    const normalized = normalizePlan(parsed, question, catalog);
    return {
      plan: normalized,
      plan_source: "model",
      column_requirements: {
        required: unique([...normalized.required_columns, ...requiredFromConstraints]),
        optional: unique(priorThreadState?.selected_columns ?? []).slice(0, 6),
        missing_requested: missingRequested,
      },
      sql_intent: normalized.intent,
    };
  } catch {
    const fallback = deriveAnalysisPlanFallback(question, catalog);
    const normalized = normalizePlan(fallback, question, catalog);
    return {
      plan: normalized,
      plan_source: "fallback",
      column_requirements: {
        required: unique([...normalized.required_columns, ...requiredFromConstraints]),
        optional: unique(priorThreadState?.selected_columns ?? []).slice(0, 6),
        missing_requested: missingRequested,
      },
      sql_intent: normalized.intent,
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed." }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? null;
    const signingSecret = Deno.env.get("INSIGHTS_SIGNING_SECRET") ?? null;
    const openAiKey = Deno.env.get("OPENAI_API_KEY") ?? null;
    const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

    if (!supabaseUrl || !anonKey) {
      throw new Error("Required environment variables are missing.");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      throw new Error("Missing bearer token.");
    }
    const jwt = authHeader.slice(7).trim();
    const jwtClaims = parseJwtClaims(jwt);
    const requesterId = jwtClaims?.sub ?? jwtClaims?.user_id;
    if (!requesterId) throw new Error("Unable to resolve authenticated user.");

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = asString(body.action) ?? "send_turn";
    if (action !== "send_turn" && action !== "plan_query" && action !== "run_query") {
      throw new Error("Unsupported action.");
    }

    const trackKey = asString(body.track_key);
    if (!trackKey) throw new Error("track_key is required.");
    const question = asString(body.question);
    if ((action === "send_turn" || action === "plan_query") && !question) {
      throw new Error("question is required.");
    }

    const conversationId = asString(body.conversation_id) ?? crypto.randomUUID();
    const { fromDate, toDate } = normalizeDateRange(body.from_date, body.to_date);
    const scopeToken = computeScopeToken(trackKey, fromDate, toDate);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const adminClient = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;
    const priorThreadState = await loadThreadState(adminClient, requesterId, conversationId);
    const scopeEpoch = priorThreadState
      ? (priorThreadState.scope_token === scopeToken ? priorThreadState.scope_epoch : priorThreadState.scope_epoch + 1)
      : 1;

    if (action === "run_query") {
      if (!signingSecret) throw new Error("INSIGHTS_SIGNING_SECRET is required for run_query.");
      const planId = asString(body.plan_id);
      const executionToken = asString(body.execution_token);
      const sqlPreview = asString(body.sql_preview);
      if (!planId || !executionToken || !sqlPreview) {
        throw new Error("plan_id, execution_token, and sql_preview are required for run_query.");
      }

      const verifiedPayload = await verifyExecutionToken(signingSecret, executionToken);
      if (verifiedPayload.user_id !== requesterId) throw new Error("Execution token user mismatch.");
      if (verifiedPayload.plan_id !== planId) throw new Error("Execution token plan mismatch.");
      if (verifiedPayload.track_key !== trackKey) throw new Error("Execution token track mismatch.");
      if (verifiedPayload.from_date !== fromDate || verifiedPayload.to_date !== toDate) {
        throw new Error("Execution token date range mismatch.");
      }

      const cleanedSql = validatePlannedSql(sqlPreview);
      if (cleanedSql !== verifiedPayload.sql_preview) throw new Error("SQL does not match planned query.");

      const { data: rpcData, error: rpcError } = await userClient.rpc("run_track_chat_sql_v2", {
        p_track_key: trackKey,
        from_date: fromDate,
        to_date: toDate,
        p_sql: cleanedSql,
      });
      if (rpcError) throw new Error(`SQL execution failed: ${rpcError.message}`);

      const sqlResult = (rpcData ?? {}) as SqlExecutionResponse;
      const columns = sanitizeColumns(sqlResult.columns);
      const rows = sanitizeRows(sqlResult.rows);
      const evidence = toEvidence(sqlResult, fromDate, toDate);
      const verifier = verifyQueryResult({
        question: verifiedPayload.question,
        plan: undefined,
        columns,
        rows: rows as Array<Record<string, unknown>>,
      });

      if (verifier.status === "failed") {
        return new Response(
          JSON.stringify({
            error: "Insufficient data for verified query response.",
            detail: verifier.reason,
            diagnostics: { verifier_status: verifier.status, insufficiency_reason: verifier.reason, stage: "verify" },
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const previewRows = rows.slice(0, 20);
      return new Response(
        JSON.stringify({
          answer_title: "Verified Track Result",
          answer_text: `Verified result generated from ${evidence.row_count} row(s).`,
          kpis: [],
          table: previewRows.length > 0 ? { columns, rows: previewRows } : undefined,
          chart: { type: "none", x: "", y: [] },
          evidence,
          follow_up_questions: [],
          diagnostics: {
            verifier_status: verifier.status,
            insufficiency_reason: null,
            stage: "verify",
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (adminClient) {
      await adminClient.rpc("increment_workspace_ai_usage", {
        p_user_id: requesterId,
        p_amount: 1,
      });
    }

    const catalog = await fetchCatalog(userClient, trackKey, fromDate, toDate);
    const columnRegistry = buildColumnRegistry(catalog);
    const constraints = parseConstraints(question!, priorThreadState?.constraints);
    const columnRegistrySubset = filterRelevantColumns(columnRegistry, question!, constraints);
    const { plan, plan_source, column_requirements, sql_intent } = await buildPlan({
      question: question!,
      catalog,
      columnRegistrySubset,
      priorThreadState,
      constraints,
      openAiKey,
      model,
    });
    const resolvedScope: ResolvedScope = {
      mode: "track",
      entity_context: { track_key: trackKey },
      from_date: fromDate,
      to_date: toDate,
      scope_token: scopeToken,
      scope_epoch: scopeEpoch,
    };

    if (catalog.total_rows <= 0) {
      const response = insufficiencyPayload({
        conversationId,
        fromDate,
        toDate,
        plan,
        reason: "zero_scope_rows",
        missingFields: [],
        requiredColumns: unique(plan.required_columns),
      });
      await logTurn(adminClient, {
        user_id: requesterId,
        track_key: trackKey,
        question: question,
        analysis_plan: plan,
        required_columns: unique(plan.required_columns),
        chosen_columns: [],
        sql_text: null,
        sql_hash: null,
        row_count: 0,
        verifier_status: "failed",
        insufficiency_reason: "zero_scope_rows",
        final_answer_meta: { conversation_id: conversationId, mode: "send_turn", stage: "catalog" },
      });
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const catalogFields = new Set(catalog.columns.map((c) => c.field_key.toLowerCase()));
    const requiredColumns = unique(column_requirements.required);
    const missingFields = unique([...column_requirements.missing_requested, ...requiredColumns.filter((field) => !catalogFields.has(field.toLowerCase()))]);

    if (action === "plan_query" && missingFields.length > 0) {
      return new Response(
        JSON.stringify({
          error: "Insufficient data for this question.",
          detail: `Missing fields: ${missingFields.join(", ")}`,
          diagnostics: {
            analysis_plan: plan,
            required_columns: requiredColumns,
            missing_fields: missingFields,
            column_requirements: column_requirements,
            top_n: plan.top_n,
            sort_by: plan.sort_by,
            sort_dir: plan.sort_dir,
            verifier_status: "failed",
            insufficiency_reason: "required_columns_missing",
            strict_mode: true,
            stage: "plan",
          },
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (action === "plan_query") {
      if (!signingSecret) throw new Error("INSIGHTS_SIGNING_SECRET is required for plan_query.");
      const compiled = compileSqlFromPlan(plan, catalog);
      const sqlPreview = validatePlannedSql(compiled.sql);
      const planId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + PLAN_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
      const executionToken = await signExecutionToken(signingSecret, {
        plan_id: planId,
        user_id: requesterId,
        track_key: trackKey,
        from_date: fromDate,
        to_date: toDate,
        sql_preview: sqlPreview,
        question: question!,
        expires_at: expiresAt,
      });

      return new Response(
        JSON.stringify({
          plan_id: planId,
          understood_question: question,
          sql_preview: sqlPreview,
          expected_columns: unique([...plan.dimensions, ...plan.metrics]),
          execution_token: executionToken,
          expires_at: expiresAt,
          diagnostics: {
            analysis_plan: plan,
            required_columns: requiredColumns,
            chosen_columns: compiled.chosen_columns,
            column_requirements: column_requirements,
            top_n: plan.top_n,
            sort_by: plan.sort_by,
            sort_dir: plan.sort_dir,
            verifier_status: "pending",
            insufficiency_reason: null,
            strict_mode: true,
            compiler_source: plan_source,
            stage: "compile",
          },
          safety: {
            read_only: true,
            row_limit: SQL_ROW_LIMIT,
            timeout_ms: SQL_TIMEOUT_MS,
            track_scoped: true,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // We no longer hard-block on missingFields — the compiler resolves columns via alias
    // lookup and fallback metrics. We proceed to SQL regardless and let the verifier
    // evaluate the actual result (rows-first: any non-empty result passes).
    // Log a warning for observability when columns couldn't be resolved.
    if (missingFields.length > 0) {
      await logTurn(adminClient, {
        user_id: requesterId,
        track_key: trackKey,
        question: question,
        analysis_plan: plan,
        required_columns: requiredColumns,
        chosen_columns: [],
        sql_text: null,
        sql_hash: null,
        row_count: 0,
        verifier_status: "degraded_compile",
        insufficiency_reason: `unresolved_columns: ${missingFields.join(", ")}`,
        final_answer_meta: { conversation_id: conversationId, mode: "send_turn", stage: "compile_warn" },
      });
      // Continue to SQL — compiler will use best-available fallbacks
    }

    const compiled = compileSqlFromPlan(plan, catalog);
    const cleanedSql = validatePlannedSql(compiled.sql);
    const { data: rpcData, error: rpcError } = await userClient.rpc("run_track_chat_sql_v2", {
      p_track_key: trackKey,
      from_date: fromDate,
      to_date: toDate,
      p_sql: cleanedSql,
    });
    if (rpcError) throw new Error(`SQL execution failed: ${rpcError.message}`);

    const sqlResult = (rpcData ?? {}) as SqlExecutionResponse;
    const columns = sanitizeColumns(sqlResult.columns);
    const rows = sanitizeRows(sqlResult.rows);
    const evidence = toEvidence(sqlResult, fromDate, toDate);
    const verifier = verifyQueryResult({ question: question!, plan, columns, rows: rows as Array<Record<string, unknown>> });

    if (verifier.status === "failed") {
      // Only hard-fail when zero rows were returned — there is genuinely no data.
      // Any non-empty result is handled as a best-effort answer below.
      const response = insufficiencyPayload({
        conversationId,
        fromDate,
        toDate,
        plan,
        reason: verifier.reason ?? "no_rows_returned",
        missingFields: [],
        requiredColumns,
      });
      await logTurn(adminClient, {
        user_id: requesterId,
        track_key: trackKey,
        question: question,
        analysis_plan: plan,
        required_columns: requiredColumns,
        chosen_columns: compiled.chosen_columns,
        sql_text: cleanedSql,
        sql_hash: stableHash(cleanedSql),
        row_count: evidence.row_count,
        verifier_status: "failed",
        insufficiency_reason: verifier.reason ?? "no_rows_returned",
        final_answer_meta: { conversation_id: conversationId, mode: "send_turn" },
      });
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const previewRows = rows.slice(0, 25);
    const verifierWarnings = (verifier as { warnings?: string[] }).warnings ?? [];
    let synthesized: AssistantSynthesisResponse | null = null;
    if (openAiKey) {
      try {
        synthesized = await callOpenAiJson<AssistantSynthesisResponse>({
          apiKey: openAiKey,
          model,
          systemPrompt: [
            "You are a music royalty analytics assistant for publishers.",
            "Use ONLY the query result provided. Do NOT speculate beyond what the data shows.",
            "Output JSON keys: answer_title, answer_text, why_this_matters, kpis, chart, follow_up_questions.",
            "answer_title: concise title (5 words max).",
            "answer_text: lead with a direct answer sentence, follow with key numbers from the result.",
            "why_this_matters: Actionable Business Impact. Provide a concrete next step or business conclusion specific to these numbers. Avoid generic platitudes. e.g., if a track is peaking, suggest a sync push; if a territory is failing, suggest checking local DSP playlists.",
            "kpis: up to 4 KPI objects {label, value} derived from the top row(s).",
            "chart: suggest 'bar' or 'line' or 'none'. Only suggest a chart type if it genuinely aids reading the data.",
            "follow_up_questions: 2-3 natural follow-up questions a publisher would ask next.",
            verifierWarnings.length > 0
              ? `Data notes (be transparent about these in answer_text if relevant): ${verifierWarnings.join("; ")}`
              : "The result is complete and verified.",
          ].join("\n"),
          userPrompt: JSON.stringify({
            question,
            result: { columns, rows: previewRows, row_count: evidence.row_count },
          }),
        });
      } catch {
        synthesized = null;
      }
    }

    const totalRevenueRow = previewRows[0];
    const fallbackAnswer = evidence.row_count === 0
      ? "No rows matched this question in the current track scope."
      : `Top row returned with ${evidence.row_count} verified row(s).`;

    const answerTitle = asString(synthesized?.answer_title) ?? "Verified Track Answer";
    const answerText = asString(synthesized?.answer_text) ?? fallbackAnswer;
    const whyThisMatters = asString(synthesized?.why_this_matters) ?? "";
    const kpis = sanitizeKpis(synthesized?.kpis);
    const followUps = asArrayOfStrings(synthesized?.follow_up_questions).slice(0, 3);
    const chart = (() => {
      const proposed = synthesized?.chart;
      const chartType = proposed?.type === "bar" || proposed?.type === "line" || proposed?.type === "none"
        ? proposed.type
        : "none";
      if (chartType === "none") return { type: "none" as const, x: "", y: [], title: undefined };
      const x = asString(proposed?.x);
      const y = asArrayOfStrings(proposed?.y);
      if (!x || y.length === 0 || !columns.includes(x) || y.some((col) => !columns.includes(col))) {
        return { type: "none" as const, x: "", y: [], title: undefined };
      }
      return { type: chartType, x, y, title: asString(proposed?.title) ?? undefined };
    })();

    const quality = evaluateQualityOutcome({
      constraints,
      rows: previewRows,
      evidence,
      verifierWarnings,
      missingRequested: column_requirements.missing_requested,
    });
    const claimsList = buildClaimsFromRows(columns, previewRows);
    const externalAssessment = quality.quality_outcome === "pass"
      ? await maybeRunExternalAssessment({ question: question!, topRows: previewRows })
      : null;
    if (externalAssessment) {
      claimsList.push({
        claim_id: `external_${stableHash(externalAssessment.notes)}`,
        text: externalAssessment.notes,
        supporting_fields: [],
        source_ref: "external_web_assessment",
      });
    }
    const planTrace = {
      intent: sql_intent,
      selected_columns: compiled.chosen_columns,
      missing_columns: missingFields,
      column_requirements,
      constraints,
    };

    let finalAnswerText = answerText;
    let finalWhyThisMatters = whyThisMatters;
    let finalFollowUps = followUps;
    if (quality.quality_outcome === "clarify" && quality.clarification) {
      finalAnswerText = quality.clarification.question;
      finalWhyThisMatters = quality.clarification.reason;
      finalFollowUps = quality.clarification.options ?? [];
    } else if (quality.quality_outcome === "constrained") {
      finalWhyThisMatters = "Evidence is currently constrained; treat this as directional until data sufficiency improves.";
      if (finalFollowUps.length === 0) {
        finalFollowUps = [
          "Broaden the date range for stronger confidence.",
          "Filter to the platform or territory you care about most.",
        ];
      }
    }
    const answerBlocks = buildAdaptiveAnswerBlocks({
      answerTitle,
      answerText: finalAnswerText,
      whyThisMatters: finalWhyThisMatters,
      kpis,
      columns,
      previewRows,
      claims: claimsList,
      qualityOutcome: quality.quality_outcome,
      clarification: quality.clarification,
      unknowns: quality.unknowns,
    });
    if (externalAssessment) {
      answerBlocks.push({
        id: "external-summary",
        type: "deep_summary",
        priority: 6,
        source: "external",
        payload: { text: externalAssessment.notes },
      });
    }
    const evidenceMap = Object.fromEntries(
      answerBlocks
        .filter((b) => typeof b.id === "string")
        .map((b) => [String(b.id), b.source === "external" ? "external" : "workspace_data"]),
    );

    const response = {
      conversation_id: conversationId,
      answer_title: answerTitle,
      answer_text: finalAnswerText,
      why_this_matters: finalWhyThisMatters,
      kpis,
      table: previewRows.length > 0 ? { columns, rows: previewRows } : undefined,
      chart,
      evidence,
      follow_up_questions: finalFollowUps,
      quality_outcome: quality.quality_outcome,
      clarification: quality.clarification,
      resolved_scope: resolvedScope,
      plan_trace: planTrace,
      claims: claimsList,
      answer_blocks: answerBlocks,
      render_hints: {
        layout: "adaptive_card_stack",
        density: quality.quality_outcome === "pass" ? "expanded" : "compact",
        visual_preference: chart.type === "none" ? "table" : "chart",
        show_confidence_badges: true,
      },
      evidence_map: evidenceMap,
      unknowns: quality.unknowns,
      citations: externalAssessment?.citations ?? undefined,
      diagnostics: {
        intent: plan.intent,
        confidence: verifierWarnings.length > 0 ? "medium" : plan.confidence,
        used_fields: unique([...plan.dimensions, ...plan.metrics, ...plan.filters.map((f) => f.column)]),
        missing_fields: missingFields,
        strict_mode: false,
        data_notes: verifierWarnings,
        analysis_plan: plan,
        column_requirements: column_requirements,
        required_columns: requiredColumns,
        chosen_columns: compiled.chosen_columns,
        top_n: plan.top_n,
        sort_by: plan.sort_by,
        sort_dir: plan.sort_dir,
        verifier_status: verifier.status,
        insufficiency_reason: null,
        compiler_source: plan_source,
        stage: "verify",
        external_assessment: externalAssessment ? "applied" : "skipped",
      },
    };

    await saveThreadState(adminClient, requesterId, {
      conversation_id: conversationId,
      scope_token: scopeToken,
      scope_epoch: scopeEpoch,
      intent: sql_intent,
      constraints: {
        platform: constraints.platform,
        territory: constraints.territory,
        requested_granularity: constraints.requested_granularity,
      },
      selected_columns: compiled.chosen_columns,
      missing_columns: missingFields,
      clarification: quality.clarification
        ? {
            pending: true,
            reason: quality.clarification.reason,
            question: quality.clarification.question,
            options: quality.clarification.options,
          }
        : { pending: false },
    });

    await logTurn(adminClient, {
      user_id: requesterId,
      track_key: trackKey,
      question: question,
      analysis_plan: plan,
      required_columns: requiredColumns,
      chosen_columns: compiled.chosen_columns,
      sql_text: cleanedSql,
      sql_hash: stableHash(cleanedSql),
      row_count: evidence.row_count,
      verifier_status: verifier.status,
      insufficiency_reason: null,
      final_answer_meta: {
        conversation_id: conversationId,
        answer_title: answerTitle,
        kpi_count: kpis.length,
        row_count: evidence.row_count,
        top_row: totalRevenueRow ?? null,
      },
    });

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error", _fatal: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
