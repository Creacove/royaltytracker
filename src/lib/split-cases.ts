import {
  buildPartyKeyFromClaim,
  buildSplitFingerprint,
  buildWorkGroupKeyFromClaim,
} from "../../supabase/functions/_shared/rights-splits";

export type SplitClaimReviewStatus = "pending" | "approved" | "rejected";
export type SplitCaseStatus = "already_known" | "ready_to_approve" | "needs_attention" | "conflict" | "archived";
export type SplitWorkStatus = "known" | "new" | "needs_attention" | "conflict" | "archived";

export type SplitClaimForCase = {
  id: string;
  source_report_id: string | null;
  source_row_id: string | null;
  work_id?: string | null;
  party_id?: string | null;
  work_title: string | null;
  iswc: string | null;
  source_work_code: string | null;
  party_name: string | null;
  ipi_number: string | null;
  source_role: string | null;
  source_rights_code: string | null;
  source_rights_label: string | null;
  source_language?: string | null;
  canonical_rights_stream: string | null;
  share_pct: number | null;
  territory_scope: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  confidence: number | null;
  review_status: string | null;
  managed_party_match: boolean | null;
  raw_payload?: unknown;
  created_at?: string | null;
  split_group_key?: string | null;
  split_fingerprint?: string | null;
  dedupe_status?: string | null;
  matched_existing_rights_position_id?: string | null;
  review_case_status?: string | null;
  auto_applied_at?: string | null;
};

export type RightsDocumentForCase = {
  id: string;
  cmo_name: string | null;
  file_name: string | null;
  status: string | null;
  report_period: string | null;
  created_at: string | null;
  document_kind: string | null;
  business_side: string | null;
  parser_lane: string | null;
};

export type SplitParty = {
  key: string;
  name: string;
  ipiNumber: string | null;
  role: string | null;
  managed: boolean;
  claims: SplitClaimForCase[];
  shares: Record<string, number | null>;
};

export type SplitWork = {
  key: string;
  title: string;
  iswc: string | null;
  sourceWorkCode: string | null;
  status: SplitWorkStatus;
  fingerprint: string;
  confidence: number | null;
  claimIds: string[];
  parties: SplitParty[];
  streamTotals: Record<string, number>;
  warnings: string[];
};

export type SplitCase = {
  id: string;
  reportId: string | null;
  fileName: string;
  sourceName: string;
  documentKind: string | null;
  businessSide: string | null;
  parserLane: string | null;
  uploadedAt: string | null;
  status: SplitCaseStatus;
  claims: SplitClaimForCase[];
  works: SplitWork[];
  workCount: number;
  partyCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  conflictCount: number;
  needsAttentionCount: number;
};

const formatLabel = (value: string | null | undefined) =>
  value
    ? value
        .split("_")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    : "-";

const normalizeSearchValue = (value: string | null | undefined) => value?.trim().toLowerCase() ?? "";

const streamKey = (claim: SplitClaimForCase) =>
  claim.canonical_rights_stream?.trim().toLowerCase() ||
  claim.source_rights_code?.trim().toLowerCase() ||
  "source_defined";

