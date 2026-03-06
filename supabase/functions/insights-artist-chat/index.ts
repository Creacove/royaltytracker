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
  artist_key: string;
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
    artist_key?: string;
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
      return { label, value, change: asString(record.change) ?? undefined };
    })
    .filter((kpi): kpi is { label: string; value: string; change?: string } => !!kpi)
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
      : ["run_artist_chat_sql_v1"],
  };
}

function stableHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return String(h >>> 0);
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
      provenance: ["get_artist_assistant_catalog_v1"],
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

async function fetchCatalog(userClient: ReturnType<typeof createClient>, artistKey: string, fromDate: string, toDate: string): Promise<ArtistCatalog> {
  const { data, error } = await userClient.rpc("get_artist_assistant_catalog_v1", {
    p_artist_key: artistKey,
    from_date: fromDate,
    to_date: toDate,
  });
  if (!error) return buildCatalog(data);

  const fallback = await userClient.rpc("get_artist_assistant_schema_with_capabilities_v1", {
    p_artist_key: artistKey,
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
  adminClient: ReturnType<typeof createClient> | null,
  payload: Record<string, unknown>,
) {
  if (!adminClient) return;
  try {
    await adminClient.from("artist_ai_turn_logs_v1").insert(payload);
  } catch {
    // Best-effort logging only.
  }
}

async function buildPlan({
  question,
  catalog,
  openAiKey,
  model,
}: {
  question: string;
  catalog: ArtistCatalog;
  openAiKey: string | null;
  model: string;
}): Promise<{ plan: AnalysisPlan; plan_source: "model" | "fallback" }> {
  if (!openAiKey) {
    const fallback = deriveAnalysisPlanFallback(question, catalog);
    return { plan: normalizePlan(fallback, question, catalog), plan_source: "fallback" };
  }

  // Build a concise column list for the planner so it always picks real field names
  const catalogFieldList = catalog.columns
    .map((c) => {
      const aliasNote = (c.aliases ?? []).length > 0 ? ` (aliases: ${c.aliases.join(", ")})` : "";
      return `${c.field_key} [${c.inferred_type}]${aliasNote}`;
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
    "- For artist questions about track performance, include 'track_title' in dimensions.",
    "- For territory questions include 'territory'. For platform questions include 'platform'.",
    "- confidence should be 'high' when question directly maps to available columns.",
    "No prose, no SQL. Return valid JSON only.",
  ].join("\n");

  const plannerUser = JSON.stringify({
    question,
    available_fields: catalog.columns.map((c) => c.field_key),
    catalog: {
      total_rows: catalog.total_rows,
      columns: catalog.columns.map((c) => ({
        field_key: c.field_key,
        inferred_type: c.inferred_type,
        coverage_pct: c.coverage_pct,
        source: c.source,
        aliases: c.aliases,
      })),
      aliases: catalog.aliases,
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
    return { plan: normalizePlan(parsed, question, catalog), plan_source: "model" };
  } catch {
    const fallback = deriveAnalysisPlanFallback(question, catalog);
    return { plan: normalizePlan(fallback, question, catalog), plan_source: "fallback" };
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
    const claims = parseJwtClaims(jwt);
    const requesterId = claims?.sub ?? claims?.user_id;
    if (!requesterId) throw new Error("Unable to resolve authenticated user.");

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = asString(body.action) ?? "send_turn";
    if (action !== "send_turn" && action !== "plan_query" && action !== "run_query") {
      throw new Error("Unsupported action.");
    }

    const artistKey = asString(body.artist_key);
    if (!artistKey) throw new Error("artist_key is required.");
    const question = asString(body.question);
    if ((action === "send_turn" || action === "plan_query") && !question) {
      throw new Error("question is required.");
    }

    const conversationId = asString(body.conversation_id) ?? crypto.randomUUID();
    const { fromDate, toDate } = normalizeDateRange(body.from_date, body.to_date);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const adminClient = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;

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
      if (verifiedPayload.artist_key !== artistKey) throw new Error("Execution token artist mismatch.");
      if (verifiedPayload.from_date !== fromDate || verifiedPayload.to_date !== toDate) {
        throw new Error("Execution token date range mismatch.");
      }

      const cleanedSql = validatePlannedSql(sqlPreview);
      if (cleanedSql !== verifiedPayload.sql_preview) throw new Error("SQL does not match planned query.");

      const { data: rpcData, error: rpcError } = await userClient.rpc("run_artist_chat_sql_v1", {
        p_artist_key: artistKey,
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
          answer_title: "Verified Artist Result",
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

    const catalog = await fetchCatalog(userClient, artistKey, fromDate, toDate);
    const { plan, plan_source } = await buildPlan({
      question: question!,
      catalog,
      openAiKey,
      model,
    });

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
        artist_key: artistKey,
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
    const requiredColumns = unique(plan.required_columns);
    const missingFields = requiredColumns.filter((field) => !catalogFields.has(field.toLowerCase()));

    if (action === "plan_query" && missingFields.length > 0) {
      return new Response(
        JSON.stringify({
          error: "Insufficient data for this question.",
          detail: `Missing fields: ${missingFields.join(", ")}`,
          diagnostics: {
            analysis_plan: plan,
            required_columns: requiredColumns,
            missing_fields: missingFields,
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
        artist_key: artistKey,
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
            artist_scoped: true,
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
        artist_key: artistKey,
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
    const { data: rpcData, error: rpcError } = await userClient.rpc("run_artist_chat_sql_v1", {
      p_artist_key: artistKey,
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
        artist_key: artistKey,
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
      ? "No rows matched this question in the current artist scope."
      : `Top row returned with ${evidence.row_count} verified row(s).`;

    const answerTitle = asString(synthesized?.answer_title) ?? "Verified Artist Answer";
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

    const response = {
      conversation_id: conversationId,
      answer_title: answerTitle,
      answer_text: answerText,
      why_this_matters: whyThisMatters,
      kpis,
      table: previewRows.length > 0 ? { columns, rows: previewRows } : undefined,
      chart,
      evidence,
      follow_up_questions: followUps,
      diagnostics: {
        intent: plan.intent,
        confidence: verifierWarnings.length > 0 ? "medium" : plan.confidence,
        used_fields: unique([...plan.dimensions, ...plan.metrics, ...plan.filters.map((f) => f.column)]),
        missing_fields: missingFields,
        strict_mode: false,
        data_notes: verifierWarnings,
        analysis_plan: plan,
        required_columns: requiredColumns,
        chosen_columns: compiled.chosen_columns,
        top_n: plan.top_n,
        sort_by: plan.sort_by,
        sort_dir: plan.sort_dir,
        verifier_status: verifier.status,
        insufficiency_reason: null,
        compiler_source: plan_source,
        stage: "verify",
      },
    };

    await logTurn(adminClient, {
      user_id: requesterId,
      artist_key: artistKey,
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
