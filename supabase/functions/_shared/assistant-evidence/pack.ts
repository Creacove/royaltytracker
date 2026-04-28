import type {
  AllocationFact,
  EvidenceJobResults,
  EvidencePack,
  EvidencePlan,
  EvidenceQualityFlag,
  MissingEvidenceFact,
  RevenueEvidenceFact,
  SplitEvidenceFact,
} from "./types.ts";

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function evidenceId(prefix: string, index: number, id?: string): string {
  return id && id.trim() ? id : `${prefix}_${index + 1}`;
}

function findMatchingSplits(revenue: RevenueEvidenceFact, splits: SplitEvidenceFact[]): SplitEvidenceFact[] {
  const work = revenue.work_title?.toLowerCase().trim() ?? "";
  return splits.filter((split) => {
    const share = toNumber(split.share_pct);
    if (share == null || share <= 0) return false;
    if (!work) return true;
    const splitWork = split.work_title?.toLowerCase().trim() ?? "";
    return !splitWork || splitWork === work;
  });
}

function allocationLabelForSplits(splits: SplitEvidenceFact[]): AllocationFact["allocation_label"] {
  return splits.length > 0 && splits.every((split) => split.review_status === "approved")
    ? "payable_allocation"
    : "estimated_allocation";
}

function computeAllocations(revenueRows: RevenueEvidenceFact[], splits: SplitEvidenceFact[]): AllocationFact[] {
  const allocations: AllocationFact[] = [];

  revenueRows.forEach((revenue, revenueIndex) => {
    const amount = toNumber(revenue.net_revenue ?? revenue.gross_revenue);
    if (amount == null) return;
    const matchingSplits = findMatchingSplits(revenue, splits);

    matchingSplits.forEach((split, splitIndex) => {
      const sharePct = toNumber(split.share_pct);
      if (sharePct == null) return;
      const allocationAmount = Number(((amount * sharePct) / 100).toFixed(6));
      allocations.push({
        kind: "allocation",
        party_name: split.party_name ?? "Unknown party",
        work_title: split.work_title ?? revenue.work_title ?? revenue.recording_title ?? null,
        allocation_amount: allocationAmount,
        allocation_label: allocationLabelForSplits([split]),
        allocation_basis: `${sharePct}% of ${amount}`,
        share_pct: sharePct,
        revenue_amount: amount,
        currency: revenue.currency ?? null,
        rights_stream: revenue.rights_stream ?? split.canonical_rights_stream ?? null,
        evidence_ids: [
          evidenceId("revenue", revenueIndex, revenue.id),
          evidenceId("split", splitIndex, split.id),
        ],
      });
    });
  });

  return allocations;
}

function buildMissingEvidence(plan: EvidencePlan, revenueRows: RevenueEvidenceFact[], splits: SplitEvidenceFact[], allocations: AllocationFact[]): MissingEvidenceFact[] {
  const missing: MissingEvidenceFact[] = [];
  if (plan.required_evidence.includes("revenue_evidence") && revenueRows.length === 0) {
    missing.push({
      evidence_class: "revenue_evidence",
      reason: "No matching revenue rows were found for the requested scope.",
    });
  }
  if (plan.required_evidence.includes("split_evidence") && splits.length === 0) {
    missing.push({
      evidence_class: "split_evidence",
      reason: "No matching split or rights evidence was found for the requested work or party.",
    });
  }
  if (plan.required_evidence.includes("computed_allocations") && revenueRows.length > 0 && splits.length > 0 && allocations.length === 0) {
    missing.push({
      evidence_class: "computed_allocations",
      reason: "Revenue and split evidence exist, but they could not be matched on a supported allocation basis.",
    });
  }
  return missing;
}

function buildQualityFlags(revenueRows: RevenueEvidenceFact[], splits: SplitEvidenceFact[], provided: EvidenceQualityFlag[]): EvidenceQualityFlag[] {
  const flags = [...provided];

  splits.forEach((split, index) => {
    if (split.review_status && split.review_status !== "approved") {
      flags.push({
        code: "pending_split_claim",
        severity: "warning",
        message: "Allocation uses split evidence that has not been approved into the canonical rights position set.",
        evidence_ids: [evidenceId("split", index, split.id)],
      });
    }
  });

  revenueRows.forEach((revenue, index) => {
    if (!revenue.rights_stream) {
      flags.push({
        code: "revenue_stream_missing",
        severity: "warning",
        message: "Revenue does not identify a rights stream, so allocation is estimated at the supported revenue level.",
        evidence_ids: [evidenceId("revenue", index, revenue.id)],
      });
    }
  });

  return flags;
}

function answerConstraints(missing: MissingEvidenceFact[], flags: EvidenceQualityFlag[]): string[] {
  const constraints: string[] = [];
  if (missing.some((item) => item.evidence_class === "revenue_evidence")) {
    constraints.push("Split evidence can be described, but no revenue allocation can be computed without revenue evidence.");
  }
  if (missing.some((item) => item.evidence_class === "split_evidence")) {
    constraints.push("Revenue evidence can be described, but no entitlement allocation can be computed without split or rights evidence.");
  }
  if (flags.some((flag) => flag.code === "pending_split_claim")) {
    constraints.push("Pending split claims must be described as caveated evidence.");
  }
  if (flags.some((flag) => flag.code === "revenue_stream_missing")) {
    constraints.push("Revenue stream gaps must be disclosed when presenting allocation estimates.");
  }
  return constraints;
}

export function buildEvidencePack(plan: EvidencePlan, results: EvidenceJobResults): EvidencePack {
  const revenueRows = results.revenue_evidence ?? [];
  const splitRows = results.split_evidence ?? [];
  const rightsRows = results.rights_evidence ?? [];
  const preferredSplitRows = rightsRows.length > 0 ? rightsRows : splitRows;
  const computedAllocations = computeAllocations(revenueRows, preferredSplitRows);
  const qualityFlags = buildQualityFlags(revenueRows, preferredSplitRows, results.quality_flags ?? []);
  const missingEvidence = buildMissingEvidence(plan, revenueRows, preferredSplitRows, computedAllocations);

  return {
    question_family: plan.family,
    evidence_plan: plan,
    resolved_entities: results.resolved_entities ?? [],
    revenue_evidence: revenueRows,
    rights_evidence: rightsRows,
    split_evidence: splitRows,
    computed_allocations: computedAllocations,
    source_documents: results.source_documents ?? [],
    quality_flags: qualityFlags,
    missing_evidence: missingEvidence,
    answer_constraints: answerConstraints(missingEvidence, qualityFlags),
  };
}
