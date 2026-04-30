import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { Json, Tables } from "@/integrations/supabase/types";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/StatusBadge";
import { useToast } from "@/hooks/use-toast";
import {
  Building2,
  FileText,
  Layers3,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetClose, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toMoney } from "@/lib/royalty";
import {
  AppliedFiltersRow,
  DetailDrawerFrame,
  EmptyStateBlock,
  PageHeader,
} from "@/components/layout";
import {
  getWorkflowMode,
  isActiveWorkflowStatus,
  isTrackMatchTaskPayload,
  pruneTrackMatchSelections,
  reopenFilePicker,
} from "@/lib/report-workflow";
import { StatementWorkflowCard } from "@/components/reports/StatementWorkflowCard";
import {
  NO_MATCH_VALUE,
  StatementTrackMatchDialog,
  type StatementTrackMatchDialogTask,
} from "@/components/reports/StatementTrackMatchDialog";

type Report = Tables<"cmo_reports"> & {
  document_kind?: string | null;
  business_side?: string | null;
  parser_lane?: string | null;
};
type Tx = Tables<"royalty_transactions">;
type ExtractedRow = Tables<"document_ai_report_items">;
type ReviewTask = Tables<"review_tasks">;
type SplitClaim = {
  id: string;
  source_report_id: string | null;
  source_row_id: string | null;
  work_title: string | null;
  iswc: string | null;
  source_work_code: string | null;
  party_name: string | null;
  ipi_number: string | null;
  source_role: string | null;
  source_rights_code: string | null;
  source_rights_label: string | null;
  canonical_rights_stream: string | null;
  share_pct: number | null;
  territory_scope: string | null;
  confidence: number | null;
  review_status: string | null;
  managed_party_match: boolean | null;
};
type TrackMatchCandidate = {
  track_key: string;
  track_title: string;
  artist_name: string;
  isrc: string | null;
};
type TrackMatchTaskPayload = {
  kind: "track_match";
  group_key: string;
  track_title: string;
  artist_name: string;
  isrc: string | null;
  transaction_ids: string[];
  source_row_ids: string[];
  candidates: TrackMatchCandidate[];
};

const ACTIVE_WORKFLOW_STORAGE_KEY = "reports-active-workflow-id";
const EMPTY_REPORTS: Report[] = [];
const EMPTY_TRANSACTIONS: Tx[] = [];
const EMPTY_EXTRACTED_ROWS: ExtractedRow[] = [];
const EMPTY_REVIEW_TASKS: ReviewTask[] = [];
const EMPTY_SPLIT_CLAIMS: SplitClaim[] = [];

const toJsonObject = (value: Json): Record<string, Json> | null => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, Json>;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, Json>)
        : null;
    } catch {
      return null;
    }
  }

  return null;
};

const readTrackMatchPayload = (value: ReviewTask["payload"]): TrackMatchTaskPayload | null => {
  const payload = toJsonObject(value);
  if (!payload || !isTrackMatchTaskPayload(payload)) return null;

  const candidates = Array.isArray(payload.candidates)
    ? payload.candidates
        .map((candidate) =>
          candidate && typeof candidate === "object" && !Array.isArray(candidate)
            ? {
                track_key: String((candidate as Record<string, Json>).track_key ?? ""),
                track_title: String((candidate as Record<string, Json>).track_title ?? "Unknown track"),
                artist_name: String((candidate as Record<string, Json>).artist_name ?? "Unknown artist"),
                isrc:
                  typeof (candidate as Record<string, Json>).isrc === "string"
                    ? String((candidate as Record<string, Json>).isrc)
                    : null,
              }
            : null,
        )
        .filter((candidate): candidate is TrackMatchCandidate => Boolean(candidate?.track_key))
    : [];

  return {
    kind: "track_match",
    group_key: String(payload.group_key ?? ""),
    track_title: String(payload.track_title ?? "Unknown track"),
    artist_name: String(payload.artist_name ?? "Unknown artist"),
    isrc: typeof payload.isrc === "string" ? payload.isrc : null,
    transaction_ids: Array.isArray(payload.transaction_ids) ? payload.transaction_ids.map(String) : [],
    source_row_ids: Array.isArray(payload.source_row_ids) ? payload.source_row_ids.map(String) : [],
    candidates,
  };
};

const invokeFunction = async <TData,>(fn: string, body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    let message = error.message || `${fn} failed.`;
    let status: number | undefined;

    try {
      const errWithContext = error as { context?: unknown };
      const response = errWithContext.context as { status?: number; text?: () => Promise<string> } | undefined;
      if (response && typeof response.text === "function") {
        status = response.status;
        const text = await response.text();
        const parsed = text ? JSON.parse(text) : null;
        message = parsed?.error ?? parsed?.message ?? text ?? message;
      }
    } catch {
      // Keep the fallback message when the function error body cannot be parsed.
    }

    throw new Error(status ? `${fn} failed (${status}): ${message}` : `${fn} failed: ${message}`);
  }

  return data as TData;
};

