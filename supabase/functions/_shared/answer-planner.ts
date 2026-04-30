import {
  type AnalysisPlan,
  type ArtistCatalog,
  deriveAnalysisPlanFallback,
} from "./assistant-query-engine.ts";

export type EvidenceJobRequirement = "required" | "supporting" | "optional";
export type AudienceMode = "executive" | "marketing" | "cfo" | "label_catalog" | "touring" | "rights_admin" | "general";

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

export type AnswerSubQuestion = {
  id: string;
  question: string;
  required: boolean;
  evidence_job_ids: string[];
};

export type AnswerEvidenceJob =
  | (Omit<SqlEvidenceJob, "analysis_plan"> & { type: "sql" })
  | (Omit<SidecarEvidenceJob, "kind"> & { type: "rights_splits" | "documents" | "quality" | "external" });

export type AnswerSectionPlan = {
  id: "direct_answer" | "drivers" | "comparison" | "entitlement" | "caveats" | "next_move";
  title: string;
  required: boolean;
  evidence_job_ids: string[];
};

export type MultiEvidencePlan = {
  intent: string;
  answer_goal: string;
  audience_mode: AudienceMode;
  sub_questions: AnswerSubQuestion[];
  answer_requirements: string[];
  evidence_jobs: AnswerEvidenceJob[];
  synthesis_requirements: string[];
  answer_sections: AnswerSectionPlan[];
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

function detectAudienceMode(q: string): AudienceMode {
  if (includesAny(q, [/\bcfo\b/, /\bfinance\b/, /\bforecast\b/, /\bmargin\b/, /\bbudget\b/])) return "cfo";
  if (includesAny(q, [/\bmarket/, /\bcampaign\b/, /\bplaylist\b/, /\baudience\b/, /\bpromotion\b/])) return "marketing";
  if (includesAny(q, [/\btour/, /\bvenue\b/, /\bcity\b/, /\brouting\b/, /\bshow\b/])) return "touring";
  if (includesAny(q, [/\bright/, /\bsplit/, /\bwriter/, /\bpublisher/, /\bowner/, /\bentitlement/, /\bpayou?t/])) return "rights_admin";
  if (includesAny(q, [/\bcatalog\b/, /\blabel\b/, /\bportfolio\b/, /\bartist\b/, /\btrack\b/, /\bproject\b/])) return "label_catalog";
  if (includesAny(q, [/\bstrategy\b/, /\bprioriti[sz]e\b/, /\battention\b/, /\bimmediate\b/])) return "executive";
  return "general";
}

function addSubQuestion(subQuestions: AnswerSubQuestion[], subQuestion: AnswerSubQuestion): void {
  const existing = subQuestions.find((item) => item.id === subQuestion.id);
  if (existing) {
    existing.evidence_job_ids = Array.from(new Set([...existing.evidence_job_ids, ...subQuestion.evidence_job_ids]));
    existing.required = existing.required || subQuestion.required;
    return;
  }
  subQuestions.push(subQuestion);
}

function sidecarType(kind: SidecarEvidenceJob["kind"]): AnswerEvidenceJob["type"] {
  if (kind === "source_documents") return "documents";
  if (kind === "data_quality") return "quality";
  if (kind === "external_context") return "external";
  return "rights_splits";
}

function buildAnswerSections(args: {
  sqlJobs: SqlEvidenceJob[];
  sidecarJobs: SidecarEvidenceJob[];
  asksTrend: boolean;
  asksRights: boolean;
  asksQuality: boolean;
}): AnswerSectionPlan[] {
  const sections: AnswerSectionPlan[] = [
    {
      id: "direct_answer",
      title: "Direct answer",
      required: true,
      evidence_job_ids: ["primary"],
    },
  ];
  const driverJobIds = args.sqlJobs
    .filter((job) => job.job_id !== "primary" && /territory|platform|quality/.test(job.job_id))
    .map((job) => job.job_id);
  if (driverJobIds.length > 0) {
    sections.push({
      id: "drivers",
      title: "Drivers",
      required: false,
      evidence_job_ids: driverJobIds,
    });
  }
  if (args.asksTrend) {
    sections.push({
      id: "comparison",
      title: "Comparison",
      required: false,
      evidence_job_ids: args.sqlJobs.filter((job) => job.job_id === "trend-context").map((job) => job.job_id),
    });
  }
  if (args.asksRights) {
    sections.push({
      id: "entitlement",
      title: "Entitlement",
      required: false,
      evidence_job_ids: args.sidecarJobs.filter((job) => job.kind === "rights_splits").map((job) => job.job_id),
    });
  }
  sections.push({
    id: "caveats",
    title: "Caveats",
    required: false,
    evidence_job_ids: args.asksQuality
      ? args.sqlJobs.filter((job) => job.job_id === "quality-context").map((job) => job.job_id)
      : args.sidecarJobs.map((job) => job.job_id),
  });
  sections.push({
    id: "next_move",
    title: "Next move",
    required: true,
    evidence_job_ids: ["primary", ...driverJobIds],
  });
  return sections;
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

  const asksTouring = includesAny(q, [/\btour/, /\bvenue\b/, /\bcity\b/, /\brouting\b/, /\bshow\b/]);
  const asksMarketing = includesAny(q, [/\bmarketing\b/, /\bcampaign\b/, /\bplaylist\b/, /\bpitch(?:ing)?\b/, /\bpromotion\b/, /\bbudget\b/]);
  const asksMomentum = includesAny(q, [/\bcoming up\b/, /\bright now\b/, /\bgrow(?:ing|th)?\b/, /\bfastest\b/, /\bmoving\b/, /\brising\b/, /\bmomentum\b/]);
  const asksDrivers = includesAny(q, [/\bfactors?\b/, /\bdrivers?\b/, /\bresponsible\b/, /\bwhy\b/]);
  const asksRevenue = includesAny(q, [/\brevenue\b/, /\broyalt/, /\bearn/, /\bgross\b/, /\bnet\b/, /\bincome\b/, /\bpayou?t\b/]) || asksTouring || asksMarketing || asksMomentum;
  const asksTerritory = includesAny(q, [/\bterritor/, /\bmarket/, /\bcountr/, /\blocation/, /\bregion/, /\bgeo/]) || asksTouring || asksMarketing || asksDrivers;
  const asksPlatform = includesAny(q, [/\bplatform/, /\bdsp\b/, /\bservice\b/, /\bstreaming\b/, /\bspotify\b/, /\byoutube\b/, /\bapple music\b/, /\bchannel/, /\bplaylist\b/, /\bpitch(?:ing)?\b/]) || asksTouring || asksMarketing || asksDrivers;
  const asksTrend = includesAny(q, [/\btrend/, /\bover time\b/, /\bgrowth\b/, /\bgrow(?:ing)?\b/, /\bcoming up\b/, /\bright now\b/, /\bfastest\b/, /\bmoving\b/, /\brising\b/, /\bnext\s+(?:week|month|quarter)\b/, /\bchanged?\b/, /\bmonth by month\b/, /\bquarter by quarter\b/, /\bweek by week\b/, /\bmonth over month\b/, /\bquarter over quarter\b/, /\bweek over week\b/, /\bvs\b/, /\bversus\b/, /\bcompared?\b/]) || asksTouring;
  const asksProject = includesAny(q, [/\bproject/, /\balbum/, /\breleases?/, /\btrack/, /\bsong/, /\bcatalog\b/]);
  const asksQuality = includesAny(q, [/\bquality\b/, /\bmissing\b/, /\bconflict/, /\bvalidation\b/, /\bmapping\b/, /\bconfidence\b/, /\bleak/, /\bunderperform/, /\bpotential\b/]);
  const asksRights = includesAny(q, [/\bright/, /\bsplit/, /\bshare/, /\bwriter/, /\bpublisher/, /\bowner/, /\bowns\b/, /\bentitled/, /\bentitlement/, /\bgetting from/, /\bpayou?t/]);
  const asksDocuments = asksRights || includesAny(q, [/\bdocument/, /\bsource/, /\bcontract/, /\bprove/, /\bproof/]);
  const asksExternal = includesAny(q, [/\bexternal/, /\bbenchmark/, /\bindustry/, /\bmarket context/, /\bfestival/, /\btour/, /\bvenue/]);
  const asksComparison = asksTrend || includesAny(q, [/\bcompare\b/, /\bcompared\b/, /\bvs\b/, /\bversus\b/]);
  const asksExplanation = includesAny(q, [/\bwhy\b/, /\bexplain\b/, /\breason\b/, /\bbecause\b/, /\bwhat happened\b/]);
  const asksRanking = includesAny(q, [/\btop\b/, /\brank/, /\bdeserve\b/, /\battention\b/, /\bprioriti[sz]e\b/, /\bimmediate\b/]);

  if (asksRevenue || asksProject) {
    addRequirement(answerRequirements, "rank revenue drivers");
  }
  if ((asksRevenue || asksRights) && (asksRights || asksQuality) && hasColumn(input.catalog, "net_revenue")) {
    addJob(sqlJobs, {
      job_id: "revenue-context",
      purpose: "keep revenue evidence available even when supporting evidence is partial",
      requirement: "supporting",
      required_for_answer: false,
      analysis_plan: focusedPlan("What revenue did this catalog earn?", input.catalog, "revenue earnings income", ["net_revenue"]),
    });
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
  if (asksComparison && hasColumn(input.catalog, "event_date")) {
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

  const subQuestions: AnswerSubQuestion[] = [];
  addSubQuestion(subQuestions, {
    id: asksRanking ? "ranking" : "main-answer",
    question: asksRanking ? "Which entities should be ranked or prioritized?" : "What is the direct answer to the user's question?",
    required: true,
    evidence_job_ids: ["primary"],
  });
  if (asksComparison) {
    addSubQuestion(subQuestions, {
      id: "period-comparison",
      question: "How did the requested periods compare?",
      required: true,
      evidence_job_ids: ["primary", "trend-context"],
    });
  }
  if (asksPlatform) {
    addSubQuestion(subQuestions, {
      id: "platform-drivers",
      question: "Which platforms drove the result?",
      required: false,
      evidence_job_ids: ["platform-context"],
    });
  }
  if (asksTerritory || asksExternal) {
    addSubQuestion(subQuestions, {
      id: asksExternal ? "touring-market-fit" : "territory-drivers",
      question: asksExternal ? "Which territories or markets support the touring recommendation?" : "Which territories drove the result?",
      required: asksExternal,
      evidence_job_ids: ["territory-context"],
    });
  }
  if (asksExplanation) {
    addSubQuestion(subQuestions, {
      id: "explanation",
      question: "What evidence-backed explanation is available?",
      required: false,
      evidence_job_ids: ["primary", "platform-context", "territory-context", "trend-context"],
    });
  }
  if (asksRights) {
    addSubQuestion(subQuestions, {
      id: "entitlement",
      question: "What rights, split, or writer allocation context is available?",
      required: false,
      evidence_job_ids: ["rights-splits", "source-documents"],
    });
  }
  if (asksQuality) {
    addSubQuestion(subQuestions, {
      id: "quality-limits",
      question: "What data-quality facts limit confidence?",
      required: false,
      evidence_job_ids: ["quality-context", "data-quality"],
    });
  }

  const evidenceJobs: AnswerEvidenceJob[] = [
    ...sqlJobs.map((job) => ({
      job_id: job.job_id,
      type: "sql" as const,
      purpose: job.purpose,
      requirement: job.requirement,
      required_for_answer: job.required_for_answer,
    })),
    ...sidecarJobs.map((job) => ({
      job_id: job.job_id,
      type: sidecarType(job.kind),
      purpose: job.purpose,
      requirement: job.requirement,
      required_for_answer: job.required_for_answer,
    })),
  ];

  const answerSections = buildAnswerSections({
    sqlJobs,
    sidecarJobs,
    asksTrend: asksComparison,
    asksRights,
    asksQuality,
  });

  return {
    intent: primaryPlan.intent,
    answer_goal: input.question,
    audience_mode: detectAudienceMode(q),
    sub_questions: subQuestions,
    answer_requirements: answerRequirements,
    evidence_jobs: evidenceJobs,
    synthesis_requirements: [
      "answer every sub-question or attach a specific caveat",
      "cite evidence job ids for each answer section",
      "make why-this-matters name a driver, gap, risk, or decision",
      "produce concrete next actions from the available evidence",
      "avoid external advice when internal required evidence is missing",
    ],
    answer_sections: answerSections,
    sql_jobs: sqlJobs,
    sidecar_jobs: sidecarJobs,
    external_context_policy: asksExternal ? "conditional" : "forbidden",
    missing_evidence_policy: sidecarJobs.some((job) => job.kind === "rights_splits")
      ? "degrade_with_caveat"
      : "block_if_required",
  };
}
