import {
  type AnalysisPlan,
  type ArtistCatalog,
  compileSqlFromPlan,
  deriveAnalysisPlanFallback,
  validatePlannedSql,
  verifyQueryResult,
} from "./assistant-query-engine.ts";
import {
  planAnswerEvidence,
  type AudienceMode,
  type EvidenceJobRequirement,
  type MultiEvidencePlan,
  type SidecarEvidenceJob,
  type SqlEvidenceJob,
} from "./answer-planner.ts";

type ScopeMode = "track" | "artist" | "workspace";

export type AiNativeSchemaColumn = {
  field_key: string;
  inferred_type: string;
  source: "canonical" | "custom";
  coverage_pct: number;
  aliases: string[];
  sample_values: unknown[];
  meaning: string;
};

export type AiNativeSchemaMap = {
  original_question: string;
  mode: ScopeMode;
  from_date: string;
  to_date: string;
  approved_relations: string[];
  row_limit: number;
  columns: AiNativeSchemaColumn[];
  aliases: Record<string, string[]>;
  domain_mappings: Array<{ phrase: string; field_key: string; reason: string }>;
  safe_query_patterns: string[];
};

export type AiNativeSqlEvidenceJob = Omit<SqlEvidenceJob, "analysis_plan"> & {
  analysis_plan?: AnalysisPlan;
  original_question: string;
  sub_question: string;
  expected_contribution: string;
  sql?: string;
  sql_source?: "llm" | "fallback";
};

export type AiNativeEvidencePlan = Omit<MultiEvidencePlan, "sql_jobs"> & {
  sql_jobs: AiNativeSqlEvidenceJob[];
};

export type AiNativeSqlJobResult = {
  job_id: string;
  purpose: string;
  requirement: EvidenceJobRequirement;
  required_for_answer: boolean;
  original_question: string;
  sub_question: string;
  expected_contribution: string;
  analysis_plan: AnalysisPlan;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
  row_count: number;
  chosen_columns: string[];
  verifier_status: "passed" | "failed";
  warnings: string[];
  sql_preview: string;
  sql_hash: string;
  sql_source: "llm" | "fallback";
  repair_status: "not_needed" | "repaired" | "failed" | "not_attempted";
  error?: string;
};

type SqlExecutionResponse = {
  columns?: string[];
  rows?: Array<Record<string, unknown>>;
  row_count?: number;
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
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function stableHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

function sanitizeRows(rows: unknown): Array<Record<string, string | number | null>> {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const out: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      out[key] = value === null || value === undefined
        ? null
        : typeof value === "string" || typeof value === "number"
        ? value
        : JSON.stringify(value);
    }
    return [out];
  });
}

function columnMeaning(fieldKey: string): string {
  if (fieldKey === "territory") return "Location, country, market, or geographic territory.";
  if (fieldKey === "platform") return "DSP, platform, service, channel, or store.";
  if (fieldKey === "net_revenue") return "Net royalty revenue or earnings after deductions when available.";
  if (fieldKey === "gross_revenue") return "Gross royalty revenue before deductions.";
  if (fieldKey === "share_pct") return "Ownership, split, entitlement, or payable percentage.";
  if (fieldKey === "party_name") return "Writer, publisher, owner, rightsholder, payee, or collection party.";
  if (fieldKey === "event_date") return "Date used for trend, comparison, and time-window questions.";
  if (fieldKey.includes("confidence") || fieldKey.includes("validation")) return "Data quality, confidence, or validation signal.";
  return "Available assistant data field.";
}

