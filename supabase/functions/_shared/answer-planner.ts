import {
  type AnalysisPlan,
  type ArtistCatalog,
  deriveAnalysisPlanFallback,
} from "./assistant-query-engine.ts";

export type EvidenceJobRequirement = "required" | "supporting" | "optional";

export type SqlEvidenceJob = {
  job_id: string;
  purpose: string;
  requirement: EvidenceJobRequirement;
  required_for_answer: boolean;
  analysis_plan: AnalysisPlan;
};

export type SidecarEvidenceJob = {
  job_id: string;
  kind: "rights_splits" | "source_documents" | "data_quality" | "external_context";
  purpose: string;
  requirement: EvidenceJobRequirement;
  required_for_answer: boolean;
};

export type MultiEvidencePlan = {
  intent: string;
  answer_requirements: string[];
  sql_jobs: SqlEvidenceJob[];
  sidecar_jobs: SidecarEvidenceJob[];
  external_context_policy: "forbidden" | "conditional";
  missing_evidence_policy: "block_if_required" | "degrade_with_caveat";
};

type PlanAnswerEvidenceInput = {
  question: string;
  catalog: ArtistCatalog;
  mode: "track" | "artist" | "workspace";
  primaryPlan?: AnalysisPlan;
};

function includesAny(text: string, terms: RegExp[]): boolean {
  return terms.some((term) => term.test(text));
}

function hasColumn(catalog: ArtistCatalog, field: string): boolean {
  return catalog.columns.some((column) => column.field_key === field);
}

function withRequiredColumns(plan: AnalysisPlan, required: string[]): AnalysisPlan {
  return {
    ...plan,
    required_columns: Array.from(new Set([...plan.required_columns, ...required])),
  };
}

function focusedPlan(question: string, catalog: ArtistCatalog, focus: string, required: string[]): AnalysisPlan {
  return withRequiredColumns(deriveAnalysisPlanFallback(`${question} ${focus}`, catalog), required);
}

function addJob(jobs: SqlEvidenceJob[], job: SqlEvidenceJob): void {
  if (jobs.some((existing) => existing.job_id === job.job_id)) return;
  jobs.push(job);
}

function addRequirement(requirements: string[], value: string): void {
  if (!requirements.includes(value)) requirements.push(value);
}