const averageConfidence = (claims: SplitClaimForCase[]) => {
  const values = claims
    .map((claim) => Number(claim.confidence))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const hasStrongWorkIdentifier = (work: SplitWork) => Boolean(work.iswc || work.sourceWorkCode);

const deriveWorkStatus = (claims: SplitClaimForCase[], warnings: string[], hasStrongId: boolean): SplitWorkStatus => {
  if (claims.every((claim) => claim.review_status === "rejected" || claim.review_case_status === "archived")) return "archived";
  if (claims.some((claim) => claim.dedupe_status === "conflict" || claim.review_case_status === "conflict")) return "conflict";
  if (warnings.length > 0 || !hasStrongId) return "needs_attention";
  if (
    claims.every(
      (claim) =>
        claim.review_status === "approved" ||
        claim.dedupe_status === "exact_duplicate" ||
        claim.dedupe_status === "auto_applied" ||
        claim.auto_applied_at,
    )
  ) {
    return "known";
  }
  return "new";
};

const deriveCaseStatus = (works: SplitWork[]): SplitCaseStatus => {
  if (works.length === 0) return "needs_attention";
  if (works.every((work) => work.status === "archived")) return "archived";
  if (works.some((work) => work.status === "conflict")) return "conflict";
  if (works.some((work) => work.status === "needs_attention")) return "needs_attention";
  if (works.every((work) => work.status === "known")) return "already_known";
  return "ready_to_approve";
};

export const splitCaseStatusLabel = (status: SplitCaseStatus | SplitWorkStatus) => {
  switch (status) {
    case "already_known":
    case "known":
      return "Already known";
    case "ready_to_approve":
    case "new":
      return "Ready to approve";
    case "needs_attention":
      return "Needs attention";
    case "conflict":
      return "Conflict";
    case "archived":
      return "Archived";
    default:
      return formatLabel(status);
  }
};

export function buildSplitWorks(claims: SplitClaimForCase[]): SplitWork[] {
  const byWork = new Map<string, SplitClaimForCase[]>();
  for (const claim of claims) {
    const key = claim.split_group_key || buildWorkGroupKeyFromClaim(claim);
    const bucket = byWork.get(key) ?? [];
    bucket.push(claim);
    byWork.set(key, bucket);
  }

  return Array.from(byWork.entries())
    .map(([key, workClaims]) => {
      const byParty = new Map<string, SplitClaimForCase[]>();
      for (const claim of workClaims) {
        const partyKey = buildPartyKeyFromClaim(claim);
        const bucket = byParty.get(partyKey) ?? [];
        bucket.push(claim);
        byParty.set(partyKey, bucket);
      }

      const parties = Array.from(byParty.entries())
        .map(([partyKey, partyClaims]) => {
          const shares: Record<string, number | null> = {};
          for (const claim of partyClaims) {
            shares[streamKey(claim)] = claim.share_pct == null ? null : Number(claim.share_pct);
          }
          const first = partyClaims[0];
          return {
            key: partyKey,
            name: first.party_name ?? "Unknown party",
            ipiNumber: first.ipi_number,
            role: first.source_role,
            managed: partyClaims.some((claim) => Boolean(claim.managed_party_match)),
            claims: partyClaims,
            shares,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      const streamTotals: Record<string, number> = {};
      const missingShareStreams = new Set<string>();
      for (const claim of workClaims) {
        if (claim.share_pct == null || Number.isNaN(Number(claim.share_pct))) {
          missingShareStreams.add(streamKey(claim));
          continue;
        }
        const value = Number(claim.share_pct);
        if (!Number.isFinite(value)) continue;
        const stream = streamKey(claim);
        streamTotals[stream] = (streamTotals[stream] ?? 0) + value;
      }

      const warnings = [
        ...Array.from(missingShareStreams).map((stream) => `${formatLabel(stream)} has missing share evidence`),
        ...Object.entries(streamTotals)
        .filter(([, total]) => Math.abs(total - 100) > 0.01)
        .map(([stream, total]) => `${formatLabel(stream)} totals ${Number(total.toFixed(4))}%`),
      ];

      const first = workClaims[0];
      const fingerprint = first.split_fingerprint || buildSplitFingerprint(workClaims);
      const work: SplitWork = {
        key,
        title: first.work_title ?? "Untitled work",
        iswc: first.iswc,
        sourceWorkCode: first.source_work_code,
        status: "new",
        fingerprint,
        confidence: averageConfidence(workClaims),
        claimIds: workClaims.map((claim) => claim.id),
        parties,
        streamTotals,
        warnings,
      };
      work.status = deriveWorkStatus(workClaims, warnings, hasStrongWorkIdentifier(work));
      return work;
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function buildSplitCases(claims: SplitClaimForCase[], reports: RightsDocumentForCase[] = []): SplitCase[] {
  const reportById = new Map(reports.map((report) => [report.id, report]));
  const byReport = new Map<string, SplitClaimForCase[]>();

  for (const claim of claims) {
    const key = claim.source_report_id ?? "unfiled";
    const bucket = byReport.get(key) ?? [];
    bucket.push(claim);
    byReport.set(key, bucket);
  }

  for (const report of reports) {
    const isRightsDocument =
      ["rights_catalog", "split_sheet", "contract_summary"].includes(report.document_kind ?? "") ||
      report.business_side === "publishing" ||
      report.parser_lane === "rights";
    if (isRightsDocument && !byReport.has(report.id)) byReport.set(report.id, []);
  }

  return Array.from(byReport.entries())
    .map(([reportId, reportClaims]) => {
      const report = reportById.get(reportId) ?? null;
      const works = buildSplitWorks(reportClaims);
      const parties = new Set(works.flatMap((work) => work.parties.map((party) => party.key)));
      const status = deriveCaseStatus(works);
      return {
        id: reportId,
        reportId: reportId === "unfiled" ? null : reportId,
        fileName: report?.file_name ?? reportClaims[0]?.source_report_id ?? "Unfiled split evidence",
        sourceName: report?.cmo_name ?? "Workspace upload",
        documentKind: report?.document_kind ?? null,
        businessSide: report?.business_side ?? null,
        parserLane: report?.parser_lane ?? null,
        uploadedAt: report?.created_at ?? reportClaims[0]?.created_at ?? null,
        status,
        claims: reportClaims,
        works,
        workCount: works.length,
        partyCount: parties.size,
        pendingCount: reportClaims.filter((claim) => (claim.review_status ?? "pending") === "pending").length,
        approvedCount: reportClaims.filter((claim) => claim.review_status === "approved").length,
        rejectedCount: reportClaims.filter((claim) => claim.review_status === "rejected").length,
        duplicateCount: works.filter((work) => work.status === "known").length,
        conflictCount: works.filter((work) => work.status === "conflict").length,
        needsAttentionCount: works.filter((work) => work.status === "needs_attention").length,
      };
    })
    .sort((a, b) => normalizeSearchValue(b.uploadedAt).localeCompare(normalizeSearchValue(a.uploadedAt)));
}

export function splitCaseMatches(caseItem: SplitCase, search: string, status: string) {
  const needle = search.trim().toLowerCase();
  const matchesStatus = status === "all" || caseItem.status === status;
  if (!matchesStatus) return false;
  if (!needle) return true;
  const haystack = [
    caseItem.fileName,
    caseItem.sourceName,
    caseItem.documentKind,
    ...caseItem.works.flatMap((work) => [
      work.title,
      work.iswc,
      work.sourceWorkCode,
      ...work.parties.flatMap((party) => [party.name, party.ipiNumber, party.role]),
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}