export function buildAiNativeSchemaMap(args: {
  catalog: ArtistCatalog;
  mode: ScopeMode;
  question: string;
  fromDate: string;
  toDate: string;
}): AiNativeSchemaMap {
  const domainMappings = [
    { phrase: "location", field_key: "territory", reason: "User-facing location language maps to territory in assistant data." },
    { phrase: "country", field_key: "territory", reason: "Country is stored as territory." },
    { phrase: "market", field_key: "territory", reason: "Market analysis is grouped by territory." },
    { phrase: "DSP", field_key: "platform", reason: "DSP/service/channel language maps to platform." },
    { phrase: "service", field_key: "platform", reason: "Streaming services are stored as platform." },
    { phrase: "split", field_key: "share_pct", reason: "Rights split percentages are stored as share_pct when available." },
    { phrase: "ownership", field_key: "share_pct", reason: "Ownership share is represented by share_pct when available." },
    { phrase: "writer", field_key: "party_name", reason: "Writers and publishers are represented as party_name when rights evidence is available." },
    { phrase: "publisher", field_key: "party_name", reason: "Publisher/rightsholder entities are represented as party_name." },
  ].filter((mapping) => args.catalog.columns.some((column) => column.field_key === mapping.field_key));

  return {
    original_question: args.question,
    mode: args.mode,
    from_date: args.fromDate,
    to_date: args.toDate,
    approved_relations: ["scoped_core", "scoped_custom", "scoped_columns", "schema_json"],
    row_limit: 200,
    aliases: args.catalog.aliases,
    domain_mappings: domainMappings,
    columns: args.catalog.columns.map((column) => ({
      field_key: column.field_key,
      inferred_type: String(column.inferred_type ?? "text"),
      source: column.source === "custom" ? "custom" : "canonical",
      coverage_pct: Number(column.coverage_pct ?? 0),
      aliases: column.aliases ?? args.catalog.aliases[column.field_key] ?? [],
      sample_values: (column.sample_values ?? []).slice(0, 5),
      meaning: columnMeaning(column.field_key),
    })),
    safe_query_patterns: [
      "Use SELECT or WITH only.",
      "Use scoped_core for canonical fields.",
      "Use scoped_custom for custom_properties fields.",
      "Aggregate before ordering by revenue or quantities.",
      "Always add a LIMIT no higher than 200.",
      "Do not use semicolons, SQL comments, mutation keywords, or schema-qualified production tables.",
    ],
  };
}

function emptyPlan(question: string): MultiEvidencePlan {
  return {
    intent: "exploratory_analysis",
    answer_goal: question,
    audience_mode: "general",
    sub_questions: [],
    answer_requirements: ["answer the user's main question"],
    evidence_jobs: [],
    synthesis_requirements: [],
    answer_sections: [],
    sql_jobs: [],
    sidecar_jobs: [],
    external_context_policy: "forbidden",
    missing_evidence_policy: "degrade_with_caveat",
  };
}

function normalizeAnalysisPlan(raw: unknown, question: string, catalog: ArtistCatalog): AnalysisPlan {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Partial<AnalysisPlan>;
    const fallback = deriveAnalysisPlanFallback(question, catalog);
    return {
      intent: asString(record.intent) ?? fallback.intent,
      metrics: asArrayOfStrings(record.metrics),
      dimensions: asArrayOfStrings(record.dimensions),
      filters: Array.isArray(record.filters) ? record.filters as AnalysisPlan["filters"] : [],
      grain: record.grain === "day" || record.grain === "week" || record.grain === "month" || record.grain === "quarter" || record.grain === "none" ? record.grain : fallback.grain,
      time_window: record.time_window === "explicit" ? "explicit" : "implicit",
      confidence: record.confidence === "high" || record.confidence === "medium" || record.confidence === "low" ? record.confidence : fallback.confidence,
      required_columns: asArrayOfStrings(record.required_columns),
      top_n: typeof record.top_n === "number" ? Math.min(50, Math.max(1, Math.round(record.top_n))) : fallback.top_n,
      sort_by: asString(record.sort_by) ?? fallback.sort_by,
      sort_dir: record.sort_dir === "asc" ? "asc" : "desc",
    };
  }
  return deriveAnalysisPlanFallback(question, catalog);
}