export function planAnswerEvidence(input: PlanAnswerEvidenceInput): MultiEvidencePlan {
  const q = input.question.toLowerCase();
  const primaryPlan = input.primaryPlan ?? deriveAnalysisPlanFallback(input.question, input.catalog);
  const answerRequirements: string[] = ["answer the user's main question"];
  const sqlJobs: SqlEvidenceJob[] = [
    {
      job_id: "primary",
      purpose: "answer the main revenue question",
      requirement: "required",
      required_for_answer: true,
      analysis_plan: primaryPlan,
    },
  ];

  const asksRevenue = includesAny(q, [/\brevenue\b/, /\broyalt/, /\bearn/, /\bgross\b/, /\bnet\b/, /\bincome\b/, /\bpayou?t\b/]);
  const asksTerritory = includesAny(q, [/\bterritor/, /\bmarket/, /\bcountr/, /\bregion/, /\bgeo/]);
  const asksPlatform = includesAny(q, [/\bplatform/, /\bdsp\b/, /\bspotify\b/, /\byoutube\b/, /\bapple music\b/, /\bchannel/]);
  const asksTrend = includesAny(q, [/\btrend/, /\bover time\b/, /\bgrowth\b/, /\bchanged?\b/, /\bmonth by month\b/, /\bquarter by quarter\b/, /\bweek by week\b/, /\bmonth over month\b/, /\bquarter over quarter\b/, /\bweek over week\b/, /\bvs\b/, /\bversus\b/]);
  const asksProject = includesAny(q, [/\bproject/, /\balbum/, /\brelease/, /\btrack/, /\bsong/]);
  const asksQuality = includesAny(q, [/\bquality\b/, /\bmissing\b/, /\bconflict/, /\bvalidation\b/, /\bmapping\b/, /\bconfidence\b/, /\bleak/]);
  const asksRights = includesAny(q, [/\bright/, /\bsplit/, /\bshare/, /\bwriter/, /\bpublisher/, /\bowner/, /\bowns\b/, /\bentitled/, /\bentitlement/, /\bgetting from/, /\bpayou?t/]);
  const asksDocuments = asksRights || includesAny(q, [/\bdocument/, /\bsource/, /\bcontract/, /\bprove/, /\bproof/]);
  const asksExternal = includesAny(q, [/\bexternal/, /\bbenchmark/, /\bindustry/, /\bmarket context/, /\bfestival/, /\btour/, /\bvenue/]);

  if (asksRevenue || asksProject) {
    addRequirement(answerRequirements, "rank revenue drivers");
  }
  if (asksTerritory && hasColumn(input.catalog, "territory")) {
    addRequirement(answerRequirements, "explain territory contribution");
    addJob(sqlJobs, {
      job_id: "territory-context",
      purpose: "show territory contribution for the same question",
      requirement: "supporting",
      required_for_answer: false,
      analysis_plan: focusedPlan(input.question, input.catalog, "by territory market country", ["territory"]),
    });
  }
  if (asksPlatform && hasColumn(input.catalog, "platform")) {
    addRequirement(answerRequirements, "explain platform contribution");
    addJob(sqlJobs, {
      job_id: "platform-context",
      purpose: "show platform contribution for the same question",
      requirement: "supporting",
      required_for_answer: false,
      analysis_plan: focusedPlan(input.question, input.catalog, "by platform dsp service", ["platform"]),
    });
  }
  if (asksTrend && hasColumn(input.catalog, "event_date")) {
    addRequirement(answerRequirements, "explain time movement");
    addJob(sqlJobs, {
      job_id: "trend-context",
      purpose: "show time movement for the same question",
      requirement: "supporting",
      required_for_answer: false,
      analysis_plan: focusedPlan(input.question, input.catalog, "trend over time by month", ["event_date"]),
    });
  }
  if (asksQuality) {
    addRequirement(answerRequirements, "identify data quality limits");
    addJob(sqlJobs, {
      job_id: "quality-context",
      purpose: "show quality or confidence blockers that affect the answer",
      requirement: "supporting",
      required_for_answer: false,
      analysis_plan: focusedPlan(input.question, input.catalog, "quality mapping confidence validation status", ["mapping_confidence", "validation_status"]),
    });
  }

  const sidecarJobs: SidecarEvidenceJob[] = [];
  if (asksRights) {
    addRequirement(answerRequirements, "explain entitlement or rights basis");
    sidecarJobs.push({
      job_id: "rights-splits",
      kind: "rights_splits",
      purpose: "attach rights, split, and allocation context when available",
      requirement: "supporting",
      required_for_answer: false,
    });
  }
  if (asksDocuments) {
    sidecarJobs.push({
      job_id: "source-documents",
      kind: "source_documents",
      purpose: "attach source document context when available",
      requirement: "optional",
      required_for_answer: false,
    });
  }
  if (asksQuality) {
    sidecarJobs.push({
      job_id: "data-quality",
      kind: "data_quality",
      purpose: "attach data-quality facts that limit confidence",
      requirement: "supporting",
      required_for_answer: false,
    });
  }
  if (asksExternal) {
    sidecarJobs.push({
      job_id: "external-context",
      kind: "external_context",
      purpose: "optionally enrich with external timing or market context after internal evidence",
      requirement: "optional",
      required_for_answer: false,
    });
  }

  return {
    intent: primaryPlan.intent,
    answer_requirements: answerRequirements,
    sql_jobs: sqlJobs,
    sidecar_jobs: sidecarJobs,
    external_context_policy: asksExternal ? "conditional" : "forbidden",
    missing_evidence_policy: sidecarJobs.some((job) => job.kind === "rights_splits")
      ? "degrade_with_caveat"
      : "block_if_required",
  };
}
