export type QuestionFamily =
  | "revenue_lookup"
  | "revenue_comparison"
  | "trend_driver_analysis"
  | "rights_ownership"
  | "entitlement_allocation"
  | "revenue_split_reconciliation"
  | "missing_royalties"
  | "data_quality"
  | "document_grounded";

export type ScopeMode = "track" | "artist" | "workspace";

export type EvidenceNodeKind =
  | "resolve_entity"
  | "fetch_revenue_evidence"
  | "fetch_split_evidence"
  | "fetch_rights_positions"
  | "fetch_document_evidence"
  | "compute_allocation"
  | "check_evidence_quality";

export type EvidenceNode = {
  id: string;
  kind: EvidenceNodeKind;
  purpose: string;
  depends_on: string[];
};

export type EvidencePlan = {
  question: string;
  family: QuestionFamily;
  resolved_scope: Record<string, unknown>;
  nodes: EvidenceNode[];
  required_evidence: string[];
  optional_evidence: string[];
};

export type PlanEvidenceInput = {
  question: string;
  from_date: string;
  to_date: string;
  scope_mode: ScopeMode;
  entity_context?: Record<string, unknown>;
};

export type ResolvedEntityFact = {
  kind: "work" | "recording" | "party" | "platform" | "territory" | "unknown";
  label: string;
  identifiers?: Record<string, string | null>;
  confidence?: "high" | "medium" | "low";
  source_ref?: string;
};

export type RevenueEvidenceFact = {
  id?: string;
  work_title?: string | null;
  recording_title?: string | null;
  party_name?: string | null;
  net_revenue?: number | null;
  gross_revenue?: number | null;
  currency?: string | null;
  rights_stream?: string | null;
  platform?: string | null;
  territory?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  source_ref?: string | null;
};

export type SplitEvidenceFact = {
  id?: string;
  work_title?: string | null;
  party_name?: string | null;
  share_pct?: number | null;
  canonical_rights_stream?: string | null;
  source_rights_code?: string | null;
  source_rights_label?: string | null;
  review_status?: "pending" | "approved" | "rejected" | string | null;
  confidence?: number | null;
  source_ref?: string | null;
};

export type AllocationFact = {
  kind: "allocation";
  party_name: string;
  work_title: string | null;
  allocation_amount: number;
  allocation_label: "estimated_allocation" | "payable_allocation";
  allocation_basis: string;
  share_pct: number;
  revenue_amount: number;
  currency: string | null;
  rights_stream: string | null;
  evidence_ids: string[];
};

export type EvidenceQualityFlag = {
  code: string;
  severity: "info" | "warning" | "blocking";
  message: string;
  evidence_ids?: string[];
};

export type MissingEvidenceFact = {
  evidence_class: string;
  reason: string;
};

export type EvidencePack = {
  question_family: QuestionFamily;
  evidence_plan: EvidencePlan;
  resolved_entities: ResolvedEntityFact[];
  revenue_evidence: RevenueEvidenceFact[];
  rights_evidence: SplitEvidenceFact[];
  split_evidence: SplitEvidenceFact[];
  computed_allocations: AllocationFact[];
  source_documents: Array<Record<string, unknown>>;
  quality_flags: EvidenceQualityFlag[];
  missing_evidence: MissingEvidenceFact[];
  answer_constraints: string[];
};

export type EvidenceJobResults = {
  resolved_entities?: ResolvedEntityFact[];
  revenue_evidence?: RevenueEvidenceFact[];
  rights_evidence?: SplitEvidenceFact[];
  split_evidence?: SplitEvidenceFact[];
  source_documents?: Array<Record<string, unknown>>;
  quality_flags?: EvidenceQualityFlag[];
};
