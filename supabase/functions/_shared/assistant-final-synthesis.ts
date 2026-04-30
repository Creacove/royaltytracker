import type { EvidenceAnswerPack, InsightsMode } from "./assistant-evidence-contract.ts";

export type FinalSynthesisEvidenceSource = {
  job_id: string;
  purpose: string;
  requirement: string;
  status: string;
  row_count: number;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  warnings: string[];
  source_type: "sql" | "rights_splits" | "documents" | "quality" | "external" | "sidecar";
};

export type FinalSynthesisWebEnrichment = {
  status: "available" | "unavailable" | "not_requested";
  summary?: string;
  citations?: Array<Record<string, unknown>>;
};

export type FinalSynthesisInput = {
  question: string;
  mode: InsightsMode;
  entityContext: Record<string, unknown>;
  evidence_sources: FinalSynthesisEvidenceSource[];
  evidence_answer_pack: EvidenceAnswerPack | null;
  web_enrichment: FinalSynthesisWebEnrichment | null;
  caveats: string[];
};

export type FinalSynthesisPrompt = {
  systemPrompt: string;
  userPrompt: string;
  expectedJsonKeys: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function rows(value: unknown, limit: number): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(asRecord(item))).slice(0, limit)
    : [];
}

function evidenceStatus(job: Record<string, unknown>): string {
  if (typeof job.error === "string" && job.error.trim()) return "failed";
  if (Number(job.row_count ?? 0) <= 0) return "empty";
  return asString(job.verifier_status, "passed");
}

function compactSqlJob(job: Record<string, unknown>, rowLimit: number): FinalSynthesisEvidenceSource {
  return {
    job_id: asString(job.job_id, "unknown-job"),
    purpose: asString(job.purpose, "Evidence source"),
    requirement: asString(job.requirement, "supporting"),
    status: evidenceStatus(job),
    row_count: Number(job.row_count ?? 0),
    columns: asStringArray(job.columns),
    rows: rows(job.rows, rowLimit),
    warnings: asStringArray(job.warnings),
    source_type: "sql",
  };
}

export function compactEvidenceForFinalSynthesis(args: {
  question: string;
  mode: InsightsMode;
  entityContext?: Record<string, unknown>;
  evidenceBundle: Record<string, unknown>;
  webEnrichment?: FinalSynthesisWebEnrichment | null;
  rowLimitPerSource?: number;
}): FinalSynthesisInput {
  const rowLimit = Math.max(3, Math.min(15, args.rowLimitPerSource ?? 10));
  const sqlJobs = Array.isArray(args.evidenceBundle.sql_evidence_jobs)
    ? args.evidenceBundle.sql_evidence_jobs.filter((job): job is Record<string, unknown> => Boolean(asRecord(job)))
    : [];
  const evidenceAnswerPack = asRecord(args.evidenceBundle.evidence_answer_pack) as EvidenceAnswerPack | null;
  const sidecar = asRecord(args.evidenceBundle.structured_sidecar_evidence);
  const sidecarCaveats = Array.isArray(sidecar?.caveats) ? asStringArray(sidecar?.caveats) : [];
  return {
    question: args.question,
    mode: args.mode,
    entityContext: args.entityContext ?? {},
    evidence_sources: sqlJobs.map((job) => compactSqlJob(job, rowLimit)),
    evidence_answer_pack: evidenceAnswerPack,
    web_enrichment: args.webEnrichment ?? null,
    caveats: [
      ...sidecarCaveats,
      ...sqlJobs.flatMap((job) => asStringArray(job.warnings)),
    ].slice(0, 12),
  };
}

export function buildFinalSynthesisPrompt(input: FinalSynthesisInput): FinalSynthesisPrompt {
  const expectedJsonKeys = [
    "answer_title",
    "executive_answer",
    "why_this_matters",
    "evidence_summary",
    "strategic_read",
    "caveats",
    "follow_up_questions",
    "quality_self_check",
    "synthesis_source",
  ];
  const systemPrompt = [
    "You are the final senior music-business analyst for an AI product that should feel like ChatGPT for music business.",
    "You write the user-visible answer after deterministic systems gather and verify evidence.",
    "Write both executive_answer and why_this_matters yourself. why_this_matters must feel like a premium paid analyst: strategic, specific, and useful.",
    "The why_this_matters field is not a summary. It must add analyst judgment: business implication, risk or opportunity, tradeoff, next operating move, and the metric or evidence source that should be watched next.",
    "Only include recommended_actions when the question explicitly asks for actions, a plan, steps, recommendations, or strategy beyond what executive_answer and why_this_matters already cover.",
    "If you include recommended_actions, each item must have a concrete action string and rationale string. Otherwise return an empty array.",
    "Use every relevant evidence source. Keep database facts, strategic interpretation, recommended actions, and caveats distinct.",
    "Do not collapse the answer to one metric. Do not say evidence is missing when a provided evidence source satisfies the question.",
    "Avoid generic business filler such as investor confidence, strategic financial management, competitive positioning, or future growth initiatives unless the evidence directly supports those claims.",
    "Do not repeat the executive_answer inside why_this_matters.",
    "If strategy is requested, infer strategy from revenue, platform mix, territory mix, track performance, trend changes, rights/quality caveats, and web enrichment when available.",
    "Internal database evidence is primary. Web enrichment supports context and timing but must not override database facts.",
    "Respect mode: workspace means whole catalog, artist means selected artist and that artist's tracks/platforms/territories, track means selected track only.",
    `Return strict JSON with keys: ${expectedJsonKeys.join(", ")}.`,
  ].join(" ");

  const userPrompt = JSON.stringify({
    question: input.question,
    mode: input.mode,
    entity_context: input.entityContext,
    evidence_answer_pack: input.evidence_answer_pack,
    evidence_sources: input.evidence_sources,
    web_enrichment: input.web_enrichment,
    caveats: input.caveats,
    output_rules: {
      executive_answer: "Answer the exact question in rich prose with concrete names, numbers, and decisions.",
      why_this_matters: "Write a separate senior analyst take: what decision this changes, what risk/opportunity it exposes, what tradeoff management faces, what to do next, and which evidence-backed metric to watch.",
      recommended_actions: "Return [] unless separate action cards are genuinely useful. Never return empty objects or placeholder action items.",
      forbidden: [
        "Do not write generic follow-up questions as the answer.",
        "Do not ask the user to rerun when the required evidence source is present.",
        "Do not recommend Unknown territories as targets.",
        "Do not recommend the selected artist as their own lever in artist mode.",
      ],
    },
  });

  return { systemPrompt, userPrompt, expectedJsonKeys };
}
