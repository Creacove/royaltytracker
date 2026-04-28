import type {
  EvidenceNode,
  EvidencePlan,
  PlanEvidenceInput,
  QuestionFamily,
} from "./types.ts";

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function inferQuestionFamily(question: string): QuestionFamily {
  const q = question.toLowerCase();
  const asksMoney = includesAny(q, ["how much", "owed", "owe", "payable", "entitled", "entitlement", "get", "supposed to make"]);
  const asksAllocation = /\bhow much\b.*\b(get|owed|owe|payable|entitled|entitlement)\b/.test(q) ||
    /\b(should|supposed)\b.*\b(get|make|receive|earn)\b/.test(q);
  const asksSplit = includesAny(q, ["split", "share", "right", "rights", "publisher", "writer", "owner", "ipi"]);
  const asksRevenue = includesAny(q, ["revenue", "royalty", "royalties", "earning", "income", "gross", "net"]);
  const asksCompare = includesAny(q, ["compare", "versus", " vs ", "against", "better", "most", "least"]);
  const asksTrend = includesAny(q, ["trend", "growth", "down", "up", "decline", "driver", "why"]);
  const asksDocument = includesAny(q, ["document", "pdf", "contract", "statement", "source"]);
  const asksQuality = includesAny(q, ["missing", "failed", "quality", "unmatched", "blocked", "error"]);

  if (asksAllocation || (asksMoney && (asksSplit || asksRevenue))) return "entitlement_allocation";
  if (asksRevenue && asksSplit) return "revenue_split_reconciliation";
  if (asksSplit) return "rights_ownership";
  if (asksCompare && asksRevenue) return "revenue_comparison";
  if (asksTrend && asksRevenue) return "trend_driver_analysis";
  if (asksQuality) return "data_quality";
  if (asksDocument) return "document_grounded";
  if (asksRevenue || asksMoney) return "revenue_lookup";
  return "revenue_lookup";
}

function node(id: string, kind: EvidenceNode["kind"], purpose: string, depends_on: string[] = []): EvidenceNode {
  return { id, kind, purpose, depends_on };
}

function nodesForFamily(family: QuestionFamily): EvidenceNode[] {
  if (family === "entitlement_allocation" || family === "revenue_split_reconciliation") {
    return [
      node("resolve-entities", "resolve_entity", "Resolve works, recordings, parties, and requested scope."),
      node("fetch-revenue", "fetch_revenue_evidence", "Fetch revenue matching the resolved entity and date scope.", ["resolve-entities"]),
      node("fetch-splits", "fetch_split_evidence", "Fetch pending and approved split claims for the resolved work and party.", ["resolve-entities"]),
      node("fetch-rights", "fetch_rights_positions", "Fetch approved canonical rights positions that can override pending claims.", ["resolve-entities"]),
      node("compute-allocation", "compute_allocation", "Calculate estimated or payable allocation from revenue and split evidence.", ["fetch-revenue", "fetch-splits", "fetch-rights"]),
      node("fetch-documents", "fetch_document_evidence", "Attach source document evidence for cited revenue and split facts.", ["fetch-revenue", "fetch-splits"]),
      node("quality", "check_evidence_quality", "Identify missing, pending, conflicting, or weak evidence.", ["compute-allocation"]),
    ];
  }

  if (family === "rights_ownership") {
    return [
      node("resolve-entities", "resolve_entity", "Resolve requested works, recordings, and parties."),
      node("fetch-splits", "fetch_split_evidence", "Fetch split claims."),
      node("fetch-rights", "fetch_rights_positions", "Fetch approved canonical rights positions."),
      node("fetch-documents", "fetch_document_evidence", "Attach rights source documents."),
      node("quality", "check_evidence_quality", "Identify conflicts and pending evidence."),
    ];
  }

  if (family === "revenue_comparison" || family === "trend_driver_analysis") {
    return [
      node("resolve-entities", "resolve_entity", "Resolve compared entities and filters."),
      node("fetch-revenue", "fetch_revenue_evidence", "Fetch revenue evidence for each comparison slice.", ["resolve-entities"]),
      node("quality", "check_evidence_quality", "Identify missing comparison slices and weak data.", ["fetch-revenue"]),
    ];
  }

  return [
    node("resolve-entities", "resolve_entity", "Resolve requested entities and filters."),
    node("fetch-revenue", "fetch_revenue_evidence", "Fetch matching revenue evidence.", ["resolve-entities"]),
    node("quality", "check_evidence_quality", "Identify missing or weak evidence.", ["fetch-revenue"]),
  ];
}

function requiredEvidenceForFamily(family: QuestionFamily): string[] {
  if (family === "entitlement_allocation" || family === "revenue_split_reconciliation") {
    return ["resolved_entities", "revenue_evidence", "split_evidence", "computed_allocations"];
  }
  if (family === "rights_ownership") return ["resolved_entities", "split_evidence"];
  if (family === "data_quality") return ["quality_flags"];
  return ["resolved_entities", "revenue_evidence"];
}

function optionalEvidenceForFamily(family: QuestionFamily): string[] {
  if (family === "entitlement_allocation" || family === "revenue_split_reconciliation") {
    return ["rights_evidence", "source_documents", "quality_flags"];
  }
  if (family === "rights_ownership") return ["rights_evidence", "source_documents", "quality_flags"];
  return ["source_documents", "quality_flags"];
}

export function planEvidence(input: PlanEvidenceInput): EvidencePlan {
  const family = inferQuestionFamily(input.question);
  return {
    question: input.question,
    family,
    resolved_scope: {
      mode: input.scope_mode,
      from_date: input.from_date,
      to_date: input.to_date,
      entity_context: input.entity_context ?? {},
    },
    nodes: nodesForFamily(family),
    required_evidence: requiredEvidenceForFamily(family),
    optional_evidence: optionalEvidenceForFamily(family),
  };
}
