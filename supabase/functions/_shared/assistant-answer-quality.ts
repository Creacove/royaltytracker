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