export function normalizeAiEvidencePlan(args: {
  raw: unknown;
  question: string;
  catalog?: ArtistCatalog;
  mode?: ScopeMode;
  fallback?: MultiEvidencePlan;
}): AiNativeEvidencePlan {
  const fallback = args.fallback ?? (args.catalog && args.mode
    ? planAnswerEvidence({ question: args.question, catalog: args.catalog, mode: args.mode })
    : emptyPlan(args.question));
  const raw = args.raw && typeof args.raw === "object" && !Array.isArray(args.raw)
    ? args.raw as Record<string, unknown>
    : {};
  const rawSqlJobs = Array.isArray(raw.sql_jobs) ? raw.sql_jobs : [];
  const catalog = args.catalog;
  const fallbackPrimary = fallback.sql_jobs[0]?.analysis_plan;

  const sqlJobs = rawSqlJobs.flatMap((item, index): AiNativeSqlEvidenceJob[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const jobId = asString(record.job_id) ?? (index === 0 ? "primary" : `sql-${index + 1}`);
    const purpose = asString(record.purpose) ?? asString(record.expected_contribution) ?? "gather SQL evidence";
    const subQuestion = asString(record.sub_question) ?? asString(record.question) ?? args.question;
    const analysisPlan = catalog
      ? normalizeAnalysisPlan(record.analysis_plan, subQuestion, catalog)
      : fallbackPrimary ?? deriveAnalysisPlanFallback(subQuestion, { total_rows: 0, columns: [], aliases: {} });
    const requirementRaw = asString(record.requirement);
    const requirement: EvidenceJobRequirement = requirementRaw === "required" || requirementRaw === "optional" ? requirementRaw : "supporting";
    return [{
      job_id: jobId,
      purpose,
      requirement,
      required_for_answer: record.required_for_answer === true || requirement === "required",
      analysis_plan: analysisPlan,
      original_question: args.question,
      sub_question: subQuestion,
      expected_contribution: asString(record.expected_contribution) ?? purpose,
      sql: asString(record.sql) ?? asString(record.planned_sql) ?? undefined,
      sql_source: asString(record.sql) || asString(record.planned_sql) ? "llm" : "fallback",
    }];
  });

  const normalizedSqlJobs = sqlJobs.length > 0
    ? sqlJobs
    : fallback.sql_jobs.map((job) => ({
      ...job,
      original_question: args.question,
      sub_question: job.purpose,
      expected_contribution: job.purpose,
      sql_source: "fallback" as const,
    }));

  const sidecarJobs = (Array.isArray(raw.sidecar_jobs) ? raw.sidecar_jobs : fallback.sidecar_jobs)
    .flatMap((item): SidecarEvidenceJob[] => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      const kind = asString(record.kind);
      const normalizedKind = kind === "rights_splits" || kind === "source_documents" || kind === "data_quality" || kind === "external_context"
        ? kind
        : null;
      const jobId = asString(record.job_id);
      if (!normalizedKind || !jobId) return [];
      const requirementRaw = asString(record.requirement);
      return [{
        job_id: jobId,
        kind: normalizedKind,
        purpose: asString(record.purpose) ?? `attach ${normalizedKind} evidence`,
        requirement: requirementRaw === "required" || requirementRaw === "optional" ? requirementRaw : "supporting",
        required_for_answer: record.required_for_answer === true,
      }];
    });

  return {
    ...fallback,
    intent: asString(raw.intent) ?? fallback.intent,
    answer_goal: asString(raw.answer_goal) ?? args.question,
    audience_mode: (asString(raw.audience_mode) as AudienceMode | null) ?? fallback.audience_mode,
    sql_jobs: normalizedSqlJobs,
    sidecar_jobs: sidecarJobs,
    missing_evidence_policy: "degrade_with_caveat",
  };
}

