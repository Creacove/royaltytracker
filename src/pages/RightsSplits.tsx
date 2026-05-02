import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isValid } from "date-fns";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  FileCheck2,
  FileText,
  FolderCheck,
  GitCompare,
  Layers3,
  Search,
  ShieldCheck,
  Split,
  Users,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyStateBlock, KpiStrip, PageHeader } from "@/components/layout";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  buildSplitCases,
  splitCaseMatches,
  splitCaseStatusLabel,
  type RightsDocumentForCase,
  type SplitCase,
  type SplitClaimForCase,
  type SplitParty,
  type SplitWork,
} from "@/lib/split-cases";

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
  "split_group_key",
  "split_fingerprint",
  "dedupe_status",
  "matched_existing_rights_position_id",
  "review_case_status",
  "auto_applied_at",
].join(",");

const legacyClaimSelect = [
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

const formatDate = (value: string | null | undefined) => {
  if (!value) return "-";
  const date = new Date(value);
  return isValid(date) ? format(date, "MMM d, yyyy") : "-";
};

const formatConfidence = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(Number(value))) return "-";
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
};

const formatShare = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })}%`;
};

const parseShareDraft = (value: string | undefined): number | null => {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const readFunctionErrorMessage = async (error: unknown, fallback: string) => {
  let message = error instanceof Error ? error.message : fallback;
  const context = (error as { context?: { text?: () => Promise<string> } } | null)?.context;
  if (!context?.text) return message;

  try {
    const text = await context.text();
    if (!text) return message;
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    message = String(parsed.error ?? parsed.message ?? text);
  } catch {
    return message;
  }

  return message;
};

const statusTone = (status: SplitCase["status"] | SplitWork["status"]) => {
  switch (status) {
    case "already_known":
    case "known":
      return "border-[hsl(var(--tone-success)/0.22)] bg-[hsl(var(--tone-success)/0.08)] text-[hsl(var(--tone-success))]";
    case "ready_to_approve":
    case "new":
      return "border-[hsl(var(--brand-accent)/0.22)] bg-[hsl(var(--brand-accent-ghost)/0.56)] text-foreground";
    case "conflict":
      return "border-[hsl(var(--tone-critical)/0.22)] bg-[hsl(var(--tone-critical)/0.08)] text-[hsl(var(--tone-critical))]";
    case "archived":
      return "border-[hsl(var(--border)/0.22)] bg-[hsl(var(--muted)/0.35)] text-muted-foreground";
    case "needs_attention":
    default:
      return "border-[hsl(var(--tone-warning)/0.22)] bg-[hsl(var(--tone-warning)/0.1)] text-[hsl(var(--tone-warning))]";
  }
};

const streamColumns = (work: SplitWork) =>
  Array.from(
    new Set([
      "performance",
      "mechanical",
      "phonographic",
      ...work.parties.flatMap((party) => Object.keys(party.shares)),
    ]),
  );

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated)/0.72)] px-3 py-2">
      <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function CaseStatusBadge({ status }: { status: SplitCase["status"] | SplitWork["status"] }) {
  return (
    <Badge variant="outline" className={cn("w-fit", statusTone(status))}>
      {splitCaseStatusLabel(status)}
    </Badge>
  );
}

function ShareInput({
  claim,
  stream,
  party,
  value,
  pending,
  onChange,
}: {
  claim: SplitClaimForCase | undefined;
  stream: string;
  party: SplitParty;
  value: number | null | undefined;
  pending: boolean;
  onChange: (claimId: string, value: string) => void;
}) {
  if (!claim) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }
  return (
    <Input
      type="number"
      min="0"
      max="100"
      step="0.0001"
      value={value ?? ""}
      disabled={pending}
      aria-label={`${party.name} ${stream} share`}
      onChange={(event) => onChange(claim.id, event.target.value)}
      className="h-9 w-full min-w-0 text-right font-mono text-sm"
    />
  );
}

export default function RightsSplits() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeTab, setActiveTab] = useState("cases");
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedWorkKey, setSelectedWorkKey] = useState<string | null>(null);
  const [shareDrafts, setShareDrafts] = useState<Record<string, string>>({});

  const { data: claims = [], isLoading: claimsLoading } = useQuery({
    queryKey: ["rights-splits-claims"],
    queryFn: async (): Promise<SplitClaimForCase[]> => {
      const query = (select: string) => (supabase as any)
        .from("catalog_split_claims")
        .select(select)
        .order("created_at", { ascending: false })
        .limit(5000);

      const { data, error } = await query(claimSelect);
      if (error && String(error.message ?? "").includes("split_group_key")) {
        const fallback = await query(legacyClaimSelect);
        if (fallback.error) throw fallback.error;
        return (fallback.data ?? []) as SplitClaimForCase[];
      }
      if (error) throw error;
      return (data ?? []) as SplitClaimForCase[];
    },
  });

  const { data: reports = [] } = useQuery({
    queryKey: ["rights-splits-documents"],
    queryFn: async (): Promise<RightsDocumentForCase[]> => {
      const { data, error } = await (supabase as any)
        .from("cmo_reports")
        .select(reportSelect)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as RightsDocumentForCase[];
    },
  });

  const splitCases = useMemo(() => buildSplitCases(claims, reports), [claims, reports]);
  const filteredCases = useMemo(
    () => splitCases.filter((caseItem) => splitCaseMatches(caseItem, search, statusFilter)),
    [search, splitCases, statusFilter],
  );

  const selectedCase = useMemo(
    () => splitCases.find((caseItem) => caseItem.id === selectedCaseId) ?? filteredCases[0] ?? splitCases[0] ?? null,
    [filteredCases, selectedCaseId, splitCases],
  );
  const selectedWork = useMemo(
    () =>
      selectedCase?.works.find((work) => work.key === selectedWorkKey) ??
      selectedCase?.works.find((work) => work.status !== "known") ??
      selectedCase?.works[0] ??
      null,
    [selectedCase, selectedWorkKey],
  );

  useEffect(() => {
    if (!selectedCase) {
      setSelectedCaseId(null);
      return;
    }
    if (selectedCaseId !== selectedCase.id) setSelectedCaseId(selectedCase.id);
  }, [selectedCase, selectedCaseId]);

  useEffect(() => {
    if (!selectedWork) {
      setSelectedWorkKey(null);
      return;
    }
    if (selectedWorkKey !== selectedWork.key) setSelectedWorkKey(selectedWork.key);
  }, [selectedWork, selectedWorkKey]);

  useEffect(() => {
    const drafts: Record<string, string> = {};
    selectedWork?.parties.forEach((party) => {
      party.claims.forEach((claim) => {
        drafts[claim.id] = claim.share_pct == null ? "" : String(claim.share_pct);
      });
    });
    setShareDrafts(drafts);
  }, [selectedWork]);

  const pendingCases = splitCases.filter((caseItem) => ["ready_to_approve", "needs_attention", "conflict"].includes(caseItem.status)).length;
  const conflictCount = splitCases.reduce((sum, caseItem) => sum + caseItem.conflictCount, 0);
  const autoKnownCount = splitCases.reduce((sum, caseItem) => sum + caseItem.duplicateCount, 0);
  const approvedWorksCount = splitCases.reduce((sum, caseItem) => sum + caseItem.works.filter((work) => work.status === "known").length, 0);

  const decideCaseMutation = useMutation({
    mutationFn: async ({
      caseItem,
      action,
      workKeys,
    }: {
      caseItem: SplitCase;
      action: "approve" | "reject" | "keep_existing" | "replace_existing";
      workKeys?: string[];
    }) => {
      const claimIds = workKeys && workKeys.length > 0
        ? caseItem.works.filter((work) => workKeys.includes(work.key)).flatMap((work) => work.claimIds)
        : caseItem.claims.map((claim) => claim.id);
      const { data, error } = await supabase.functions.invoke("submit-split-claim-decisions", {
        body: {
          claim_ids: caseItem.reportId ? undefined : claimIds,
          source_report_id: caseItem.reportId,
          work_group_keys: workKeys,
          action,
        },
      });
      if (error) throw new Error(await readFunctionErrorMessage(error, "Split review failed"));
      return data;
    },
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rights-splits-claims"] }),
        queryClient.invalidateQueries({ queryKey: ["rights-splits-documents"] }),
        queryClient.invalidateQueries({ queryKey: ["reports"] }),
        queryClient.invalidateQueries({ queryKey: ["report-split-claims"] }),
      ]);
      toast({
        title:
          variables.action === "approve" || variables.action === "replace_existing"
            ? "Split case approved"
            : variables.action === "keep_existing"
              ? "Existing catalog rights kept"
              : "Split case rejected",
        description:
          variables.action === "approve" || variables.action === "replace_existing"
            ? "The selected rights positions were promoted into the catalog."
            : "The selected split evidence was kept out of canonical rights.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Split review failed", description: error.message, variant: "destructive" });
    },
  });

  const saveSharesMutation = useMutation({
    mutationFn: async () => {
      const updates = Object.entries(shareDrafts).map(([id, rawValue]) => ({
        id,
        share_pct: rawValue.trim() === "" ? null : Number(rawValue),
      }));
      for (const update of updates) {
        const { error } = await (supabase as any)
          .from("catalog_split_claims")
          .update({ share_pct: update.share_pct, review_case_status: "ready_to_approve", dedupe_status: "manual" })
          .eq("id", update.id);
        if (error && String(error.message ?? "").includes("review_case_status")) {
          const fallback = await (supabase as any)
            .from("catalog_split_claims")
            .update({ share_pct: update.share_pct })
            .eq("id", update.id);
          if (fallback.error) throw fallback.error;
          continue;
        }
        if (error) throw error;
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rights-splits-claims"] });
      toast({ title: "Split shares saved", description: "The work review was updated before approval." });
    },
    onError: (error: Error) => {
      toast({ title: "Could not save shares", description: error.message, variant: "destructive" });
    },
  });

  const activeStreams = selectedWork ? streamColumns(selectedWork) : [];
  const approvableWorkKeys = selectedCase?.works
    .filter((work) => work.claimIds.length > 0 && work.status !== "known" && work.status !== "archived")
    .map((work) => work.key) ?? [];
  const canApproveDocument = Boolean(selectedCase?.reportId && approvableWorkKeys.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Rights Intelligence"
        title="Rights & Splits"
        subtitle="Review split documents as cases: known rights are auto-recognized, clean works move in bulk, and conflicts stay isolated."
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
          { label: "Cases Needing Review", value: pendingCases.toLocaleString(), icon: <FolderCheck className="h-4 w-4" />, tone: pendingCases ? "warning" : "success" },
          { label: "Conflicts", value: conflictCount.toLocaleString(), icon: <GitCompare className="h-4 w-4" />, tone: conflictCount ? "critical" : "success" },
          { label: "Auto-Known Works", value: autoKnownCount.toLocaleString(), icon: <ShieldCheck className="h-4 w-4" /> },
          { label: "Catalog Rights", value: approvedWorksCount.toLocaleString(), icon: <FileCheck2 className="h-4 w-4" />, tone: "accent" },
        ]}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="cases">Split Cases</TabsTrigger>
          <TabsTrigger value="review">Work Review</TabsTrigger>
          <TabsTrigger value="catalog">Catalog Rights</TabsTrigger>
        </TabsList>

        <TabsContent value="cases" className="space-y-4">
          <Card className="forensic-frame surface-panel rounded-[calc(var(--radius)-2px)]">
            <CardHeader className="border-b border-[hsl(var(--border)/0.1)]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <CardTitle className="type-display-section text-xl">Case Inbox</CardTitle>
                  <p className="mt-2 text-sm text-muted-foreground">One uploaded file, one review decision. Duplicates and conflicts are separated before you touch them.</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_190px] lg:w-[560px]">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search file, work, ISWC, party, IPI" className="pl-9" />
                  </div>
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    className="h-10 rounded-[calc(var(--radius-sm))] border border-input bg-background px-3 text-sm"
                    aria-label="Filter split cases by status"
                  >
                    <option value="all">All cases</option>
                    <option value="ready_to_approve">Ready to approve</option>
                    <option value="needs_attention">Needs attention</option>
                    <option value="conflict">Conflicts</option>
                    <option value="already_known">Already known</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {claimsLoading ? (
                <div className="flex min-h-[260px] items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              ) : filteredCases.length === 0 ? (
                <EmptyStateBlock
                  icon={<Split className="h-6 w-6" />}
                  title="No split cases found"
                  description="Rights documents will appear here as review cases after ingestion extracts works, parties, and shares."
                  action={
                    <Button asChild variant="quiet">
                      <Link to="/reports">Upload a rights document</Link>
                    </Button>
                  }
                />
              ) : (
                <div className="grid gap-3">
                  {filteredCases.map((caseItem) => (
                    <article
                      key={caseItem.id}
                      className={cn(
                        "rounded-[calc(var(--radius-md)-2px)] border bg-[hsl(var(--surface-elevated)/0.72)] p-4 transition-colors",
                        selectedCase?.id === caseItem.id
                          ? "border-[hsl(var(--brand-accent)/0.45)]"
                          : "border-[hsl(var(--border)/0.12)] hover:border-[hsl(var(--brand-accent)/0.24)]",
                      )}
                    >
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => {
                            setSelectedCaseId(caseItem.id);
                            setSelectedWorkKey(caseItem.works.find((work) => work.status !== "known")?.key ?? caseItem.works[0]?.key ?? null);
                          }}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <CaseStatusBadge status={caseItem.status} />
                            <span className="text-xs text-muted-foreground">{formatDate(caseItem.uploadedAt)}</span>
                            <span className="text-xs text-muted-foreground">{formatLabel(caseItem.documentKind)}</span>
                          </div>
                          <h3 className="mt-3 truncate text-base font-semibold text-foreground">{caseItem.fileName}</h3>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {caseItem.sourceName} - {caseItem.workCount.toLocaleString()} works - {caseItem.partyCount.toLocaleString()} parties
                          </p>
                        </button>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:w-[520px]">
                          <Metric label="Known" value={caseItem.duplicateCount} />
                          <Metric label="New" value={caseItem.works.filter((work) => work.status === "new").length} />
                          <Metric label="Attention" value={caseItem.needsAttentionCount} />
                          <Metric label="Conflicts" value={caseItem.conflictCount} />
                        </div>
                        <div className="flex flex-wrap gap-2 xl:justify-end">
                          <Button
                            type="button"
                            variant="quiet"
                            disabled={caseItem.works.length === 0 || decideCaseMutation.isPending}
                            onClick={() => {
                              setSelectedCaseId(caseItem.id);
                              setSelectedWorkKey(caseItem.works[0]?.key ?? null);
                              setActiveTab("review");
                            }}
                          >
                            Review
                          </Button>
                          <Button
                            type="button"
                            disabled={!caseItem.reportId || caseItem.claims.filter((claim) => (claim.review_status ?? "pending") === "pending").length === 0 || decideCaseMutation.isPending}
                            onClick={() =>
                              decideCaseMutation.mutate({
                                caseItem,
                                action: "approve",
                                workKeys: caseItem.works
                                  .filter((work) => work.claimIds.length > 0 && work.status !== "known" && work.status !== "archived")
                                  .map((work) => work.key),
                              })
                            }
                          >
                            Approve document
                          </Button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="review" className="space-y-4">
          {!selectedCase || !selectedWork ? (
            <EmptyStateBlock
              icon={<Layers3 className="h-6 w-6" />}
              title="Select a split case"
              description="Choose a file from the case inbox to review works, edit shares, and approve the clean rights positions."
            />
          ) : (
            <div className="grid min-h-[680px] gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
              <Card className="forensic-frame surface-panel flex max-h-[calc(100vh-13rem)] min-h-[520px] flex-col overflow-hidden rounded-[calc(var(--radius)-2px)]">
                <CardHeader className="shrink-0">
                  <CardTitle className="type-display-section text-lg">Work Review</CardTitle>
                  <p className="text-sm text-muted-foreground">{selectedCase.fileName}</p>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-3">
                  {selectedCase.works.map((work) => (
                    <button
                      type="button"
                      key={work.key}
                      onClick={() => setSelectedWorkKey(work.key)}
                      className={cn(
                        "w-full rounded-[calc(var(--radius-sm))] border p-3 text-left transition-colors",
                        selectedWork.key === work.key
                          ? "border-[hsl(var(--brand-accent)/0.45)] bg-[hsl(var(--brand-accent-ghost)/0.42)]"
                          : "border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated)/0.68)] hover:border-[hsl(var(--brand-accent)/0.22)]",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{work.title}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{work.iswc ? `ISWC ${work.iswc}` : work.sourceWorkCode ? `Code ${work.sourceWorkCode}` : "No strong work ID"}</p>
                        </div>
                        <CaseStatusBadge status={work.status} />
                      </div>
                    </button>
                  ))}
                </CardContent>
              </Card>

              <Card className="forensic-frame surface-panel flex max-h-[calc(100vh-13rem)] min-h-[520px] flex-col overflow-hidden rounded-[calc(var(--radius)-2px)]">
                <CardHeader className="shrink-0 border-b border-[hsl(var(--border)/0.1)]">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <CaseStatusBadge status={selectedWork.status} />
                        <Badge variant="outline">Confidence {formatConfidence(selectedWork.confidence)}</Badge>
                      </div>
                      <CardTitle className="mt-3 type-display-section text-xl">{selectedWork.title}</CardTitle>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {selectedWork.iswc ? `ISWC ${selectedWork.iswc}` : "No ISWC"} - {selectedWork.sourceWorkCode ? `Work code ${selectedWork.sourceWorkCode}` : "No source work code"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="quiet" disabled={saveSharesMutation.isPending} onClick={() => saveSharesMutation.mutate()}>
                        Save edits
                      </Button>
                      <Button
                        type="button"
                        disabled={!selectedCase.reportId || decideCaseMutation.isPending}
                        onClick={() => decideCaseMutation.mutate({ caseItem: selectedCase, action: "approve", workKeys: [selectedWork.key] })}
                      >
                        Approve work
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
                  <div className="grid gap-2 md:grid-cols-4">
                    {activeStreams.map((stream) => (
                      <Metric key={stream} label={`${formatLabel(stream)} total`} value={formatShare(selectedWork.streamTotals[stream])} />
                    ))}
                  </div>

                  {selectedWork.warnings.length > 0 ? (
                    <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--tone-warning)/0.22)] bg-[hsl(var(--tone-warning)/0.08)] p-3 text-sm text-[hsl(var(--tone-warning))]">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>{selectedWork.warnings.join(". ")}. Confirm the source before approving.</p>
                      </div>
                    </div>
                  ) : null}

                  <div className="overflow-hidden rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.12)]">
                    <div
                      className="grid gap-0 bg-[hsl(var(--muted)/0.28)] text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground"
                      style={{ gridTemplateColumns: `minmax(180px,1.5fr) minmax(90px,.7fr) repeat(${activeStreams.length}, minmax(120px,1fr))` }}
                    >
                      <div className="border-r border-[hsl(var(--border)/0.12)] p-3">Party</div>
                      <div className="border-r border-[hsl(var(--border)/0.12)] p-3">Role</div>
                      {activeStreams.map((stream) => (
                        <div key={stream} className="border-r border-[hsl(var(--border)/0.12)] p-3 last:border-r-0">
                          {formatLabel(stream)}
                        </div>
                      ))}
                    </div>
                    {selectedWork.parties.map((party) => (
                      <div
                        key={party.key}
                        className="grid items-center border-t border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated)/0.66)]"
                        style={{ gridTemplateColumns: `minmax(180px,1.5fr) minmax(90px,.7fr) repeat(${activeStreams.length}, minmax(120px,1fr))` }}
                      >
                        <div className="min-w-0 border-r border-[hsl(var(--border)/0.12)] p-3">
                          <p className="truncate text-sm font-semibold text-foreground">{party.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{party.ipiNumber ? `IPI ${party.ipiNumber}` : "No IPI"}</p>
                        </div>
                        <div className="border-r border-[hsl(var(--border)/0.12)] p-3 text-sm text-muted-foreground">{party.role ?? "-"}</div>
                        {activeStreams.map((stream) => {
                          const claim = party.claims.find(
                            (candidate) =>
                              (candidate.canonical_rights_stream?.toLowerCase() || candidate.source_rights_code?.toLowerCase() || "source_defined") === stream,
                          );
                          return (
                            <div key={stream} className="border-r border-[hsl(var(--border)/0.12)] p-2 last:border-r-0">
                              <ShareInput
                                claim={claim}
                                stream={stream}
                                party={party}
                                value={claim ? parseShareDraft(shareDrafts[claim.id]) : party.shares[stream]}
                                pending={saveSharesMutation.isPending}
                                onChange={(claimId, value) => setShareDrafts((current) => ({ ...current, [claimId]: value }))}
                              />
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  <details className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated)/0.54)] p-3">
                    <summary className="cursor-pointer text-sm font-semibold text-foreground">Source evidence</summary>
                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                      <p>File: {selectedCase.fileName}</p>
                      <p>Fingerprint: <span className="font-mono">{selectedWork.fingerprint}</span></p>
                      <p>Rows: {selectedWork.claimIds.length.toLocaleString()} extracted claim facts grouped into this work.</p>
                    </div>
                  </details>

                  <div className="flex flex-wrap gap-2 border-t border-[hsl(var(--border)/0.1)] pt-4">
                    <Button
                      type="button"
                      disabled={!canApproveDocument || decideCaseMutation.isPending}
                      onClick={() => decideCaseMutation.mutate({ caseItem: selectedCase, action: "approve", workKeys: approvableWorkKeys })}
                    >
                      Approve document
                    </Button>
                    <Button
                      type="button"
                      variant="quiet"
                      disabled={!selectedCase.reportId || decideCaseMutation.isPending}
                      onClick={() => decideCaseMutation.mutate({ caseItem: selectedCase, action: "reject" })}
                    >
                      Reject document
                    </Button>
                    {selectedCase.status === "conflict" ? (
                      <>
                        <Button type="button" variant="quiet" disabled={decideCaseMutation.isPending} onClick={() => decideCaseMutation.mutate({ caseItem: selectedCase, action: "keep_existing" })}>
                          Keep existing catalog
                        </Button>
                        <Button type="button" disabled={decideCaseMutation.isPending} onClick={() => decideCaseMutation.mutate({ caseItem: selectedCase, action: "replace_existing" })}>
                          Replace with file
                        </Button>
                      </>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="catalog" className="space-y-4">
          <Card className="forensic-frame surface-panel rounded-[calc(var(--radius)-2px)]">
            <CardHeader>
              <CardTitle className="type-display-section text-xl">Catalog Rights</CardTitle>
              <p className="text-sm text-muted-foreground">Approved or auto-recognized split positions, grouped as works instead of extraction rows.</p>
            </CardHeader>
            <CardContent className="grid gap-3">
              {splitCases.flatMap((caseItem) => caseItem.works.filter((work) => work.status === "known").map((work) => ({ caseItem, work }))).length === 0 ? (
                <EmptyStateBlock
                  icon={<Archive className="h-6 w-6" />}
                  title="No approved catalog rights yet"
                  description="Approved split cases and exact duplicates will appear here as trusted catalog positions."
                />
              ) : (
                splitCases.flatMap((caseItem) =>
                  caseItem.works
                    .filter((work) => work.status === "known")
                    .map((work) => (
                      <article key={`${caseItem.id}-${work.key}`} className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated)/0.68)] p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-[hsl(var(--tone-success))]" />
                              <p className="font-semibold text-foreground">{work.title}</p>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">{work.iswc ? `ISWC ${work.iswc}` : work.sourceWorkCode ?? "No identifier"} - {caseItem.fileName}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(work.streamTotals).map(([stream, total]) => (
                              <Badge key={stream} variant="outline">
                                {formatLabel(stream)} {formatShare(total)}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </article>
                    )),
                )
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