const toCustomColumnLabel = (key: string) =>
  key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const readCustomProperties = (tx: Tx): Record<string, unknown> => {
  const value = tx.custom_properties;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const formatCustomValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const splitClaimSelect = [
  "id",
  "source_report_id",
  "source_row_id",
  "work_title",
  "iswc",
  "source_work_code",
  "party_name",
  "ipi_number",
  "source_role",
  "source_rights_code",
  "source_rights_label",
  "canonical_rights_stream",
  "share_pct",
  "territory_scope",
  "confidence",
  "review_status",
  "managed_party_match",
].join(",");

const formatDocumentLabel = (value: string | null | undefined) => {
  if (!value) return "-";
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const formatSharePct = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })}%`;
};

const formatConfidencePct = (value: number | null | undefined) => {
  if (value == null || Number.isNaN(Number(value))) return "-";
  const normalized = value <= 1 ? value * 100 : value;
  return `${Math.round(normalized)}%`;
};

const isRightsDocument = (report: Report | null | undefined) => {
  if (!report) return false;
  return (
    ["rights_catalog", "split_sheet", "contract_summary"].includes(report.document_kind ?? "") ||
    report.parser_lane === "rights"
  );
};

const deriveStatementName = (fileName: string) =>
  fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const EXTRACTED_COLUMNS: Array<{ key: keyof ExtractedRow; label: string }> = [
  { key: "report_item", label: "report_item" },
  { key: "amount_in_original_currency", label: "amount_in_original_currency" },
  { key: "amount_in_reporting_currency", label: "amount_in_reporting_currency" },
  { key: "channel", label: "channel" },
  { key: "config_type", label: "config_type" },
  { key: "country", label: "country" },
  { key: "exchange_rate", label: "exchange_rate" },
  { key: "isrc", label: "isrc" },
  { key: "label", label: "label" },
  { key: "master_commission", label: "master_commission" },
  { key: "original_currency", label: "original_currency" },
  { key: "quantity", label: "quantity" },
  { key: "release_artist", label: "release_artist" },
  { key: "release_title", label: "release_title" },
  { key: "release_upc", label: "release_upc" },
  { key: "report_date", label: "report_date" },
  { key: "reporting_currency", label: "reporting_currency" },
  { key: "royalty_revenue", label: "royalty_revenue" },
  { key: "sales_end", label: "sales_end" },
  { key: "sales_start", label: "sales_start" },
  { key: "track_artist", label: "track_artist" },
  { key: "track_title", label: "track_title" },
  { key: "unit", label: "unit" },
];

export default function Reports() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [statementName, setStatementName] = useState("");
  const [reportPeriod, setReportPeriod] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const [search, setSearch] = useState("");
  const [selectedCmo, setSelectedCmo] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [layout, setLayout] = useState<"grouped" | "flat">("flat");
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [isTrackMatchDialogOpen, setIsTrackMatchDialogOpen] = useState(false);
  const [trackMatchSelections, setTrackMatchSelections] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [trackedWorkflowReportId, setTrackedWorkflowReportId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(ACTIVE_WORKFLOW_STORAGE_KEY);
  });

  const { data: reports = EMPTY_REPORTS, isLoading } = useQuery({
    queryKey: ["reports"],
    queryFn: async (): Promise<Report[]> => {
      const { data, error } = await supabase
        .from("cmo_reports")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: (query) => {
      const data = query.state.data as Report[] | undefined;
      return data?.some((report) => isActiveWorkflowStatus(report.status)) ? 5000 : false;
    },
  });

  const persistTrackedWorkflowReportId = useCallback((reportId: string | null) => {
    setTrackedWorkflowReportId(reportId);
    if (typeof window === "undefined") return;

    if (reportId) {
      window.sessionStorage.setItem(ACTIVE_WORKFLOW_STORAGE_KEY, reportId);
      return;
    }

    window.sessionStorage.removeItem(ACTIVE_WORKFLOW_STORAGE_KEY);
  }, []);

  const activeWorkflowReport = useMemo(() => {
    if (!trackedWorkflowReportId) return null;

    return (
      reports.find(
        (report) => report.id === trackedWorkflowReportId && isActiveWorkflowStatus(report.status),
      ) ?? null
    );
  }, [reports, trackedWorkflowReportId]);

  const { data: activeTrackMatchReviewTasks = EMPTY_REVIEW_TASKS } = useQuery({
    queryKey: ["report-track-match-tasks", activeWorkflowReport?.id],
    enabled: !!activeWorkflowReport?.id,
    queryFn: async (): Promise<ReviewTask[]> => {
      const { data, error } = await supabase
        .from("review_tasks")
        .select("*")
        .eq("report_id", activeWorkflowReport!.id)
        .eq("task_type", "other")
        .in("status", ["open", "in_progress"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: activeWorkflowReport ? 5000 : false,
  });

  const { data: reportTransactions = EMPTY_TRANSACTIONS } = useQuery({
    queryKey: ["report-transactions", selectedReport?.id],
    enabled: !!selectedReport,
    queryFn: async (): Promise<Tx[]> => {
      const { data, error } = await supabase
        .from("royalty_transactions")
        .select("*")
        .eq("report_id", selectedReport!.id)
        .order("source_row", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const selectedReportMetadataIsRightsDocument = isRightsDocument(selectedReport);

  const { data: reportSplitClaims = EMPTY_SPLIT_CLAIMS } = useQuery({
    queryKey: ["report-split-claims", selectedReport?.id],
    enabled: !!selectedReport?.id,
    queryFn: async (): Promise<SplitClaim[]> => {
      const { data, error } = await (supabase as any)
        .from("catalog_split_claims")
        .select(splitClaimSelect)
        .eq("source_report_id", selectedReport!.id)
        .order("work_title", { ascending: true })
        .order("party_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SplitClaim[];
    },
  });

  const selectedReportIsRightsDocument = selectedReportMetadataIsRightsDocument || reportSplitClaims.length > 0;

  const trackMatchTasks = useMemo(
    () =>
      activeTrackMatchReviewTasks
        .map((task) => {
          const parsedPayload = readTrackMatchPayload(task.payload);
          return parsedPayload ? { ...task, parsedPayload } : null;
        })
        .filter((task): task is ReviewTask & { parsedPayload: TrackMatchTaskPayload } => Boolean(task)),
    [activeTrackMatchReviewTasks],
  );

  const { data: extractedRows = EMPTY_EXTRACTED_ROWS } = useQuery({
    queryKey: ["report-extracted-fields", selectedReport?.id],
    enabled: !!selectedReport,
    queryFn: async (): Promise<ExtractedRow[]> => {
      const { data, error } = await supabase
        .from("document_ai_report_items")
        .select("*")
        .eq("report_id", selectedReport!.id)
        .order("item_index", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const customPropertyColumns = useMemo(() => {
    const keys = new Set<string>();
    reportTransactions.forEach((tx) => {
      const properties = readCustomProperties(tx);
      Object.keys(properties).forEach((key) => {
        const clean = key.trim();
        if (clean) keys.add(clean);
      });
    });
    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }, [reportTransactions]);

  const tableReports = useMemo(
    () => reports.filter((report) => !isActiveWorkflowStatus(report.status)),
    [reports],
  );

  const cmoOptions = useMemo(
    () => Array.from(new Set(tableReports.map((report) => report.cmo_name))).sort((a, b) => a.localeCompare(b)),
    [tableReports],
  );

  const statusOptions = useMemo(
    () => Array.from(new Set(tableReports.map((report) => report.status))).sort((a, b) => a.localeCompare(b)),
    [tableReports],
  );

  const filteredReports = useMemo(() => {
    return tableReports.filter((report) => {
      const byCmo = selectedCmo === "all" || report.cmo_name === selectedCmo;
      const byStatus = selectedStatus === "all" || report.status === selectedStatus;
      const s = search.trim().toLowerCase();
      const bySearch =
        !s ||
        [report.cmo_name, report.file_name, report.report_period, report.notes]
          .map((v) => (v ?? "").toLowerCase())
          .some((v) => v.includes(s));
      return byCmo && byStatus && bySearch;
    });
  }, [tableReports, search, selectedCmo, selectedStatus]);

  const groupedReports = useMemo(() => {
    const map = new Map<string, Report[]>();
    for (const report of filteredReports) {
      if (!map.has(report.cmo_name)) map.set(report.cmo_name, []);
      map.get(report.cmo_name)!.push(report);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredReports]);

  const appliedFilters = useMemo(() => {
    const filters: string[] = [];
    if (selectedCmo !== "all") filters.push(`Source: ${selectedCmo}`);
    if (selectedStatus !== "all") filters.push(`Status: ${selectedStatus}`);
    if (search.trim()) filters.push(`Search: ${search.trim()}`);
    return filters;
  }, [search, selectedCmo, selectedStatus]);

  const hasSecondaryFilters = selectedCmo !== "all" || selectedStatus !== "all";

  useEffect(() => {
    if (hasSecondaryFilters) setShowMoreFilters(true);
  }, [hasSecondaryFilters]);

  const clearFilters = useCallback(() => {
    setSearch("");
    setSelectedCmo("all");
    setSelectedStatus("all");
    setShowMoreFilters(false);
  }, []);

  const processingCount = useMemo(
    () => reports.filter((report) => isActiveWorkflowStatus(report.status)).length,
    [reports],
  );

  const hasAnyReports = tableReports.length > 0;
  const emptyReportDescription = hasAnyReports
    ? "No matching statements."
    : "No statements yet.";

  useEffect(() => {
    setTrackMatchSelections((current) => {
      return pruneTrackMatchSelections(
        current,
        trackMatchTasks.map((task) => task.id),
      );
    });

    if (trackMatchTasks.length === 0) {
      setIsTrackMatchDialogOpen(false);
    }
  }, [trackMatchTasks]);

  useEffect(() => {
    if (!trackedWorkflowReportId || isLoading) return;

    const trackedReport = reports.find((report) => report.id === trackedWorkflowReportId) ?? null;
    if (!trackedReport || !isActiveWorkflowStatus(trackedReport.status)) {
      persistTrackedWorkflowReportId(null);
    }
  }, [isLoading, persistTrackedWorkflowReportId, reports, trackedWorkflowReportId]);

  const invalidateWorkflowQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["reports"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-reports"] }),
      queryClient.invalidateQueries({ queryKey: ["reports_with_tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["review-tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["report-track-match-tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["report-transactions"] }),
      queryClient.invalidateQueries({ queryKey: ["report-split-claims"] }),
      queryClient.invalidateQueries({ queryKey: ["rights-splits-claims"] }),
    ]);
  }, [queryClient]);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file || !user) throw new Error("Missing file or user");
      if (!statementName.trim()) throw new Error("Add a statement name before uploading.");
      const filePath = `${user.id}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("cmo-reports").upload(filePath, file);
      if (uploadError) throw uploadError;

      const { data: inserted, error: insertError } = await supabase
        .from("cmo_reports")
        .insert({
          user_id: user.id,
          cmo_name: statementName.trim(),
          report_period: reportPeriod.trim() || null,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          notes: null,
          status: "pending",
        })
        .select("id")
        .single();
      if (insertError) throw insertError;

      const reportId = inserted.id;
      const data = await invokeFunction<{ status?: string; report_id?: string; split_claims?: number }>("reprocess-file", {
        report_id: reportId,
      });
      return {
        reportId,
        splitClaims: typeof data?.split_claims === "number" ? data.split_claims : 0,
        status: typeof data?.status === "string" ? data.status : "revenue_processed",
      };
    },
    onSuccess: async (result) => {
      persistTrackedWorkflowReportId(result.reportId);
      await invalidateWorkflowQueries();
      clearSelectedFile();
      setStatementName("");
      setReportPeriod("");
      toast(
        result.status === "awaiting_track_match"
          ? {
              title: "Track matching needed",
              description: "Processing paused so you can confirm similar tracks before this statement moves to the table.",
            }
          : result.status === "rights_review_ready"
          ? {
              title: "Split document ready for review",
              description: `${result.splitClaims.toLocaleString()} extracted split claim${result.splitClaims === 1 ? "" : "s"} are waiting in Rights & Splits.`,
            }
          : result.status === "mixed_review_ready"
          ? {
              title: "Mixed document processed",
              description: "Revenue rows and split evidence were extracted. Review the pending rights claims before treating them as canonical.",
            }
          : {
              title: "Revenue statement processed",
              description: "Processing finished and the document is now available in the table.",
            },
      );
    },
    onError: (e: Error) => {
      const description = /failed to fetch|name_not_resolved|network/i.test(e.message)
        ? "Cannot reach Supabase. Check your connection or DNS, then retry the upload."
        : e.message;
      toast({ title: "Upload failed", description, variant: "destructive" });
    },
  });

  const submitTrackMatchesMutation = useMutation({
    mutationFn: async () => {
      if (!activeWorkflowReport) throw new Error("No active statement is waiting for track matching.");
      if (trackMatchTasks.some((task) => !trackMatchSelections[task.id])) {
        throw new Error("Choose a match or select No match for every track before continuing.");
      }

      return invokeFunction("submit-track-match-decisions", {
        report_id: activeWorkflowReport.id,
        decisions: trackMatchTasks.map((task) => ({
          task_id: task.id,
          candidate_track_key:
            trackMatchSelections[task.id] === NO_MATCH_VALUE ? null : trackMatchSelections[task.id],
        })),
      });
    },
    onSuccess: async () => {
      setIsTrackMatchDialogOpen(false);
      setTrackMatchSelections({});
      await invalidateWorkflowQueries();
      toast({
        title: "Track matches applied",
        description: "Final processing resumed. The statement will move into the table as soon as validation finishes.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Matching failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (report: { id: string; file_path: string }) => {
      await supabase.storage.from("cmo-reports").remove([report.file_path]);
      const { error } = await supabase.from("cmo_reports").delete().eq("id", report.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-reports"] });
      toast({ title: "Report deleted" });
    },
  });

  const handleFileSelected = useCallback((selected: File | null | undefined) => {
    if (!selected) return;
    setFile(selected);
    setStatementName((current) => current.trim() || deriveStatementName(selected.name));
  }, []);

  const clearSelectedFile = useCallback(() => {
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files[0];
    const allowedExtensions = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".jpg", ".jpeg", ".png", ".csv"];
    // Always check by extension first - MIME type can be unreliable especially for dragged files
    if (f && allowedExtensions.some(ext => f.name.toLowerCase().endsWith(ext))) {
      handleFileSelected(f);
    }
  }, [handleFileSelected]);

  const activeWorkflowMode = useMemo(
    () =>
      getWorkflowMode({
        hasTrackedWorkflow: Boolean(activeWorkflowReport),
        hasSelectedFile: Boolean(file),
        isUploading: uploadMutation.isPending,
        hasTrackMatchTasks: trackMatchTasks.length > 0,
        isSubmittingMatches: submitTrackMatchesMutation.isPending,
      }),
    [activeWorkflowReport, file, submitTrackMatchesMutation.isPending, trackMatchTasks.length, uploadMutation.isPending],
  );

  const activeWorkflowFileName = activeWorkflowReport?.file_name ?? file?.name ?? null;
  const activeWorkflowStatementName = activeWorkflowReport?.cmo_name ?? (statementName.trim() || null);
  const activeWorkflowPeriod = activeWorkflowReport?.report_period ?? (reportPeriod.trim() || null);
  const unansweredTrackMatchCount = useMemo(
    () => trackMatchTasks.filter((task) => !trackMatchSelections[task.id]).length,
    [trackMatchSelections, trackMatchTasks],
  );

  const trackMatchDialogTasks = useMemo<StatementTrackMatchDialogTask[]>(
    () =>
      trackMatchTasks.map((task) => ({
        id: task.id,
        trackTitle: task.parsedPayload.track_title || "Unknown track",
        artistName: task.parsedPayload.artist_name || "Unknown artist",
        isrc: task.parsedPayload.isrc,
        candidates: task.parsedPayload.candidates.map((candidate) => ({
          trackKey: candidate.track_key,
          trackTitle: candidate.track_title,
          artistName: candidate.artist_name,
          isrc: candidate.isrc,
        })),
      })),
    [trackMatchTasks],
  );

  const renderReportRows = (rows: Report[]) =>
    rows.map((r) => (
      <TableRow
        key={r.id}
        role="button"
        tabIndex={0}
        className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(event) => {
          event.currentTarget.focus();
          setSelectedReport(r);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setSelectedReport(r);
          }
        }}
      >
        <TableCell className="font-medium">{r.file_name}</TableCell>
        <TableCell>{r.report_period ?? "-"}</TableCell>
        <TableCell>
          <StatusBadge status={r.status} />
        </TableCell>
        <TableCell className="text-right font-mono">{r.transaction_count?.toLocaleString() ?? "-"}</TableCell>
        <TableCell className="text-right font-mono">{toMoney(r.total_revenue ?? 0)}</TableCell>
        <TableCell className="text-muted-foreground">{format(new Date(r.created_at), "MMM d, yyyy")}</TableCell>
        <TableCell className="text-right">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Delete report ${r.file_name}`}
            onClick={(e) => {
              e.stopPropagation();
              deleteMutation.mutate({ id: r.id, file_path: r.file_path });
            }}
          >
            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
          </Button>
        </TableCell>
      </TableRow>
    ));

  return (
    <div className="rhythm-page min-w-0 overflow-x-hidden">
      <PageHeader
        variant="compact"
        title="Statements"
        meta={
          processingCount > 0 ? (
            <span className="rounded-full border border-[hsl(var(--brand-accent)/0.16)] bg-[hsl(var(--brand-accent-ghost)/0.7)] px-2.5 py-1 text-[10px] font-ui uppercase tracking-[0.12em] text-[hsl(var(--brand-accent))]">
              {processingCount} processing
            </span>
          ) : undefined
        }
        actions={
          <Button asChild size="sm" variant="quiet">
            <Link to="/ai-insights">Ask Insights</Link>
          </Button>
        }
      />

      <StatementWorkflowCard
        mode={activeWorkflowMode}
        dragActive={dragActive}
        file={file}
        statementName={statementName}
        reportPeriod={reportPeriod}
        uploadPending={uploadMutation.isPending}
        trackMatchCount={trackMatchTasks.length}
        unansweredTrackMatchCount={unansweredTrackMatchCount}
        workflowFileName={activeWorkflowFileName}
        workflowStatementName={activeWorkflowStatementName}
        workflowPeriod={activeWorkflowPeriod}
        workflowCreatedAt={activeWorkflowReport?.created_at ?? null}
        onFilePick={() => reopenFilePicker(fileInputRef.current)}
        onClearFile={clearSelectedFile}
        onStatementNameChange={setStatementName}
        onReportPeriodChange={setReportPeriod}
        onUpload={() => uploadMutation.mutate()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onContinueMatching={() => setIsTrackMatchDialogOpen(true)}
      />

      <input
        ref={fileInputRef}
        id="statement-upload"
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.csv"
        className="hidden"
        onChange={(e) => {
          handleFileSelected(e.target.files?.[0]);
          e.currentTarget.value = "";
        }}
      />

      <Card surface="evidence">
        <CardContent className="p-4 md:p-5">
          <Tabs value={layout} onValueChange={(v) => setLayout(v as "grouped" | "flat")} className="space-y-4">
            <div className="space-y-3">
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_auto_auto] xl:items-center">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    variant="quiet"
                    className="pl-9"
                    placeholder="Search statement, file, or source..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <TabsList variant="quiet" className="self-start">
                  <TabsTrigger value="flat" variant="quiet" className="flex-none">
                    <Layers3 className="mr-1.5 h-4 w-4" />
                    All Statements
                  </TabsTrigger>
                  <TabsTrigger value="grouped" variant="quiet" className="flex-none">
                    <Building2 className="mr-1.5 h-4 w-4" />
                    By Source
                  </TabsTrigger>
                </TabsList>
                <Button
                  type="button"
                  variant={showMoreFilters ? "secondary" : "quiet"}
                  className="h-10 w-full px-4 xl:w-auto"
                  onClick={() => setShowMoreFilters((current) => !current)}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  {showMoreFilters ? "Hide filters" : "More filters"}
                </Button>
              </div>

              {showMoreFilters ? (
                <div className="grid gap-3 md:grid-cols-2 xl:max-w-[420px]">
                  <Select value={selectedCmo} onValueChange={setSelectedCmo}>
                    <SelectTrigger className="border-[hsl(var(--border)/0.08)] bg-[hsl(var(--surface-panel)/0.55)] shadow-none">
                      <SelectValue placeholder="All sources" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sources</SelectItem>
                      {cmoOptions.map((cmo) => (
                        <SelectItem key={cmo} value={cmo}>
                          {cmo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                    <SelectTrigger className="border-[hsl(var(--border)/0.08)] bg-[hsl(var(--surface-panel)/0.55)] shadow-none">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {statusOptions.map((status) => (
                        <SelectItem key={status} value={status}>
                          {status}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <AppliedFiltersRow
                filters={appliedFilters}
                onClear={clearFilters}
                hideWhenEmpty
                className="pt-0"
              />
            </div>

            <TabsContent value="grouped" className="space-y-5">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : groupedReports.length > 0 ? (
                groupedReports.map(([cmo, rows]) => (
                  <section key={cmo} className="surface-muted forensic-frame rounded-[calc(var(--radius-md)-2px)] p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="type-display-section text-[1.05rem] text-foreground">{cmo}</p>
                      <span className="rounded-full border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-panel)/0.75)] px-2.5 py-1 font-mono text-xs text-muted-foreground">
                        {rows.length} docs | {rows.reduce((sum, r) => sum + (r.transaction_count ?? 0), 0)} lines
                      </span>
                    </div>
                    <Table className="min-w-[860px]" variant="evidence" density="compact">
                        <TableHeader>
                          <TableRow>
                            <TableHead>File</TableHead>
                            <TableHead>Period</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Lines</TableHead>
                            <TableHead className="text-right">Revenue</TableHead>
                            <TableHead>Uploaded</TableHead>
                            <TableHead />
                          </TableRow>
                        </TableHeader>
                        <TableBody>{renderReportRows(rows)}</TableBody>
                      </Table>
                  </section>
                ))
              ) : (
                <EmptyStateBlock
                  icon={<FileText className="h-10 w-10" />}
                  title="No documents found"
                  description={emptyReportDescription}
                  variant="intelligence"
                />
              )}
            </TabsContent>

            <TabsContent value="flat">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : filteredReports.length > 0 ? (
                  <Table className="min-w-[980px]" variant="evidence">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead>File</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Lines</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                        <TableHead>Uploaded</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredReports.map((r) => (
                        <TableRow
                          key={r.id}
                          role="button"
                          tabIndex={0}
                          className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={(event) => {
                            event.currentTarget.focus();
                            setSelectedReport(r);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedReport(r);
                            }
                          }}
                        >
                          <TableCell className="font-medium">{r.cmo_name}</TableCell>
                          <TableCell>{r.file_name}</TableCell>
                          <TableCell>{r.report_period ?? "-"}</TableCell>
                          <TableCell>
                            <StatusBadge status={r.status} />
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {r.transaction_count?.toLocaleString() ?? "-"}
                          </TableCell>
                          <TableCell className="text-right font-mono">{toMoney(r.total_revenue ?? 0)}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {format(new Date(r.created_at), "MMM d, yyyy")}
                          </TableCell>
                        <TableCell className="text-right">
                             <Button
                               type="button"
                               variant="quiet"
                               size="icon"
                               aria-label={`Delete report ${r.file_name}`}
                               onClick={(e) => {
                                 e.stopPropagation();
                                 deleteMutation.mutate({ id: r.id, file_path: r.file_path });
                               }}
                             >
                              <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
              ) : (
                <EmptyStateBlock
                  icon={<FileText className="h-10 w-10" />}
                  title="No documents found"
                  description={emptyReportDescription}
                  variant="intelligence"
                />
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <StatementTrackMatchDialog
        open={isTrackMatchDialogOpen && trackMatchDialogTasks.length > 0}
        pending={submitTrackMatchesMutation.isPending}
        unansweredCount={unansweredTrackMatchCount}
        tasks={trackMatchDialogTasks}
        selections={trackMatchSelections}
        onOpenChange={(open) => {
          if (!submitTrackMatchesMutation.isPending) {
            setIsTrackMatchDialogOpen(open);
          }
        }}
        onSelect={(taskId, value) =>
          setTrackMatchSelections((current) => ({
            ...current,
            [taskId]: value,
          }))
        }
        onSubmit={() => submitTrackMatchesMutation.mutate()}
      />

      <Sheet open={!!selectedReport} onOpenChange={(open) => !open && setSelectedReport(null)}>
        <SheetContent className="w-[min(98vw,1200px)] max-w-[min(98vw,1200px)] overflow-hidden p-0 [&>button]:hidden sm:max-w-[min(95vw,1200px)] lg:w-[calc(100vw-19rem)] lg:max-w-[calc(100vw-19rem)]">
          {selectedReport ? (
            <DetailDrawerFrame
              title={`${selectedReport.cmo_name} | ${selectedReport.file_name}`}
              subtitle={`Uploaded ${format(new Date(selectedReport.created_at), "MMM d, yyyy HH:mm")}`}
              rightSlot={
                <div className="flex items-center gap-2">
                  <StatusBadge status={selectedReport.status} />
                  <SheetClose asChild>
                    <Button
                      type="button"
                      variant="quiet"
                      size="icon"
                      className="h-8 w-8 rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-elevated)/0.9)] text-foreground/72 shadow-none hover:border-[hsl(var(--brand-accent)/0.18)] hover:bg-[hsl(var(--brand-accent-ghost)/0.52)] hover:text-foreground"
                      aria-label="Close statement details"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </SheetClose>
                </div>
              }
              variant="intelligence"
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                  <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">
                    {selectedReportIsRightsDocument ? "Split claims" : "Normalized lines"}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">
                    {(selectedReportIsRightsDocument ? reportSplitClaims.length : reportTransactions.length).toLocaleString()}
                  </p>
                </div>
                <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                  <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">Extractor rows</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{extractedRows.length.toLocaleString()}</p>
                </div>
                <div className="surface-intelligence forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                  <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">
                    {selectedReportIsRightsDocument ? "Document type" : "Revenue"}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">
                    {selectedReportIsRightsDocument
                      ? formatDocumentLabel(selectedReport.document_kind ?? "rights_document")
                      : toMoney(selectedReport.total_revenue ?? 0)}
                  </p>
                </div>
              </div>

              <Tabs defaultValue="summary" className="mt-5">
                <TabsList>
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                  {selectedReportIsRightsDocument ? (
                    <TabsTrigger value="rights">Rights Evidence</TabsTrigger>
                  ) : (
                    <TabsTrigger value="transactions">Processed Transactions</TabsTrigger>
                  )}
                </TabsList>

                <TabsContent value="summary" className="mt-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    {[
                      ["CMO", selectedReport.cmo_name],
                      ["File", selectedReport.file_name],
                      ["Report Period", selectedReport.report_period],
                      ["Uploaded", format(new Date(selectedReport.created_at), "MMM d, yyyy HH:mm")],
                      [
                        "Processed",
                        selectedReport.processed_at
                          ? format(new Date(selectedReport.processed_at), "MMM d, yyyy HH:mm")
                          : null,
                      ],
                      ["Status", selectedReport.status],
                      [
                        "System Confidence Score",
                        selectedReport.accuracy_score != null ? `${selectedReport.accuracy_score}%` : null,
                      ],
                      ["Document Type", formatDocumentLabel(selectedReport.document_kind)],
                      ["Business Side", formatDocumentLabel(selectedReport.business_side)],
                      ["Parser Lane", formatDocumentLabel(selectedReport.parser_lane)],
                      ["Error Count", selectedReport.error_count?.toLocaleString()],
                      ["Notes", selectedReport.notes],
                    ].map(([label, value]) => (
                      <div key={label} className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-4">
                        <p className="text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
                        <p className="mt-2 text-sm leading-relaxed text-foreground">{value ?? "-"}</p>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                {selectedReportIsRightsDocument ? (
                  <TabsContent value="rights" className="mt-4">
                    <div className="mb-3">
                      <p className="type-display-section text-lg text-foreground">Extracted Split Claims</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Rights rows are shown as source-backed split evidence, not revenue transactions.
                      </p>
                    </div>
                    {reportSplitClaims.length > 0 ? (
                      <Table className="min-w-[1180px]" variant="evidence" density="compact">
                        <TableHeader>
                          <TableRow>
                            <TableHead>Work</TableHead>
                            <TableHead>Party</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Source Right</TableHead>
                            <TableHead>Canonical Stream</TableHead>
                            <TableHead className="text-right">Share</TableHead>
                            <TableHead>Review</TableHead>
                            <TableHead>Provenance</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reportSplitClaims.slice(0, 200).map((claim) => (
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
                                  <span className="text-xs text-muted-foreground">{claim.source_rights_label ?? "-"}</span>
                                </div>
                              </TableCell>
                              <TableCell>{formatDocumentLabel(claim.canonical_rights_stream)}</TableCell>
                              <TableCell className="text-right font-mono">{formatSharePct(claim.share_pct)}</TableCell>
                              <TableCell>
                                <div className="flex flex-col gap-1">
                                  <Badge variant="outline">{formatDocumentLabel(claim.review_status ?? "pending")}</Badge>
                                  <span className="text-[11px] text-muted-foreground">
                                    Confidence {formatConfidencePct(claim.confidence)}
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {claim.source_row_id ? claim.source_row_id.slice(0, 8) : "-"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <EmptyStateBlock
                        icon={<FileText className="h-10 w-10" />}
                        title="No split claims found"
                        description="This document is classified as rights evidence, but no typed split claims are attached to this source report yet."
                        variant="intelligence"
                      />
                    )}
                  </TabsContent>
                ) : (
                <TabsContent value="transactions" className="mt-4">
                  {reportTransactions.length > 0 ? (
                      <Table className="min-w-[1480px]" variant="evidence" density="compact">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="sticky left-0 z-30 w-[180px] min-w-[180px] max-w-[180px] bg-[hsl(var(--surface-elevated)/0.98)] pr-4">
                              <span className="relative block after:pointer-events-none after:absolute after:-right-5 after:top-0 after:h-full after:w-5 after:bg-gradient-to-r after:from-background after:via-background/90 after:to-transparent">
                                Track
                              </span>
                            </TableHead>
                            <TableHead>Artist</TableHead>
                            <TableHead>ISRC</TableHead>
                            <TableHead>ISWC</TableHead>
                            <TableHead>Territory</TableHead>
                            <TableHead>Platform</TableHead>
                            <TableHead>Usage</TableHead>
                            <TableHead>Period</TableHead>
                            <TableHead>Currency</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead className="text-right">Gross</TableHead>
                            <TableHead className="text-right">Commission</TableHead>
                            <TableHead className="text-right">Net</TableHead>
                            {customPropertyColumns.map((column) => (
                              <TableHead key={column}>{toCustomColumnLabel(column)}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {reportTransactions.slice(0, 200).map((tx) => {
                            const customProperties = readCustomProperties(tx);
                            return (
                              <TableRow key={tx.id}>
                                <TableCell className="sticky left-0 z-20 w-[180px] min-w-[180px] max-w-[180px] bg-[hsl(var(--surface-elevated)/0.96)] pr-4">
                                  <span className="relative block truncate after:pointer-events-none after:absolute after:-right-5 after:top-0 after:h-full after:w-5 after:bg-gradient-to-r after:from-background after:via-background/90 after:to-transparent">
                                    {tx.track_title ?? "-"}
                                  </span>
                                </TableCell>
                                <TableCell>{tx.artist_name ?? "-"}</TableCell>
                                <TableCell className="font-mono text-xs">{tx.isrc ?? "-"}</TableCell>
                                <TableCell className="font-mono text-xs">{tx.iswc ?? "-"}</TableCell>
                                <TableCell>{tx.territory ?? "-"}</TableCell>
                                <TableCell>{tx.platform ?? "-"}</TableCell>
                                <TableCell>{tx.usage_type ?? "-"}</TableCell>
                                <TableCell className="font-mono text-xs">
                                  {tx.period_start && tx.period_end ? `${tx.period_start} -> ${tx.period_end}` : "-"}
                                </TableCell>
                                <TableCell className="font-mono text-xs">{tx.currency ?? "-"}</TableCell>
                                <TableCell className="text-right font-mono">{tx.quantity ?? "-"}</TableCell>
                                <TableCell className="text-right font-mono">{toMoney(tx.gross_revenue)}</TableCell>
                                <TableCell className="text-right font-mono">{toMoney(tx.commission)}</TableCell>
                                <TableCell className="text-right font-mono">{toMoney(tx.net_revenue)}</TableCell>
                                {customPropertyColumns.map((column) => {
                                  const value = formatCustomValue(customProperties[column]);
                                  return (
                                    <TableCell key={column} className="max-w-[220px] truncate" title={value}>
                                      {value}
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                  ) : (
                    <p className="text-sm text-muted-foreground">No normalized transactions available.</p>
                  )}
                </TabsContent>
                )}
              </Tabs>
            </DetailDrawerFrame>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}