export async function planAiNativeEvidence(args: {
  question: string;
  catalog: ArtistCatalog;
  mode: ScopeMode;
  schemaMap: AiNativeSchemaMap;
  fallback: MultiEvidencePlan;
  callJson?: (input: { systemPrompt: string; userPrompt: string }) => Promise<unknown>;
}): Promise<{ plan: AiNativeEvidencePlan; source: "llm" | "fallback" }> {
  if (!args.callJson) {
    return { plan: normalizeAiEvidencePlan({ raw: {}, question: args.question, catalog: args.catalog, mode: args.mode, fallback: args.fallback }), source: "fallback" };
  }
  try {
    const raw = await args.callJson({
      systemPrompt: [
        "You are an AI-native evidence planner for a music royalty analytics app.",
        "Ground every decision in the original user question and the schema map.",
        "Return JSON with intent, answer_goal, sql_jobs, sidecar_jobs, answer_sections, and synthesis_requirements.",
        "Request multiple SQL jobs when that would make the final answer richer.",
        "Missing sidecar evidence should degrade with a caveat, not block useful SQL-backed answers.",
      ].join(" "),
      userPrompt: JSON.stringify({ original_question: args.question, schema_map: args.schemaMap }),
    });
    return {
      plan: normalizeAiEvidencePlan({ raw, question: args.question, catalog: args.catalog, mode: args.mode, fallback: args.fallback }),
      source: "llm",
    };
  } catch {
    return { plan: normalizeAiEvidencePlan({ raw: {}, question: args.question, catalog: args.catalog, mode: args.mode, fallback: args.fallback }), source: "fallback" };
  }
}

async function sqlForJob(args: {
  job: AiNativeSqlEvidenceJob;
  schemaMap: AiNativeSchemaMap;
  catalog: ArtistCatalog;
  writeSql?: (input: { job: AiNativeSqlEvidenceJob; schema_map: AiNativeSchemaMap }) => Promise<{ sql?: string }>;
}): Promise<{ sql: string; chosen_columns: string[]; source: "llm" | "fallback" }> {
  const plan = args.job.analysis_plan ?? deriveAnalysisPlanFallback(args.job.sub_question || args.job.original_question, args.catalog);
  if (args.job.sql) {
    return { sql: validatePlannedSql(args.job.sql), chosen_columns: unique([...plan.dimensions, ...plan.metrics]), source: args.job.sql_source ?? "llm" };
  }
  if (args.writeSql) {
    const written = await args.writeSql({ job: args.job, schema_map: args.schemaMap });
    const sql = asString(written?.sql);
    if (sql) {
      return { sql: validatePlannedSql(sql), chosen_columns: unique([...plan.dimensions, ...plan.metrics]), source: "llm" };
    }
  }
  const compiled = compileSqlFromPlan(plan, args.catalog);
  return { sql: validatePlannedSql(compiled.sql), chosen_columns: compiled.chosen_columns, source: "fallback" };
}

function failedResult(args: {
  job: AiNativeSqlEvidenceJob;
  sql: string;
  chosenColumns: string[];
  source: "llm" | "fallback";
  repairStatus: AiNativeSqlJobResult["repair_status"];
  error: unknown;
}): AiNativeSqlJobResult {
  const plan = args.job.analysis_plan ?? deriveAnalysisPlanFallback(args.job.sub_question || args.job.original_question, { total_rows: 0, columns: [], aliases: {} });
  return {
    job_id: args.job.job_id,
    purpose: args.job.purpose,
    requirement: args.job.requirement,
    required_for_answer: args.job.required_for_answer,
    original_question: args.job.original_question,
    sub_question: args.job.sub_question,
    expected_contribution: args.job.expected_contribution,
    analysis_plan: plan,
    columns: [],
    rows: [],
    row_count: 0,
    chosen_columns: args.chosenColumns,
    verifier_status: "failed",
    warnings: [],
    sql_preview: args.sql.replace(/\s+/g, " ").slice(0, 1200),
    sql_hash: stableHash(args.sql),
    sql_source: args.source,
    repair_status: args.repairStatus,
    error: args.error instanceof Error ? args.error.message : "SQL evidence job failed.",
  };
}

