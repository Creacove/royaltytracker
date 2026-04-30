export type InsightsMode = "workspace" | "workspace-general" | "artist" | "track";

export type EvidenceObjective =
  | "touring_market_shortlist"
  | "platform_revenue_ranking"
  | "artist_budget_allocation"
  | "artist_next_focus"
  | "year_revenue_total"
  | "loss_leakage_diagnosis"
  | "rights_payout"
  | "track_priority"
  | "quality_revenue_risk"
  | "trend_growth_drivers"
  | "general_revenue_answer";

export type EvidenceSlotContract = {
  slot_id: string;
  required: boolean;
  expected_dimensions: string[];
  expected_metrics: string[];
  unknown_policy: "exclude_from_recommendation" | "caveat" | "allow";
};

export type QuestionIntent = {
  objective: EvidenceObjective;
  normalized_question: string;
  mode: InsightsMode;
  required_slots: EvidenceSlotContract[];
  optional_slots: EvidenceSlotContract[];
};

export type EvidenceJobLike = {
  job_id: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  row_count: number;
  error?: string;
  verifier_status?: string;
  warnings?: string[];
  purpose?: string;
  requirement?: string;
  required_for_answer?: boolean;
  sql_hash?: string;
  sql_preview?: string;
  sql_source?: string;
  repair_status?: string;
};

export type EvidenceSlotResult = {
  slot_id: string;
  job_id: string;
  status: "passed" | "partial" | "failed" | "empty";
  required: boolean;
  row_count: number;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  warnings: string[];
  source?: string;
  sql_hash?: string;
  repair_status?: string;
};

export type EvidenceAnswerPack = {
  question_intent: QuestionIntent;
  evidence_slots: EvidenceSlotResult[];
  primary_slot_id: string | null;
  supporting_slot_ids: string[];
  caveats: string[];
  verified_answer_inputs: {
    primary_job_id: string | null;
    primary_columns: string[];
    primary_rows: Array<Record<string, unknown>>;
  };
  has_usable_evidence: boolean;
  diagnostics: {
    successful_job_ids: string[];
    failed_job_ids: string[];
    empty_job_ids: string[];
    selected_primary_job_id: string | null;
  };
};

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function canonical(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function normalizeQuestionText(question: string): string {
  return question
    .toLowerCase()
    .replace(/\bartistes?\b/g, "artist")
    .replace(/\breve?nue\b/g, "revenue")
    .replace(/\brevevnue\b/g, "revenue")
    .replace(/\bloosing\b/g, "losing")
    .replace(/\bplatforms\b/g, "platform")
    .replace(/\bdsp(s)?\b/g, "platform$1")
    .replace(/\blocations?\b/g, "territory")
    .replace(/\bmarkets?\b/g, "territory")
    .replace(/\bcountr(?:y|ies)\b/g, "territory")
    .replace(/\s+/g, " ")
    .trim();
}

function slot(slot_id: string, required: boolean, dimensions: string[], metrics: string[], unknown_policy: EvidenceSlotContract["unknown_policy"]): EvidenceSlotContract {
  return {
    slot_id,
    required,
    expected_dimensions: dimensions,
    expected_metrics: metrics,
    unknown_policy,
  };
}

export function inferQuestionIntent(question: string, mode: InsightsMode): QuestionIntent {
  const q = normalizeQuestionText(question);
  const asksTouring = /\b(tour|touring|live show|concert|venue|city|routing|booking)\b/.test(q);
  const asksPlatform = /\b(platform|spotify|apple|youtube|amazon|tidal|deezer|streaming|channel)\b/.test(q);
  const asksArtistBudget = /\bartist\b/.test(q) && /\b(marketing|budget|campaign|deserve|priority|prioritize|focus)\b/.test(q) && (mode === "workspace" || mode === "workspace-general");
  const asksFocus = /\b(what should|focus on next|next move|next step|prioritize|priority)\b/.test(q);
  const asksLoss = /\b(losing money|loss|leakage|underperform|worst|zero revenue|negative)\b/.test(q);
  const asksRights = /\b(writer|publisher|split|share|owner|getting|owed|payable|payout|entitlement)\b/.test(q);
  const asksQuality = /\b(quality|metadata|mapping|validation|confidence|bad data)\b/.test(q);
  const asksTrack = /\b(track|song|release|catalog)\b/.test(q);
  const asksTrend = /\b(changed|growth|grew|compared|versus|vs|202\d|201\d|trend|drivers?|factors?)\b/.test(q);
  const asksYearTotal = /\bhow much\b/.test(q) && /\b(20\d{2}|19\d{2})\b/.test(q);

  let objective: EvidenceObjective = "general_revenue_answer";
  const required: EvidenceSlotContract[] = [];
  const optional: EvidenceSlotContract[] = [];

  if (asksTouring) {
    objective = "touring_market_shortlist";
    required.push(slot("market_revenue_rank", true, ["territory"], ["net_revenue"], "exclude_from_recommendation"));
    optional.push(slot("platform_revenue_rank", false, ["platform"], ["net_revenue"], "caveat"));
    optional.push(slot("trend_revenue", false, ["event_date"], ["net_revenue"], "allow"));
  } else if (asksPlatform) {
    objective = "platform_revenue_ranking";
    required.push(slot("platform_revenue_rank", true, ["platform"], ["net_revenue"], "caveat"));
  } else if (asksArtistBudget) {
    objective = "artist_budget_allocation";
    required.push(slot("artist_revenue_rank", true, ["artist_name"], ["net_revenue"], "caveat"));
    optional.push(slot("trend_revenue", false, ["event_date"], ["net_revenue"], "allow"));
  } else if (mode === "artist" && asksFocus) {
    objective = "artist_next_focus";
    required.push(slot("track_revenue_rank", true, ["track_title"], ["net_revenue"], "caveat"));
    optional.push(slot("platform_revenue_rank", false, ["platform"], ["net_revenue"], "caveat"));
    optional.push(slot("market_revenue_rank", false, ["territory"], ["net_revenue"], "exclude_from_recommendation"));
  } else if (asksYearTotal) {
    objective = "year_revenue_total";
    required.push(slot("period_revenue_total", true, ["event_date"], ["gross_revenue", "net_revenue"], "allow"));
  } else if (asksLoss) {
    objective = "loss_leakage_diagnosis";
    required.push(slot(mode === "artist" ? "track_revenue_rank" : "artist_revenue_rank", true, [mode === "artist" ? "track_title" : "artist_name"], ["net_revenue"], "caveat"));
    optional.push(slot("quality_revenue_risk", false, ["mapping_confidence", "validation_status"], ["net_revenue"], "caveat"));
  } else if (asksRights) {
    objective = "rights_payout";
    required.push(slot("rights_split_context", true, ["party_name", "share_pct"], ["net_revenue"], "caveat"));
    optional.push(slot("revenue_context", false, [], ["net_revenue"], "allow"));
  } else if (asksQuality) {
    objective = "quality_revenue_risk";
    required.push(slot("quality_revenue_risk", true, ["mapping_confidence", "validation_status"], ["net_revenue"], "caveat"));
  } else if (asksTrack) {
    objective = "track_priority";
    required.push(slot("track_revenue_rank", true, ["track_title"], ["net_revenue"], "caveat"));
  } else if (asksTrend) {
    objective = "trend_growth_drivers";
    required.push(slot("trend_revenue", true, ["event_date"], ["net_revenue"], "allow"));
    optional.push(slot("platform_revenue_rank", false, ["platform"], ["net_revenue"], "caveat"));
    optional.push(slot("market_revenue_rank", false, ["territory"], ["net_revenue"], "exclude_from_recommendation"));
  } else {
    required.push(slot("revenue_context", true, [], ["net_revenue"], "allow"));
  }

  return {
    objective,
    normalized_question: q,
    mode,
    required_slots: required,
    optional_slots: optional,
  };
}

function columnsOf(job: EvidenceJobLike): string[] {
  return unique((job.columns ?? []).map(canonical));
}

function hasAny(columns: string[], expected: string[]): boolean {
  return expected.some((column) => columns.includes(canonical(column)));
}

function isUnknownValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const text = String(value).trim().toLowerCase();
  return text.length === 0 || text === "unknown" || text === "n/a" || text === "na";
}

