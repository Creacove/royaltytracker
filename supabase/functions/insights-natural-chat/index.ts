import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PLAN_TOKEN_TTL_MINUTES = 15;
const SQL_ROW_LIMIT = 200;
const SQL_TIMEOUT_MS = 3000;

type Action = "plan_query" | "run_query";

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

type PlanModelResponse = {
  understood_question?: string;
  sql_preview?: string;
  expected_columns?: string[];
};

type RunModelResponse = {
  answer_title?: string;
  answer_text?: string;
  kpis?: Array<{ label?: string; value?: string; change?: string }>;
  chart?: { type?: "bar" | "line" | "none"; x?: string; y?: string[]; title?: string };
  follow_up_questions?: string[];
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
  if (!payload || typeof payload !== "object") throw new Error("Invalid execution token payload.");
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
      if (depth === 0 && start >= 0) {
        return trimmed.slice(start, i + 1);
      }
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

function toEvidence(sqlResult: SqlExecutionResponse, fromDate: string, toDate: string) {
  return {
    row_count: Number.isFinite(Number(sqlResult.row_count)) ? Number(sqlResult.row_count) : 0,
    duration_ms: Number.isFinite(Number(sqlResult.duration_ms)) ? Number(sqlResult.duration_ms) : 0,
    from_date: fromDate,
    to_date: toDate,
    provenance: asArrayOfStrings(sqlResult.query_provenance),
  };
}

function fallbackRunResponse({
  question,
  columns,
  rows,
  evidence,
}: {
  question: string;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
  evidence: ReturnType<typeof toEvidence>;
}) {
  const previewRows = rows.slice(0, 20);
  return {
    answer_title: "Answer Ready",
    answer_text:
      evidence.row_count === 0
        ? "No matching activity was found for this track in the selected period."
        : `Here is the clearest answer to "${question}" for this track and period.`,
    kpis: [],
    table: previewRows.length > 0 ? { columns, rows: previewRows } : undefined,
    chart: { type: "none", x: "", y: [], title: undefined },
    evidence,
    follow_up_questions: [
      "Break this down by territory for the same period.",
      "Compare this against the previous 90 days.",
    ],
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
    const signingSecret = Deno.env.get("CHAT_SQL_SIGNING_SECRET");
    const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4.1-mini";

    if (!supabaseUrl || !serviceRoleKey || !anonKey) throw new Error("Missing Supabase env.");
    if (!openAiKey) throw new Error("Missing OPENAI_API_KEY secret.");
    if (!signingSecret) throw new Error("Missing CHAT_SQL_SIGNING_SECRET secret.");

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
    if (action !== "plan_query" && action !== "run_query") {
      return new Response(JSON.stringify({ error: "Unsupported action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const trackKey = asString((body as { track_key?: unknown }).track_key);
    const question = asString((body as { question?: unknown }).question);
    if (!trackKey) throw new Error("track_key is required.");
    const { fromDate, toDate } = normalizeDateRange(
      (body as { from_date?: unknown }).from_date,
      (body as { to_date?: unknown }).to_date,
    );

    if (action === "plan_query") {
      if (!question) throw new Error("question is required for plan_query.");

      const systemPrompt = [
        "You are a SQL planner for publisher analytics.",
        "Generate one safe SQL statement as JSON.",
        "Rules:",
        "- Output JSON with keys: understood_question, sql_preview, expected_columns.",
        "- sql_preview must start with SELECT or WITH.",
        "- Use only these relations: scoped_facts, scoped_quality, scoped_coverage.",
        "- Never reference schema-qualified names.",
        "- Never include comments, semicolons, quoted identifiers, or DDL/DML.",
        "- Keep query concise and read-only.",
      ].join("\n");

      const userPrompt = JSON.stringify({
        question,
        scope: {
          track_key: trackKey,
          from_date: fromDate,
          to_date: toDate,
          relations: {
            scoped_facts: [
              "track_key",
              "event_date",
              "territory",
              "platform",
              "usage_type",
              "net_revenue",
              "gross_revenue",
              "commission",
              "quantity",
              "report_id",
              "source_row_id",
            ],
            scoped_quality: [
              "track_key",
              "failed_line_count",
              "warning_line_count",
              "open_task_count",
              "open_critical_task_count",
              "validation_critical_count",
              "validation_warning_count",
              "validation_info_count",
              "avg_confidence",
              "line_count",
            ],
            scoped_coverage: [
              "track_key",
              "field_name",
              "populated_rows",
              "total_rows",
              "coverage_pct",
            ],
          },
        },
      });

      const planned = await callOpenAiJson<PlanModelResponse>({
        apiKey: openAiKey,
        model,
        systemPrompt,
        userPrompt,
      });

      const understoodQuestion = asString(planned.understood_question) ?? question;
      const sqlPreview = validatePlannedSql(asString(planned.sql_preview) ?? "");
      const expectedColumns = asArrayOfStrings(planned.expected_columns);

      const planId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + PLAN_TOKEN_TTL_MINUTES * 60 * 1000).toISOString();
      const tokenPayload: PlanTokenPayload = {
        plan_id: planId,
        user_id: requesterId,
        track_key: trackKey,
        from_date: fromDate,
        to_date: toDate,
        sql_preview: sqlPreview,
        question,
        expires_at: expiresAt,
      };
      const executionToken = await signExecutionToken(signingSecret, tokenPayload);

      return new Response(
        JSON.stringify({
          plan_id: planId,
          understood_question: understoodQuestion,
          sql_preview: sqlPreview,
          expected_columns: expectedColumns,
          execution_token: executionToken,
          expires_at: expiresAt,
          safety: {
            read_only: true,
            row_limit: SQL_ROW_LIMIT,
            timeout_ms: SQL_TIMEOUT_MS,
            track_scoped: true,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const planId = asString((body as { plan_id?: unknown }).plan_id);
    const executionToken = asString((body as { execution_token?: unknown }).execution_token);
    const sqlPreview = asString((body as { sql_preview?: unknown }).sql_preview);

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

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    });

    const { data: rpcData, error: rpcError } = await userClient.rpc("run_track_chat_sql_v1", {
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
    const previewRows = rows.slice(0, 20);

    const runPromptSystem = [
      "You are an analytics assistant for music publishers.",
      "Explain results in plain business language.",
      "Output JSON with keys: answer_title, answer_text, kpis, chart, follow_up_questions.",
      "Never output raw JSON blobs inside answer_text.",
      "Keep kpis between 2 and 6 items with clear labels.",
      "If no data, state that clearly and suggest next checks.",
    ].join("\n");

    const runPromptUser = JSON.stringify({
      question: verifiedPayload.question,
      sql_preview: cleanedSql,
      result: {
        columns,
        rows: previewRows,
        row_count: evidence.row_count,
      },
      context: {
        track_key: trackKey,
        from_date: fromDate,
        to_date: toDate,
        query_provenance: evidence.provenance,
      },
    });

    let modelRun: RunModelResponse | null = null;
    try {
      modelRun = await callOpenAiJson<RunModelResponse>({
        apiKey: openAiKey,
        model,
        systemPrompt: runPromptSystem,
        userPrompt: runPromptUser,
      });
    } catch {
      modelRun = null;
    }

    const fallback = fallbackRunResponse({
      question: verifiedPayload.question,
      columns,
      rows,
      evidence,
    });

    const answerTitle = asString(modelRun?.answer_title) ?? fallback.answer_title;
    const answerText = asString(modelRun?.answer_text) ?? fallback.answer_text;
    const kpis =
      Array.isArray(modelRun?.kpis) && modelRun?.kpis.length > 0
        ? modelRun!.kpis!
            .map((kpi) => ({
              label: asString(kpi.label) ?? "",
              value: asString(kpi.value) ?? "",
              change: asString(kpi.change) ?? undefined,
            }))
            .filter((kpi) => kpi.label.length > 0 && kpi.value.length > 0)
            .slice(0, 6)
        : fallback.kpis;

    const chart = (() => {
      const proposed = modelRun?.chart;
      const chartType = proposed?.type === "bar" || proposed?.type === "line" || proposed?.type === "none"
        ? proposed.type
        : "none";
      if (chartType === "none") return { type: "none" as const, x: "", y: [], title: undefined };
      const x = asString(proposed?.x);
      const y = asArrayOfStrings(proposed?.y);
      if (!x || y.length === 0 || !columns.includes(x) || y.some((col) => !columns.includes(col))) {
        return { type: "none" as const, x: "", y: [], title: undefined };
      }
      return {
        type: chartType,
        x,
        y,
        title: asString(proposed?.title) ?? undefined,
      };
    })();

    const followUps =
      asArrayOfStrings(modelRun?.follow_up_questions).slice(0, 3).length > 0
        ? asArrayOfStrings(modelRun?.follow_up_questions).slice(0, 3)
        : fallback.follow_up_questions;

    return new Response(
      JSON.stringify({
        answer_title: answerTitle,
        answer_text: answerText,
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
