import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isValid } from "date-fns";
import { FileCheck2, FileText, Search, ShieldCheck, Split, Users } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyStateBlock, KpiStrip, PageHeader } from "@/components/layout";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type SplitClaim = {
  id: string;
  source_report_id: string | null;
  source_row_id: string | null;
  work_id: string | null;
  party_id: string | null;
  work_title: string | null;
  iswc: string | null;
  source_work_code: string | null;
  party_name: string | null;
  ipi_number: string | null;
  source_role: string | null;
  source_rights_code: string | null;
  source_rights_label: string | null;
  source_language: string | null;
  canonical_rights_stream: string | null;
  share_pct: number | null;
  territory_scope: string | null;
  valid_from: string | null;
  valid_to: string | null;
  confidence: number | null;
  review_status: string | null;
  managed_party_match: boolean | null;
  raw_payload: unknown;
  created_at: string | null;
};

type RightsDocument = {
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

const claimSelect = [
  "id",
  "source_report_id",
  "source_row_id",
  "work_id",
  "party_id",
  "work_title",
  "iswc",
  "source_work_code",
  "party_name",
  "ipi_number",
  "source_role",
  "source_rights_code",
  "source_rights_label",
  "source_language",
  "canonical_rights_stream",
  "share_pct",
  "territory_scope",
  "valid_from",
  "valid_to",
  "confidence",
  "review_status",
  "managed_party_match",
  "raw_payload",
  "created_at",
].join(",");

const reportSelect = [
  "id",
  "cmo_name",
  "file_name",
  "status",
  "report_period",
  "created_at",
  "document_kind",
  "business_side",
  "parser_lane",
].join(",");

const formatLabel = (value: string | null | undefined) => {
  if (!value) return "-";
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const formatShare = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })}%`;
};

const formatConfidence = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(Number(value))) return "-";
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return "-";
  const date = new Date(value);
  return isValid(date) ? format(date, "MMM d, yyyy") : "-";
};

const statusTone = (status: string | null | undefined) => {
  switch ((status ?? "").toLowerCase()) {
    case "approved":
      return "border-[hsl(var(--tone-success)/0.2)] bg-[hsl(var(--tone-success)/0.08)] text-[hsl(var(--tone-success))]";
    case "rejected":
      return "border-[hsl(var(--tone-critical)/0.2)] bg-[hsl(var(--tone-critical)/0.08)] text-[hsl(var(--tone-critical))]";
    case "pending":
    default:
      return "border-[hsl(var(--tone-warning)/0.2)] bg-[hsl(var(--tone-warning)/0.1)] text-[hsl(var(--tone-warning))]";
  }
};

export default function RightsSplits() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [streamFilter, setStreamFilter] = useState("all");
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);

  const { data: claims = [], isLoading: claimsLoading } = useQuery({
    queryKey: ["rights-splits-claims"],
    queryFn: async (): Promise<SplitClaim[]> => {
      const { data, error } = await (supabase as any)
        .from("catalog_split_claims")
        .select(claimSelect)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as SplitClaim[];
    },
  });

  const { data: reports = [] } = useQuery({
    queryKey: ["rights-splits-documents"],
    queryFn: async (): Promise<RightsDocument[]> => {
      const { data, error } = await (supabase as any)
        .from("cmo_reports")
        .select(reportSelect)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as RightsDocument[];
    },
  });

  const reportById = useMemo(() => {
    const map = new Map<string, RightsDocument>();
    for (const report of reports) map.set(report.id, report);
    return map;
  }, [reports]);

  const rightsDocuments = useMemo(() => {
    const sourceReportIds = new Set(claims.map((claim) => claim.source_report_id).filter(Boolean));
    return reports.filter((report) => {
      const kind = report.document_kind ?? "";
      return (
        sourceReportIds.has(report.id) ||
        ["rights_catalog", "split_sheet", "contract_summary"].includes(kind) ||
        report.business_side === "publishing" ||
        report.parser_lane === "rights"
      );
    });
  }, [claims, reports]);

  const streamOptions = useMemo(
    () =>
      Array.from(new Set(claims.map((claim) => claim.canonical_rights_stream).filter(Boolean) as string[])).sort((a, b) =>
        a.localeCompare(b),
      ),
    [claims],
  );

  const filteredClaims = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return claims.filter((claim) => {
      const matchesStatus = statusFilter === "all" || (claim.review_status ?? "pending") === statusFilter;
      const matchesStream = streamFilter === "all" || claim.canonical_rights_stream === streamFilter;
      const haystack = [
        claim.work_title,
        claim.party_name,
        claim.ipi_number,
        claim.iswc,
        claim.source_work_code,
        claim.source_rights_code,
        claim.source_rights_label,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return matchesStatus && matchesStream && (!needle || haystack.includes(needle));
    });
  }, [claims, search, statusFilter, streamFilter]);

  const workCount = useMemo(() => new Set(claims.map((claim) => claim.work_id ?? claim.work_title).filter(Boolean)).size, [claims]);
  const partyCount = useMemo(() => new Set(claims.map((claim) => claim.party_id ?? claim.party_name).filter(Boolean)).size, [claims]);
  const pendingCount = claims.filter((claim) => (claim.review_status ?? "pending") === "pending").length;
  const approvedCount = claims.filter((claim) => claim.review_status === "approved").length;

  const decideClaimMutation = useMutation({
    mutationFn: async ({ claimId, action }: { claimId: string; action: "approve" | "reject" }) => {
      setActiveClaimId(claimId);
      const { data, error } = await supabase.functions.invoke("submit-split-claim-decisions", {
        body: {
          claim_ids: [claimId],
          action,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rights-splits-claims"] }),
        queryClient.invalidateQueries({ queryKey: ["rights-splits-documents"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
      ]);
      toast({
        title: variables.action === "approve" ? "Split claim approved" : "Split claim rejected",
        description:
          variables.action === "approve"
            ? "The claim was promoted into canonical rights positions."
            : "The claim will stay out of canonical rights positions.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Split review failed", description: error.message, variant: "destructive" });
    },
    onSettled: () => setActiveClaimId(null),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Rights Evidence"
        title="Rights & Splits"
        subtitle="Review extracted split claims, source documents, parties, shares, and provenance before those facts are promoted into entitlement answers."
        actions={
          <Button asChild variant="quiet" className="h-10">
            <Link to="/reports">
              <FileText className="h-4 w-4" />
              Upload Document
            </Link>
          </Button>
        }
      />

      <KpiStrip
        items={[
          { label: "Split Claims", value: claims.length.toLocaleString(), icon: <Split className="h-4 w-4" />, tone: "accent" },
          { label: "Works", value: workCount.toLocaleString(), icon: <FileCheck2 className="h-4 w-4" /> },
          { label: "Parties", value: partyCount.toLocaleString(), icon: <Users className="h-4 w-4" /> },
          { label: "Pending Review", value: pendingCount.toLocaleString(), hint: `${approvedCount.toLocaleString()} approved`, tone: pendingCount > 0 ? "warning" : "success" },
        ]}
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="forensic-frame surface-panel overflow-hidden rounded-[calc(var(--radius)-2px)]">
          <CardHeader className="border-b border-[hsl(var(--border)/0.1)]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <CardTitle className="type-display-section text-xl">Extracted Split Claims</CardTitle>
                <p className="mt-2 text-sm text-muted-foreground">
                  Typed claim facts preserved from the source vocabulary and mapped into canonical rights streams.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_150px_190px] lg:w-[620px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search works, parties, IPI, ISWC"
                    className="pl-9"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={streamFilter} onValueChange={setStreamFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Stream" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Streams</SelectItem>
                    {streamOptions.map((stream) => (
                      <SelectItem key={stream} value={stream}>
                        {formatLabel(stream)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {claimsLoading ? (
              <div className="flex min-h-[280px] items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : filteredClaims.length === 0 ? (
              <EmptyStateBlock
                className="m-4"
                icon={<ShieldCheck className="h-6 w-6" />}
                title="No split claims found"
                description="Rights and split documents will appear here after ingestion creates typed catalog split claims."
                action={
                  <Button asChild variant="quiet">
                    <Link to="/reports">Upload a rights document</Link>
                  </Button>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>WORK</TableHead>
                      <TableHead>PARTY</TableHead>
                      <TableHead>ROLE</TableHead>
                      <TableHead>SOURCE RIGHT</TableHead>
                      <TableHead>CANONICAL STREAM</TableHead>
                      <TableHead className="text-right">SHARE</TableHead>
                      <TableHead>REVIEW</TableHead>
                      <TableHead>PROVENANCE</TableHead>
                      <TableHead className="text-right">ACTION</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredClaims.slice(0, 200).map((claim) => {
                      const report = claim.source_report_id ? reportById.get(claim.source_report_id) : null;
                      return (
                        <TableRow key={claim.id}>
                          <TableCell className="min-w-[220px]">
                            <div className="font-medium text-foreground">{claim.work_title ?? "Untitled work"}</div>
                            <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                              {claim.iswc ? <span>ISWC {claim.iswc}</span> : null}
                              {claim.source_work_code ? <span>Code {claim.source_work_code}</span> : null}
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[210px]">
                            <div className="font-medium text-foreground">{claim.party_name ?? "Unknown party"}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                              {claim.ipi_number ? <span>IPI {claim.ipi_number}</span> : null}
                              {claim.managed_party_match ? <Badge variant="outline">Managed</Badge> : <Badge variant="outline">External</Badge>}
                            </div>
                          </TableCell>
                          <TableCell>{claim.source_role ?? "-"}</TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-xs">{claim.source_rights_code ?? "-"}</span>
                              <span className="text-xs text-muted-foreground">{claim.source_rights_label ?? claim.source_language ?? "-"}</span>
                            </div>
                          </TableCell>
                          <TableCell>{formatLabel(claim.canonical_rights_stream)}</TableCell>
                          <TableCell className="text-right font-mono">{formatShare(claim.share_pct)}</TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <Badge variant="outline" className={cn("w-fit", statusTone(claim.review_status))}>
                                {formatLabel(claim.review_status ?? "pending")}
                              </Badge>
                              <span className="text-[11px] text-muted-foreground">Confidence {formatConfidence(claim.confidence)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[190px]">
                            <div className="text-xs text-foreground">{report?.file_name ?? "Source document"}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              Row {claim.source_row_id ? claim.source_row_id.slice(0, 8) : "-"} - {formatDate(claim.created_at)}
                            </div>
                          </TableCell>
                          <TableCell className="min-w-[170px] text-right">
                            {(claim.review_status ?? "pending") === "pending" ? (
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="quiet"
                                  size="sm"
                                  disabled={decideClaimMutation.isPending && activeClaimId === claim.id}
                                  onClick={() => decideClaimMutation.mutate({ claimId: claim.id, action: "reject" })}
                                >
                                  Reject
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={decideClaimMutation.isPending && activeClaimId === claim.id}
                                  onClick={() => decideClaimMutation.mutate({ claimId: claim.id, action: "approve" })}
                                >
                                  Approve
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">Reviewed</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <aside className="space-y-4">
          <Card className="forensic-frame surface-panel rounded-[calc(var(--radius)-2px)]">
            <CardHeader>
              <CardTitle className="type-display-section text-lg">Source Documents</CardTitle>
              <p className="text-sm text-muted-foreground">Documents classified as rights, split, contract, or publishing evidence.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {rightsDocuments.length === 0 ? (
                <p className="rounded-[calc(var(--radius-md)-2px)] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.7)] p-4 text-sm text-muted-foreground">
                  No rights documents have produced split evidence yet.
                </p>
              ) : (
                rightsDocuments.slice(0, 12).map((report) => {
                  const claimCount = claims.filter((claim) => claim.source_report_id === report.id).length;
                  return (
                    <article key={report.id} className="rounded-[calc(var(--radius-md)-2px)] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated)/0.72)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{report.file_name ?? report.cmo_name ?? "Rights document"}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{formatDate(report.created_at)} - {formatLabel(report.document_kind)}</p>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {claimCount}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <Badge variant="outline">{formatLabel(report.business_side ?? "unknown")}</Badge>
                        <Badge variant="outline">{formatLabel(report.status)}</Badge>
                      </div>
                    </article>
                  );
                })
              )}
            </CardContent>
          </Card>
        </aside>
      </section>
    </div>
  );
}