function moneyColumn(columns: string[]): string | null {
  return ["net_revenue", "gross_revenue", "revenue", "royalty_revenue", "amount"].find((column) => columns.includes(column)) ?? null;
}

function slotIdForJob(job: EvidenceJobLike, intent: QuestionIntent): string {
  const columns = columnsOf(job);
  const id = job.job_id.toLowerCase();
  if (id.includes("territory") || columns.includes("territory")) return "market_revenue_rank";
  if (id.includes("platform") || columns.includes("platform")) return "platform_revenue_rank";
  if (id.includes("artist") || columns.includes("artist_name")) return "artist_revenue_rank";
  if (id.includes("track") || columns.includes("track_title")) return "track_revenue_rank";
  if (id.includes("quality") || columns.includes("mapping_confidence") || columns.includes("validation_status")) return "quality_revenue_risk";
  if (id.includes("rights") || columns.includes("party_name") || columns.includes("share_pct")) return "rights_split_context";
  if (id.includes("trend") || columns.includes("event_date") || columns.includes("month_start") || columns.includes("period_bucket")) return "trend_revenue";
  return intent.required_slots[0]?.slot_id ?? "revenue_context";
}

function slotContract(intent: QuestionIntent, slotId: string): EvidenceSlotContract {
  return [...intent.required_slots, ...intent.optional_slots].find((slot) => slot.slot_id === slotId)
    ?? slot(slotId, false, [], ["net_revenue"], "allow");
}

function filterRowsForSlot(rows: Array<Record<string, unknown>>, slotContract: EvidenceSlotContract): { rows: Array<Record<string, unknown>>; caveats: string[] } {
  if (slotContract.unknown_policy !== "exclude_from_recommendation") return { rows, caveats: [] };
  const territoryKey = slotContract.expected_dimensions.includes("territory") ? "territory" : null;
  if (!territoryKey) return { rows, caveats: [] };
  const knownRows = rows.filter((row) => !isUnknownValue(row[territoryKey]));
  const unknownCount = rows.length - knownRows.length;
  return {
    rows: knownRows,
    caveats: unknownCount > 0 ? [`Excluded ${unknownCount} unknown territory row${unknownCount === 1 ? "" : "s"} from recommendations.`] : [],
  };
}