async function runValidatedSql(args: {
  job: AiNativeSqlEvidenceJob;
  sql: string;
  chosenColumns: string[];
  source: "llm" | "fallback";
  runSql: (sql: string) => Promise<SqlExecutionResponse>;
}): Promise<AiNativeSqlJobResult> {
  const plan = args.job.analysis_plan ?? deriveAnalysisPlanFallback(args.job.sub_question || args.job.original_question, { total_rows: 0, columns: [], aliases: {} });
  const sqlResult = await args.runSql(args.sql);
  const columns = asArrayOfStrings(sqlResult.columns);
  const rows = sanitizeRows(sqlResult.rows);
  const verifier = verifyQueryResult({
    question: args.job.original_question,
    plan,
    columns,
    rows: rows as Array<Record<string, unknown>>,
  });
  return {
    job_id: args.job.job_id,
    purpose: args.job.purpose,
    requirement: args.job.requirement,
    required_for_answer: args.job.required_for_answer,
    original_question: args.job.original_question,
    sub_question: args.job.sub_question,
    expected_contribution: args.job.expected_contribution,
    analysis_plan: plan,
    columns,
    rows: rows.slice(0, 25),
    row_count: Number(sqlResult.row_count ?? rows.length),
    chosen_columns: args.chosenColumns,
    verifier_status: verifier.status,
    warnings: verifier.warnings ?? [],
    sql_preview: args.sql.replace(/\s+/g, " ").slice(0, 1200),
    sql_hash: stableHash(args.sql),
    sql_source: args.source,
    repair_status: "not_needed",
    error: verifier.status === "failed" ? verifier.reason : undefined,
  };
}

export async function executeSqlEvidenceJobWithRepair(args: {
  job: AiNativeSqlEvidenceJob;
  schemaMap: AiNativeSchemaMap;
  catalog: ArtistCatalog;
  runSql: (sql: string) => Promise<SqlExecutionResponse>;
  writeSql?: (input: { job: AiNativeSqlEvidenceJob; schema_map: AiNativeSchemaMap }) => Promise<{ sql?: string }>;
  repairSql?: (input: {
    original_question: string;
    sub_question: string;
    failed_sql: string;
    error: string;
    schema_map: AiNativeSchemaMap;
    job: AiNativeSqlEvidenceJob;
  }) => Promise<{ sql?: string }>;
}): Promise<AiNativeSqlJobResult> {
  let plannedSql = "";
  let chosenColumns: string[] = [];
  let source: "llm" | "fallback" = "fallback";
  try {
    const planned = await sqlForJob({ job: args.job, schemaMap: args.schemaMap, catalog: args.catalog, writeSql: args.writeSql });
    plannedSql = planned.sql;
    chosenColumns = planned.chosen_columns;
    source = planned.source;
    return await runValidatedSql({ job: args.job, sql: plannedSql, chosenColumns, source, runSql: args.runSql });
  } catch (error) {
    if (!args.repairSql || !plannedSql) {
      return failedResult({ job: args.job, sql: plannedSql, chosenColumns, source, repairStatus: "not_attempted", error });
    }
    const errorMessage = error instanceof Error ? error.message : "SQL evidence job failed.";
    try {
      const repaired = await args.repairSql({
        original_question: args.job.original_question,
        sub_question: args.job.sub_question,
        failed_sql: plannedSql,
        error: errorMessage,
        schema_map: args.schemaMap,
        job: args.job,
      });
      const repairedSql = validatePlannedSql(asString(repaired?.sql) ?? "");
      const result = await runValidatedSql({ job: args.job, sql: repairedSql, chosenColumns, source: "llm", runSql: args.runSql });
      return { ...result, repair_status: "repaired" };
    } catch (repairError) {
      return failedResult({ job: args.job, sql: plannedSql, chosenColumns, source, repairStatus: "failed", error: repairError });
    }
  }
}
