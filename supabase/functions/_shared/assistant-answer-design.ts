export type AssistantCapability =
  | "financial_performance"
  | "rights_and_ownership"
  | "entitlement_estimation"
  | "catalog_relationships"
  | "data_quality_and_conflicts"
  | "market_and_platform_context"
  | "operating_recommendations"
  | "executive_summary";

export type AnswerArtifactKind =
  | "table"
  | "bar_chart"
  | "line_chart"
  | "recommendations"
  | "citations";

export type AnswerDesignDepth = "concise" | "standard" | "deep";
export type EvidenceVisibility = "collapsed" | "expanded";

export type AnswerArtifact = {
  kind: AnswerArtifactKind;
  placement: "support" | "evidence";
};

type DesignInput = {
  question: string;
  evidence: {
    row_count: number;
    scanned_rows: number;
    provenance: string[];
    system_confidence?: string;
  };
  visual?: {
    type?: "bar" | "line" | "table" | "none" | string;
    title?: string;
    rows?: Array<Record<string, unknown>>;
    columns?: string[];
    x?: string;
    y?: string[];
  };
  recommendations?: Array<Record<string, unknown>>;
  citations?: Array<Record<string, unknown>>;
  unknowns?: string[];
  conflicts?: Array<Record<string, unknown>>;
};

const DECISION_PATTERN =
  /\b(what changed|why|what should we do|what do we do next|next step|recommend|strategy|prioriti[sz]e|should we|focus on|focus)\b/i;
const EXECUTIVE_PATTERN = /\b(overall|catalog|workspace|company|business|portfolio|executive|ceo)\b/i;
const FINANCIAL_PATTERN = /\b(revenue|money|earn|income|performance|gross|net|payout|royalty|leak)\b/i;
const RIGHTS_PATTERN = /\b(own|rights|split|publisher|writer|collect|ipi|iswc|work)\b/i;
const ENTITLEMENT_PATTERN = /\b(getting|owed|payable|entitlement|share|settlement)\b/i;
const QUALITY_PATTERN = /\b(conflict|conflicts|uncertain|quality|missing|failed|blocker|blockers|issue|issues|problem|problems)\b/i;
const MARKET_PATTERN = /\b(platform|market|territory|country|dsp|spotify|apple|youtube|trend)\b/i;

export function inferAssistantCapabilities(question: string): AssistantCapability[] {
  const capabilities = new Set<AssistantCapability>();
  const q = question.toLowerCase();

  if (FINANCIAL_PATTERN.test(q)) capabilities.add("financial_performance");
  if (RIGHTS_PATTERN.test(q)) {
    capabilities.add("rights_and_ownership");
    capabilities.add("catalog_relationships");
  }
  if (ENTITLEMENT_PATTERN.test(q) || (RIGHTS_PATTERN.test(q) && FINANCIAL_PATTERN.test(q))) {
    capabilities.add("entitlement_estimation");
  }
  if (QUALITY_PATTERN.test(q) || /\b(leak|losing money)\b/i.test(q)) capabilities.add("data_quality_and_conflicts");
  if (MARKET_PATTERN.test(q)) capabilities.add("market_and_platform_context");
  if (DECISION_PATTERN.test(q)) {
    capabilities.add("operating_recommendations");
    capabilities.add("executive_summary");
  }
  if (EXECUTIVE_PATTERN.test(q) || capabilities.size === 0) capabilities.add("executive_summary");
  if (!capabilities.has("catalog_relationships") && /\b(song|track|recording|work|catalog)\b/i.test(q)) {
    capabilities.add("catalog_relationships");
  }

  return Array.from(capabilities);
}

export function designAssistantAnswer(input: DesignInput): {
  capabilities: AssistantCapability[];
  depth: AnswerDesignDepth;
  artifacts: AnswerArtifact[];
  evidence_visibility: EvidenceVisibility;
  external_enrichment_allowed: boolean;
} {
  const capabilities = inferAssistantCapabilities(input.question);
  const q = input.question.toLowerCase();
  const simpleLookup = /\b(who owns|what is the isrc|what is the iswc|which work|which song)\b/i.test(q);
  const asksDecision = DECISION_PATTERN.test(q);
  const hasUnknowns = (input.unknowns?.length ?? 0) > 0 || (input.conflicts?.length ?? 0) > 0;
  const largeEvidence = input.evidence.row_count >= 25 || input.evidence.scanned_rows >= 50;

  const depth: AnswerDesignDepth = simpleLookup
    ? "standard"
    : asksDecision || largeEvidence || hasUnknowns
      ? "deep"
      : "standard";

  const artifacts: AnswerArtifact[] = [];
  if (!simpleLookup) {
    if (input.visual?.type === "line") {
      artifacts.push({ kind: "line_chart", placement: "support" });
    } else if (input.visual?.type === "bar") {
      artifacts.push({ kind: "bar_chart", placement: "support" });
    } else if (input.visual?.type === "table" && /\b(compare|rank|top|bottom|list)\b/i.test(q)) {
      artifacts.push({ kind: "table", placement: "support" });
    }
    if ((input.recommendations?.length ?? 0) > 0 && asksDecision) {
      artifacts.push({ kind: "recommendations", placement: "support" });
    }
  }

  return {
    capabilities,
    depth,
    artifacts: artifacts.slice(0, 2),
    evidence_visibility: "collapsed",
    external_enrichment_allowed:
      capabilities.includes("market_and_platform_context") ||
      capabilities.includes("executive_summary") ||
      /\b(benchmark|market|external|compare|industry|trend)\b/i.test(q),
  };
}