export function verifyEvidenceJobAgainstIntent(job: EvidenceJobLike, intent: QuestionIntent): EvidenceSlotResult {
  const slotId = slotIdForJob(job, intent);
  const contract = slotContract(intent, slotId);
  const columns = columnsOf(job);
  const warnings = [...(Array.isArray(job.warnings) ? job.warnings : [])];
  if (job.error) {
    return { slot_id: slotId, job_id: job.job_id, status: "failed", required: contract.required, row_count: 0, columns, rows: [], warnings: [...warnings, String(job.error)], source: job.sql_source, sql_hash: job.sql_hash, repair_status: job.repair_status };
  }
  if (Number(job.row_count ?? 0) <= 0 || !Array.isArray(job.rows) || job.rows.length === 0) {
    return { slot_id: slotId, job_id: job.job_id, status: "empty", required: contract.required, row_count: 0, columns, rows: [], warnings, source: job.sql_source, sql_hash: job.sql_hash, repair_status: job.repair_status };
  }
  const hasDimension = contract.expected_dimensions.length === 0 || hasAny(columns, contract.expected_dimensions);
  const hasMetric = contract.expected_metrics.length === 0 || hasAny(columns, contract.expected_metrics) || moneyColumn(columns) !== null;
  const filtered = filterRowsForSlot(job.rows, contract);
  const status = hasDimension && hasMetric && filtered.rows.length > 0 ? "passed" : "partial";
  if (!hasDimension) warnings.push(`missing expected dimension for ${slotId}`);
  if (!hasMetric) warnings.push(`missing expected metric for ${slotId}`);
  return {
    slot_id: slotId,
    job_id: job.job_id,
    status,
    required: contract.required,
    row_count: filtered.rows.length,
    columns,
    rows: filtered.rows,
    warnings: [...warnings, ...filtered.caveats],
    source: job.sql_source,
    sql_hash: job.sql_hash,
    repair_status: job.repair_status,
  };
}

function scoreSlotForIntent(result: EvidenceSlotResult, intent: QuestionIntent): number {
  if (result.status === "failed" || result.status === "empty" || result.row_count <= 0) return Number.NEGATIVE_INFINITY;
  let score = result.status === "passed" ? 100 : 20;
  const requiredIndex = intent.required_slots.findIndex((slot) => slot.slot_id === result.slot_id);
  if (requiredIndex >= 0) score += 200 - requiredIndex;
  if (result.required) score += 25;
  if (result.columns.includes("net_revenue") || result.columns.includes("gross_revenue")) score += 10;
  if (result.job_id === "legacy-primary" && result.columns.length <= 1) score -= 40;
  return score;
}

export function buildEvidenceAnswerPack(args: {
  question: string;
  mode: InsightsMode;
  jobs: EvidenceJobLike[];
}): EvidenceAnswerPack {
  const intent = inferQuestionIntent(args.question, args.mode);
  const slots = args.jobs.map((job) => verifyEvidenceJobAgainstIntent(job, intent));
  const sorted = [...slots].sort((a, b) => scoreSlotForIntent(b, intent) - scoreSlotForIntent(a, intent));
  const primary = sorted.find((slot) => Number.isFinite(scoreSlotForIntent(slot, intent)));
  const caveats = unique(slots.flatMap((slot) => slot.warnings).filter(Boolean));
  const successful = slots.filter((slot) => slot.status === "passed" || slot.status === "partial");
  return {
    question_intent: intent,
    evidence_slots: slots,
    primary_slot_id: primary?.slot_id ?? null,
    supporting_slot_ids: successful.filter((slot) => slot !== primary).map((slot) => slot.slot_id),
    caveats,
    verified_answer_inputs: {
      primary_job_id: primary?.job_id ?? null,
      primary_columns: primary?.columns ?? [],
      primary_rows: primary?.rows ?? [],
    },
    has_usable_evidence: successful.some((slot) => slot.row_count > 0),
    diagnostics: {
      successful_job_ids: successful.filter((slot) => slot.row_count > 0).map((slot) => slot.job_id),
      failed_job_ids: slots.filter((slot) => slot.status === "failed").map((slot) => slot.job_id),
      empty_job_ids: slots.filter((slot) => slot.status === "empty").map((slot) => slot.job_id),
      selected_primary_job_id: primary?.job_id ?? null,
    },
  };
}

export function selectPrimaryEvidenceJob<T extends EvidenceJobLike>(args: {
  question: string;
  mode: InsightsMode;
  jobs: T[];
}): T | undefined {
  const pack = buildEvidenceAnswerPack(args);
  const id = pack.verified_answer_inputs.primary_job_id;
  return id ? args.jobs.find((job) => job.job_id === id) : undefined;
}
