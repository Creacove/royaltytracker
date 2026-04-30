type AnswerQualityMode = "workspace" | "workspace-general" | "artist" | "track" | string;

type AnswerText = {
  executive_answer?: string;
  why_this_matters?: string;
};

type EvidenceSlotSummary = {
  slot_id?: string;
  status?: string;
  columns?: string[];
  row_count?: number;
};

export type AnswerQualityResult = {
  status: "passed" | "failed";
  reasons: string[];
};

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function hasPassedEvidence(slots: EvidenceSlotSummary[]): boolean {
  return slots.some((slot) => /passed|partial/i.test(String(slot.status ?? "")) && Number(slot.row_count ?? 0) > 0);
}

function mentionsAnyEvidenceColumn(text: string, slots: EvidenceSlotSummary[]): boolean {
  const lower = text.toLowerCase();
  const columns = slots.flatMap((slot) => Array.isArray(slot.columns) ? slot.columns : []);
  const semanticTerms = columns.flatMap((column) => {
    const key = String(column).toLowerCase();
    if (key === "artist_name") return ["artist"];
    if (key === "track_title") return ["track", "song"];
    if (key === "net_revenue" || key === "gross_revenue") return ["revenue", "$"];
    if (key === "growth_pct") return ["growth", "%"];
    return [key.replace(/_/g, " ")];
  });
  return semanticTerms.some((term) => term && lower.includes(term));
}

function claimsMissingEvidence(text: string): boolean {
  return /\b(can't|cannot|do not|don't|insufficient|missing|rerun|not enough|only after)\b.{0,120}\b(evidence|data|rows|result|split|dimension|driver|platform|territory|revenue|field)\b/i.test(text);
}

function normalizedTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9$%]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 3);
}

function overlapRatio(a: string, b: string): number {
  const aTokens = new Set(normalizedTokens(a));
  const bTokens = new Set(normalizedTokens(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  return overlap / Math.min(aTokens.size, bTokens.size);
}

function isGenericWhyThisMatters(why: string): boolean {
  const lower = why.toLowerCase();
  const genericPhrases = [
    "strategic financial management",
    "significant implications",
    "investor confidence",
    "future growth initiatives",
    "competitive positioning",
    "overall revenue performance",
    "optimize revenue streams",
  ];
  const hits = genericPhrases.filter((phrase) => lower.includes(phrase)).length;
  const hasSpecificEntityOrNumber = /[$%]|\b\d+(?:\.\d+)?\b|\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/.test(why);
  return hits >= 2 || (hits >= 1 && !hasSpecificEntityOrNumber);
}

function hasNextAction(why: string): boolean {
  return /\b(next move|first move|start by|within|before|after|validate|audit|review|shift|move|protect|scale|pause|test|diagnose|renegotiate|prioriti[sz]e|measure|set|launch|reallocate)\b/i.test(why);
}

function recommendsUnknownTarget(text: string): boolean {
  return /\b(?:with|then|and|start with|start in|test|secondary|priority|recommend(?:ed)?|target|tour(?:ing)? in)\s+(?:n\/a|unknown|null|undefined)\b/i.test(text) ||
    /\b(?:n\/a|unknown|null|undefined)\s+as\s+(?:the\s+)?(?:secondary|priority|target|market|territory|recommendation|test market)\b/i.test(text);
}

export function evaluateAnswerQuality(args: {
  question: string;
  mode: AnswerQualityMode;
  answer: AnswerText;
  evidenceSlots: EvidenceSlotSummary[];
}): AnswerQualityResult {
  const executive = String(args.answer.executive_answer ?? "").trim();
  const why = String(args.answer.why_this_matters ?? "").trim();
  const combined = `${executive}\n${why}`;
  const reasons: string[] = [];
  const passedEvidence = hasPassedEvidence(args.evidenceSlots);

  if (wordCount(executive) < 22) reasons.push("thin_executive_answer");
  if (wordCount(why) < 35) reasons.push("thin_why_this_matters");
  if (isGenericWhyThisMatters(why)) reasons.push("generic_why_this_matters");
  if (!hasNextAction(why) && /\bwhat should|strategy|marketing|focus|tour|budget|attention|losing|leaking|growth|changed|why\b/i.test(args.question)) {
    reasons.push("why_this_matters_missing_next_action");
  }
  if (overlapRatio(executive, why) > 0.72) reasons.push("why_this_matters_repeats_executive");
  if (/\btour|touring|market|territor/i.test(args.question) && recommendsUnknownTarget(combined)) {
    reasons.push("unknown_or_null_target_recommended");
  }
  if (passedEvidence && claimsMissingEvidence(combined)) reasons.push("claims_missing_evidence_despite_passed_required_slot");
  if (passedEvidence && !mentionsAnyEvidenceColumn(combined, args.evidenceSlots)) reasons.push("does_not_reference_available_evidence_shape");
  if (/\bwhat should|strategy|marketing|focus|tour|budget|attention|losing|growth|changed|why\b/i.test(args.question) && !/\b(next|because|therefore|risk|opportunity|strategy|move|focus|protect|test|invest|review|validate|scale|diagnose)\b/i.test(why)) {
    reasons.push("why_this_matters_lacks_strategy");
  }
  if ((args.mode === "artist" || args.mode === "track") && /\bworkspace\b/i.test(executive) && !/\bworkspace data|workspace evidence\b/i.test(executive)) {
    reasons.push("mode_drift");
  }

  return {
    status: reasons.length === 0 ? "passed" : "failed",
    reasons,
  };
}
