import { selectPrimaryEvidenceJob } from "./assistant-evidence-contract.ts";

export type RepresentativeSqlEvidenceJob = {
  job_id: string;
  columns: string[];
  row_count: number;
  rows?: Array<Record<string, unknown>>;
  error?: string;
};

export function questionIncludesAny(question: string, terms: string[]): boolean {
  const q = question.toLowerCase();
  return terms.some((term) => q.includes(term));
}

export function scoreSqlEvidenceJobForQuestion(job: RepresentativeSqlEvidenceJob, question: string): number {
  if (job.error || job.row_count <= 0) return Number.NEGATIVE_INFINITY;
  const columns = job.columns.map((column) => column.toLowerCase());
  const hasMoney = columns.some((column) => ["net_revenue", "gross_revenue", "revenue", "royalty_revenue"].includes(column));
  const hasDecisionDimension = columns.some((column) =>
    ["territory", "platform", "track_title", "artist_name", "event_date", "month_start", "quarter_start"].includes(column)
  );
  let score = 0;

  if (hasMoney) score += 10;
  if (hasDecisionDimension) score += 10;
  if (columns.length <= 1) score -= 25;

  if (questionIncludesAny(question, ["tour", "touring", "venue", "routing", "market", "country", "location"]) && columns.includes("territory")) {
    score += 100;
  }
  if (questionIncludesAny(question, ["platform", "dsp", "spotify", "streaming", "playlist", "channel"]) && columns.includes("platform")) {
    score += 80;
  }
  if (questionIncludesAny(question, ["track", "song", "release", "catalog"]) && columns.includes("track_title")) {
    score += 80;
  }
  if (questionIncludesAny(question, ["trend", "growth", "growing", "coming up", "right now", "compared", "vs"]) &&
    columns.some((column) => ["event_date", "day_start", "week_start", "month_start", "quarter_start"].includes(column))) {
    score += 70;
  }
  if (job.job_id === "legacy-primary" && !hasDecisionDimension) score -= 15;

  return score;
}

export function selectRepresentativeSqlJob<T extends RepresentativeSqlEvidenceJob>(args: {
  question: string;
  successfulSqlJobs: T[];
  allSqlJobs: T[];
  mode?: "workspace" | "workspace-general" | "artist" | "track";
}): T | undefined {
  const candidates = args.successfulSqlJobs.length > 0 ? args.successfulSqlJobs : args.allSqlJobs;
  const contractSelected = selectPrimaryEvidenceJob({
    question: args.question,
    mode: args.mode ?? "artist",
    jobs: candidates.map((job) => ({ ...job, rows: job.rows ?? [] })),
  });
  if (contractSelected) return candidates.find((job) => job.job_id === contractSelected.job_id);
  return [...candidates].sort((a, b) =>
    scoreSqlEvidenceJobForQuestion(b, args.question) - scoreSqlEvidenceJobForQuestion(a, args.question)
  )[0];
}
