import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SQL_ROW_LIMIT = 200;
const SQL_TIMEOUT_MS = 4000;
const MAX_TABLE_ROWS = 30;

type Action = "send_turn";

type SqlExecutionResponse = {
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  row_count?: number;
  duration_ms?: number;
  query_provenance?: string[];
};

type AssistantSchemaColumn = {
  field_key: string;
  inferred_type: string;
  coverage_pct?: number;
  sample_values?: string[];
};

type AssistantSchemaResponse = {
  track_key?: string;
  total_rows?: number;
  canonical_columns?: AssistantSchemaColumn[];
  custom_columns?: AssistantSchemaColumn[];
};

type PlanModelResponse = {
  understood_question?: string;
  sql_preview?: string;
  needs_clarification?: boolean;
  clarification_prompt?: string;
  clarification_options?: string[];
};

type RunModelResponse = {
  answer_title?: string;
  answer_text?: string;
  why_this_matters?: string;
  kpis?: Array<{ label?: string; value?: string; change?: string }>;
  chart?: { type?: "bar" | "line" | "none"; x?: string; y?: string[]; title?: string };
  follow_up_questions?: string[];
};

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

function validatePlannedSql(sql: string): string {
  const v = sql.trim();
  const lower = v.toLowerCase();

  if (!/^\s*(select|with)\s+/.test(lower)) throw new Error("Generated SQL must start with SELECT or WITH.");
  if (v.includes(";")) throw new Error("Generated SQL cannot include semicolons.");
  if (/--|\/\*|\*\//.test(v)) throw new Error("Generated SQL cannot include comments.");
  if (v.includes('"')) throw new Error("Generated SQL cannot include quoted identifiers.");
  if (/\b(insert|update|delete|drop|alter|create|grant|revoke|copy|call|do|truncate)\b/i.test(v)) {
    throw new Error("Generated SQL contains a disallowed keyword.");
  }
  if (/\b(?:from|join)\s+[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*\b/i.test(v)) {
    throw new Error("Generated SQL cannot reference schema-qualified relations.");
  }
  return v;
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

function parseSchema(payload: unknown): { canonical: AssistantSchemaColumn[]; custom: AssistantSchemaColumn[]; totalRows: number } {
  const root = asObject(payload) as AssistantSchemaResponse | null;
  if (!root) return { canonical: [], custom: [], totalRows: 0 };
  const canonical = Array.isArray(root.canonical_columns)
    ? root.canonical_columns
        .map((item) => asObject(item))
        .filter((item): item is Record<string, unknown> => !!item)
        .map((item) => ({
          field_key: asString(item.field_key) ?? "",
          inferred_type: asString(item.inferred_type) ?? "text",
          coverage_pct: asNumber(item.coverage_pct) ?? undefined,
          sample_values: asArrayOfStrings(item.sample_values),
        }))
        .filter((item) => item.field_key.length > 0)
    : [];
  const custom = Array.isArray(root.custom_columns)
    ? root.custom_columns
        .map((item) => asObject(item))
        .filter((item): item is Record<string, unknown> => !!item)
        .map((item) => ({
          field_key: asString(item.field_key) ?? "",
          inferred_type: asString(item.inferred_type) ?? "text",
          coverage_pct: asNumber(item.coverage_pct) ?? undefined,
          sample_values: asArrayOfStrings(item.sample_values),
        }))
        .filter((item) => item.field_key.length > 0)
    : [];
  return { canonical, custom, totalRows: asNumber(root.total_rows) ?? 0 };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_ ]+/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}

function resolveLikelyFields(question: string, columns: AssistantSchemaColumn[]): AssistantSchemaColumn[] {
  const tokens = new Set(tokenize(question));
  const scored = columns
    .map((column) => {
      const keyTokens = tokenize(column.field_key.replace(/_/g, " "));
      const sampleTokens = column.sample_values?.flatMap((sample) => tokenize(sample)).slice(0, 40) ?? [];
      let score = 0;
      for (const token of tokens) {
        if (column.field_key.toLowerCase() === token) score += 4;
        if (column.field_key.toLowerCase().includes(token)) score += 2;
        if (keyTokens.includes(token)) score += 2;
        if (sampleTokens.includes(token)) score += 1;
      }
      return { column, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  return scored.map((entry) => entry.column);
}

function deterministicSql(question: string): { sql: string; understoodQuestion: string } | null {
  const lower = question.toLowerCase();

  if (/(owe|owed|payout|cashflow|cash flow|unpaid|hanging)/.test(lower)) {
    return {
      understoodQuestion: "Cashflow view by territory and platform.",
      sql: `
        SELECT
          territory,
          platform,
          SUM(net_revenue)::numeric(20,6) AS net_revenue,
          SUM(quantity)::numeric(20,6) AS quantity
        FROM scoped_core
        GROUP BY territory, platform
        ORDER BY net_revenue DESC
        LIMIT 20
      `,
    };
  }

  if (/(last 90|90 day|change|shift|trend|momentum)/.test(lower)) {
    return {
      understoodQuestion: "Change over recent months.",
      sql: `
        SELECT
          date_trunc('month', event_date)::date AS month_start,
          SUM(net_revenue)::numeric(20,6) AS net_revenue,
          SUM(quantity)::numeric(20,6) AS quantity
        FROM scoped_core
        GROUP BY date_trunc('month', event_date)::date
        ORDER BY month_start DESC
        LIMIT 12
      `,
    };
  }

  if (/(platform|dsp|service)/.test(lower)) {
    return {
      understoodQuestion: "Platform performance.",
      sql: `
        SELECT
          platform,
          SUM(net_revenue)::numeric(20,6) AS net_revenue,
          SUM(quantity)::numeric(20,6) AS quantity,
          CASE WHEN SUM(quantity) = 0 THEN 0 ELSE SUM(net_revenue) / NULLIF(SUM(quantity), 0) END::numeric(20,6) AS net_per_unit
        FROM scoped_core
        GROUP BY platform
        ORDER BY net_revenue DESC
        LIMIT 20
      `,
    };
  }

  if (/(territory|country|region|location|market)/.test(lower)) {
    return {
      understoodQuestion: "Territory performance.",
      sql: `
        SELECT
          territory,
          SUM(net_revenue)::numeric(20,6) AS net_revenue,
          SUM(quantity)::numeric(20,6) AS quantity,
          CASE WHEN SUM(quantity) = 0 THEN 0 ELSE SUM(net_revenue) / NULLIF(SUM(quantity), 0) END::numeric(20,6) AS net_per_unit
        FROM scoped_core
        GROUP BY territory
        ORDER BY net_revenue DESC
        LIMIT 20
      `,
    };
  }

  if (/(quality|error|failed|blocker|review)/.test(lower)) {
    return {
      understoodQuestion: "Quality blockers overview.",
      sql: `
        SELECT
          validation_status,
          COUNT(*)::int AS row_count,
          SUM(net_revenue)::numeric(20,6) AS net_revenue
        FROM scoped_core
        GROUP BY validation_status
        ORDER BY row_count DESC
      `,
    };
  }

  return null;
}

function buildFallbackFollowUps(columns: AssistantSchemaColumn[]): string[] {
  const preferred = columns
    .map((column) => column.field_key)
    .filter((key) => !["track_title", "artist_name", "event_date"].includes(key))
    .slice(0, 3);

  const followUps = preferred.map((field) => `Break this down by ${field.replace(/_/g, " ")}.`);
  if (followUps.length < 3) followUps.push("Compare this with the previous 90 days.");
  if (followUps.length < 3) followUps.push("Show the biggest contributors to this result.");
  return followUps.slice(0, 3);
}

function buildFallbackResponse({
  question,
  columns,
  rows,
  fromDate,
  toDate,
  provenance,
  likelyFields,
}: {
  question: string;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
  fromDate: string;
  toDate: string;
  provenance: string[];
  likelyFields: AssistantSchemaColumn[];
}) {
  const rowCount = rows.length;
  const numericColumns = columns.filter((col) =>
    rows.some((row) => {
      const value = row[col];
      if (typeof value === "number") return true;
      if (typeof value === "string") return Number.isFinite(Number(value));
      return false;
    })
  );

  const chart =
    columns.length >= 2 && numericColumns.length > 0
      ? {
          type: "bar" as const,
          x: columns.find((col) => !numericColumns.includes(col)) ?? columns[0],
          y: [numericColumns[0]],
          title: `${numericColumns[0].replace(/_/g, " ")} breakdown`,
        }
      : { type: "none" as const, x: "", y: [] as string[], title: undefined };

  return {
    answer_title: rowCount === 0 ? "No Matching Reviewed Data" : "Decision View Ready",
    answer_text:
      rowCount === 0
        ? "No reviewed rows matched this question in the selected period."
        : `Here is the clearest decision view for "${question}" using reviewed track data.`,
    why_this_matters:
      rowCount === 0
        ? "Adjust date range or ask for a different dimension to continue analysis."
        : "Use this view to prioritize where action is needed first for this track.",
    kpis: [
      { label: "Rows Used", value: rowCount.toLocaleString() },
      { label: "Columns Returned", value: columns.length.toLocaleString() },
    ],
    table: rowCount > 0 ? { columns, rows: rows.slice(0, MAX_TABLE_ROWS) } : undefined,
    chart,
    evidence: {
      row_count: rowCount,
      duration_ms: 0,
      from_date: fromDate,
      to_date: toDate,
      provenance,
    },
    follow_up_questions: buildFallbackFollowUps(likelyFields),
  };
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
    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1";

    if (!supabaseUrl || !serviceRoleKey || !anonKey) throw new Error("Missing Supabase env.");
    if (!openAiKey) throw new Error("Missing OPENAI_API_KEY secret.");

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

    const body = await req.json().catch(() => ({}));
    const action = asString((body as { action?: unknown }).action) as Action | null;
    if (action !== "send_turn") {
      return new Response(JSON.stringify({ error: "Unsupported action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const question = asString((body as { question?: unknown }).question);
    const trackKey = asString((body as { track_key?: unknown }).track_key);
    const conversationId = asString((body as { conversation_id?: unknown }).conversation_id) ?? crypto.randomUUID();
    if (!question) throw new Error("question is required.");
    if (!trackKey) throw new Error("track_key is required.");
    const { fromDate, toDate } = normalizeDateRange(
      (body as { from_date?: unknown }).from_date,
      (body as { to_date?: unknown }).to_date,
    );

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    });

    const { data: schemaData, error: schemaError } = await userClient.rpc("get_track_assistant_schema_v2", {
      p_track_key: trackKey,
      from_date: fromDate,
      to_date: toDate,
    });
    if (schemaError) throw new Error(`Failed to read assistant schema: ${schemaError.message}`);
    const schema = parseSchema(schemaData);
    const allColumns = [...schema.canonical, ...schema.custom];
    const likelyFields = resolveLikelyFields(question, allColumns);

    if (schema.totalRows === 0) {
      return new Response(
        JSON.stringify({
          conversation_id: conversationId,
          answer_title: "No Reviewed Data In Scope",
          answer_text: "No reviewed rows are available for this track and date range yet.",
          why_this_matters: "Complete review for at least one report or broaden the date range.",
          kpis: [],
          evidence: {
            row_count: 0,
            duration_ms: 0,
            from_date: fromDate,
            to_date: toDate,
            provenance: ["track_assistant_scope_v2"],
          },
          follow_up_questions: [],
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (likelyFields.length === 0 && schema.custom.length > 0) {
      const options = schema.custom.slice(0, 4).map((column) => column.field_key.replace(/_/g, " "));
      return new Response(
        JSON.stringify({
          conversation_id: conversationId,
          answer_title: "One Clarification",
          answer_text: "I can answer this quickly. Which field direction should I use?",
          why_this_matters: "Picking the right field gives a precise answer from reviewed data.",
          kpis: [],
          evidence: {
            row_count: 0,
            duration_ms: 0,
            from_date: fromDate,
            to_date: toDate,
            provenance: ["track_assistant_scope_v2", "royalty_transactions.custom_properties"],
          },
          follow_up_questions: [],
          clarification: {
            prompt: "Choose one of these available field directions:",
            options,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const deterministic = deterministicSql(question);
    let understoodQuestion = deterministic?.understoodQuestion ?? question;
    let plannedSql = deterministic?.sql?.trim() ?? "";

    if (!plannedSql) {
      const plannerSystem = [
        "You are a SQL planner for publisher analytics.",
        "Output JSON with keys: understood_question, sql_preview, needs_clarification, clarification_prompt, clarification_options.",
        "Generate one read-only SQL statement for PostgreSQL.",
        "Use only relations: scoped_core, scoped_custom, scoped_columns.",
        "Use scoped_custom when question references custom fields.",
        "Never include comments, semicolons, DDL/DML, quoted identifiers, or schema-qualified names.",
      ].join("\n");

      const plannerUser = JSON.stringify({
        question,
        scope: {
          track_key: trackKey,
          from_date: fromDate,
          to_date: toDate,
          row_limit: SQL_ROW_LIMIT,
          timeout_ms: SQL_TIMEOUT_MS,
        },
        likely_fields: likelyFields.map((field) => ({
          field_key: field.field_key,
          inferred_type: field.inferred_type,
          sample_values: field.sample_values ?? [],
        })),
        canonical_fields: schema.canonical.map((field) => field.field_key),
        custom_fields: schema.custom.map((field) => field.field_key),
        scoped_core_columns: [
          "track_key",
          "event_date",
          "track_title",
          "artist_name",
          "isrc",
          "iswc",
          "territory",
          "platform",
          "usage_type",
          "quantity",
          "gross_revenue",
          "commission",
          "net_revenue",
          "validation_status",
          "mapping_confidence",
          "currency",
          "period_start",
          "period_end",
          "report_id",
          "source_row_id",
          "custom_properties",
        ],
        scoped_custom_columns: [
          "track_key",
          "event_date",
          "report_id",
          "source_row_id",
          "custom_key",
          "custom_value",
        ],
      });

      const planned = await callOpenAiJson<PlanModelResponse>({
        apiKey: openAiKey,
        model,
        systemPrompt: plannerSystem,
        userPrompt: plannerUser,
      });

      understoodQuestion = asString(planned.understood_question) ?? question;
      const needsClarification = planned.needs_clarification === true;
      if (needsClarification) {
        const options = asArrayOfStrings(planned.clarification_options).slice(0, 4);
        return new Response(
          JSON.stringify({
            conversation_id: conversationId,
            answer_title: "One Clarification",
            answer_text: "I need one quick clarification before I run this.",
            why_this_matters: "Clarifying once improves answer precision.",
            kpis: [],
            evidence: {
              row_count: 0,
              duration_ms: 0,
              from_date: fromDate,
              to_date: toDate,
              provenance: ["track_assistant_scope_v2", "royalty_transactions.custom_properties"],
            },
            follow_up_questions: [],
            clarification: {
              prompt: asString(planned.clarification_prompt) ?? "Choose one option:",
              options: options.length > 0 ? options : buildFallbackFollowUps(likelyFields),
            },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      plannedSql = validatePlannedSql(asString(planned.sql_preview) ?? "");
    }

    plannedSql = validatePlannedSql(plannedSql);

    const { data: rpcData, error: rpcError } = await userClient.rpc("run_track_chat_sql_v2", {
      p_track_key: trackKey,
      from_date: fromDate,
      to_date: toDate,
      p_sql: plannedSql,
    });
    if (rpcError) throw new Error(`SQL execution failed: ${rpcError.message}`);

    const sqlResult = (rpcData ?? {}) as SqlExecutionResponse;
    const columns = sanitizeColumns(sqlResult.columns);
    const rows = sanitizeRows(sqlResult.rows);
    const previewRows = rows.slice(0, MAX_TABLE_ROWS);
    const evidence = {
      row_count: asNumber(sqlResult.row_count) ?? rows.length,
      duration_ms: asNumber(sqlResult.duration_ms) ?? 0,
      from_date: fromDate,
      to_date: toDate,
      provenance: asArrayOfStrings(sqlResult.query_provenance),
    };

    const fallback = buildFallbackResponse({
      question: understoodQuestion,
      columns,
      rows: previewRows,
      fromDate,
      toDate,
      provenance: evidence.provenance,
      likelyFields: likelyFields.length > 0 ? likelyFields : schema.custom,
    });

    let modelRun: RunModelResponse | null = null;
    try {
      const runSystem = [
        "You are a publisher decision assistant.",
        "Write concise business answers grounded in reviewed data only.",
        "Output JSON with keys: answer_title, answer_text, why_this_matters, kpis, chart, follow_up_questions.",
        "kpis should contain 2-5 items with label and value.",
        "follow_up_questions must be practical and in scope.",
      ].join("\n");
      const runUser = JSON.stringify({
        question: understoodQuestion,
        sql_preview: plannedSql,
        likely_fields: likelyFields.map((field) => field.field_key),
        available_columns: columns,
        result: {
          row_count: evidence.row_count,
          columns,
          rows: previewRows,
        },
      });
      modelRun = await callOpenAiJson<RunModelResponse>({
        apiKey: openAiKey,
        model,
        systemPrompt: runSystem,
        userPrompt: runUser,
      });
    } catch {
      modelRun = null;
    }

    const answerTitle = asString(modelRun?.answer_title) ?? fallback.answer_title;
    const answerText = asString(modelRun?.answer_text) ?? fallback.answer_text;
    const whyThisMatters = asString(modelRun?.why_this_matters) ?? fallback.why_this_matters;
    const kpis =
      Array.isArray(modelRun?.kpis) && modelRun?.kpis.length > 0
        ? modelRun.kpis
            .map((kpi) => ({
              label: asString(kpi.label) ?? "",
              value: asString(kpi.value) ?? "",
              change: asString(kpi.change) ?? undefined,
            }))
            .filter((kpi) => kpi.label.length > 0 && kpi.value.length > 0)
            .slice(0, 5)
        : fallback.kpis;

    const chart = (() => {
      const proposed = modelRun?.chart;
      const chartType = proposed?.type === "bar" || proposed?.type === "line" || proposed?.type === "none"
        ? proposed.type
        : fallback.chart.type;
      if (chartType === "none") return { type: "none" as const, x: "", y: [], title: undefined };
      const x = asString(proposed?.x) ?? fallback.chart.x;
      const y = asArrayOfStrings(proposed?.y);
      const yUse = y.length > 0 ? y : fallback.chart.y;
      if (!x || yUse.length === 0 || !columns.includes(x) || yUse.some((col) => !columns.includes(col))) {
        return fallback.chart;
      }
      return {
        type: chartType,
        x,
        y: yUse.slice(0, 3),
        title: asString(proposed?.title) ?? fallback.chart.title,
      };
    })();

    const followUps = (() => {
      const candidate = asArrayOfStrings(modelRun?.follow_up_questions).slice(0, 3);
      if (candidate.length === 0) return fallback.follow_up_questions;
      const allowedTokens = new Set(
        [...schema.canonical, ...schema.custom]
          .map((field) => field.field_key.toLowerCase())
          .flatMap((field) => tokenize(field.replace(/_/g, " "))),
      );
      const filtered = candidate.filter((questionText) => {
        const tokens = tokenize(questionText);
        const generic = ["compare", "trend", "break", "down", "period", "month", "revenue", "quantity"];
        return tokens.some((token) => allowedTokens.has(token) || generic.includes(token));
      });
      return (filtered.length > 0 ? filtered : fallback.follow_up_questions).slice(0, 3);
    })();

    return new Response(
      JSON.stringify({
        conversation_id: conversationId,
        answer_title: answerTitle,
        answer_text: answerText,
        why_this_matters: whyThisMatters,
        kpis,
        table: previewRows.length > 0 ? { columns, rows: previewRows } : undefined,
        chart,
        evidence,
        follow_up_questions: followUps,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
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
