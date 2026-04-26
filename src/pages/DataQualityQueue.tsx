import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { ClipboardCheck, AlertTriangle, ChevronLeft, ChevronRight, CircleCheckBig, Lock } from "lucide-react";
import { format, isValid } from "date-fns";
import { KpiStrip, PageHeader } from "@/components/layout";
import { cn } from "@/lib/utils";
import { isTrackMatchTaskPayload } from "@/lib/report-workflow";

type ReviewTask = Tables<"review_tasks">;
type SourceRow = Tables<"source_rows">;
type SourceField = Tables<"source_fields">;
type TaskPayload = Record<string, any>;
type QueueIssue = Record<string, any>;

const toTaskPayload = (rawPayload: ReviewTask["payload"]): TaskPayload => {
  if (typeof rawPayload === "object" && rawPayload !== null && !Array.isArray(rawPayload)) {
    return rawPayload as TaskPayload;
  }
  if (typeof rawPayload === "string") {
    try {
      const parsed = JSON.parse(rawPayload);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as TaskPayload)
        : {};
    } catch {
      return {};
    }
  }
  return {};
};

const toReadableField = (field: string | null | undefined): string => {
  if (!field) return "this field";
  return field.replace(/_/g, " ");
};

const toSnakeCase = (str: string) => {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
};

const toCustomFieldLabel = (key: string) =>
  key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const toPublisherIssueLabel = (errorType: string | null | undefined): string => {
  switch (errorType) {
    case "numeric_outlier":
      return "Unusual value";
    case "revenue_math_mismatch":
      return "Revenue mismatch";
    case "numeric_parse_guard":
    case "parse_guard":
      return "Number needs review";
    case "missing_required_field":
      return "Missing required information";
    case "quantity_missing":
      return "Missing quantity";
    case "currency_missing":
      return "Missing currency";
    case "mapping_unresolved":
    case "mapping_unmapped_header":
      return "Unknown column mapping";
    case "mapping_low_confidence":
    case "normalization_uncertainty":
    case "low_confidence":
      return "Low confidence match";
    case "unrecognized_field_value":
      return "Unrecognized value";
    case "period_mismatch":
    case "period_inversion":
    case "period_year_out_of_range":
      return "Invalid period";
    case "provenance_missing":
    case "provenance_missing_page":
    case "provenance_missing_evidence":
      return "Missing source evidence";
    default:
      return "Review needed";
  }
};

const toPublisherIssueMessage = (issue: QueueIssue | null | undefined): string => {
  if (!issue) return "Please review this row and confirm the correct value.";

  const type = String(issue.type || issue.error_type || "");
  const field = toReadableField(issue.field);
  const actual = issue.actual != null ? String(issue.actual) : null;
  const expected = issue.expected != null ? String(issue.expected) : null;

  switch (type) {
    case "numeric_outlier":
      return `The ${field} value looks unusually high or low. Please confirm the correct amount.`;
    case "revenue_math_mismatch":
      return expected && actual
        ? `Net revenue does not match gross minus commission. Expected ${expected}, got ${actual}.`
        : "Net revenue does not match gross minus commission. Please confirm the values.";
    case "numeric_parse_guard":
    case "parse_guard":
      return `We could not reliably read ${field} as a number. Please enter the correct value.`;
    case "missing_required_field":
      return `Required information is missing for ${field}. Please provide a value.`;
    case "quantity_missing":
      return "Quantity is missing. Please provide the usage count.";
    case "currency_missing":
      return "Currency is missing. Please select the correct currency code.";
    case "mapping_unresolved":
    case "mapping_unmapped_header":
      return actual
        ? `The column header "${actual}" is unknown. Please map it to the right field.`
        : "A column header is unknown. Please map it to the right field.";
    case "mapping_low_confidence":
    case "normalization_uncertainty":
    case "low_confidence":
      return actual
        ? `The value "${actual}" may be incorrect for ${field}. Confirm or replace it.`
        : `The value for ${field} has low confidence. Confirm or replace it.`;
    case "unrecognized_field_value":
      return actual
        ? `The value "${actual}" is not valid for ${field}. Please correct it.`
        : `The value for ${field} is not valid. Please correct it.`;
    case "period_mismatch":
    case "period_inversion":
    case "period_year_out_of_range":
      return "The reporting period looks invalid. Please set the correct start and end dates.";
    case "provenance_missing":
    case "provenance_missing_page":
    case "provenance_missing_evidence":
      return "Source evidence is incomplete. Please confirm or provide the missing source details.";
    default:
      return String(issue.message || "Please review this row and confirm the correct value.");
  }
};

const toIssueValueText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const parseCorrectedPeriod = (value: string | null | undefined): { start?: string; end?: string } => {
  if (!value || !value.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as { start?: string; end?: string })
      : {};
  } catch {
    return {};
  }
};

export default function DataQualityQueue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<ReviewTask | null>(null);
  const [activeIssueIndex, setActiveIssueIndex] = useState(0);
  const [resolutionNote, setResolutionNote] = useState("");
  const [resolutionForm, setResolutionForm] = useState({
    canonicalField: "",
    customMappingKey: "",
    correctedValue: "",
  });
  const [applyToReport, setApplyToReport] = useState(false);

  // Pre-fill and reset form when task changes
  // SENIOR ENGINEER FIX: Side-effects MUST be in useEffect, never useMemo.
  useEffect(() => {
    if (!selectedTask) return;

    const payload = toTaskPayload(selectedTask.payload);

    const initialValue = (
      selectedTask.task_type === "normalization_uncertainty" ||
      ["normalization_uncertainty", "mapping_low_confidence", "numeric_parse_guard", "revenue_math_mismatch", "numeric_outlier", "quantity_missing", "unrecognized_field_value", "currency_missing"].includes(payload?.error_type)
    ) ? (payload?.actual || payload?.raw_value || "") : "";

    const rawHeader = payload?.unmapped_header || payload?.actual || "";

    setResolutionForm({
      canonicalField: "",
      customMappingKey: toSnakeCase(String(rawHeader)),
      correctedValue: String(initialValue ?? ""),
    });
    setActiveIssueIndex(0);
    setResolutionNote("");
    setApplyToReport(false);
  }, [selectedTask]);

  const { data: reports = [], isLoading: isLoadingReports } = useQuery({
    queryKey: ["reports_with_tasks"],
    queryFn: async () => {
      // First get reports
      const { data: reportsData, error: reportsError } = await supabase
        .from("cmo_reports")
        .select("id, cmo_name, file_name, statement_reference, processed_at, status")
        .order("processed_at", { ascending: false });

      if (reportsError) throw reportsError;

      // Get task counts per report
      const { data: taskSummary, error: taskError } = await supabase
        .from("review_tasks")
        .select("report_id, status, severity, payload");

      if (taskError) throw taskError;

      return reportsData.map(report => {
        const reportTasks = (taskSummary || []).filter((task) => {
          if (task.report_id !== report.id) return false;
          return !isTrackMatchTaskPayload(toTaskPayload(task.payload as ReviewTask["payload"]));
        });
        const open = reportTasks.filter(t => t.status === "open" || t.status === "in_progress").length;
        const critical = reportTasks.filter(t => (t.status === "open" || t.status === "in_progress") && t.severity === "critical").length;
        const resolved = reportTasks.filter(t => t.status === "resolved").length;

        return {
          ...report,
          metrics: { open, critical, resolved }
        };
      }).filter(r => r.metrics.open > 0 || r.metrics.resolved > 0);
    }
  });

  const { data: tasks = [], isLoading: isLoadingTasks } = useQuery({
    queryKey: ["review-tasks", selectedReportId],
    enabled: !!selectedReportId,
    queryFn: async (): Promise<ReviewTask[]> => {
      const { data, error } = await supabase
        .from("review_tasks")
        .select("*")
        .eq("report_id", selectedReportId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const filteredTasks = useMemo(
    () => tasks.filter((task) => !isTrackMatchTaskPayload(toTaskPayload(task.payload))),
    [tasks],
  );

  const { data: knownCustomFields = [] } = useQuery({
    queryKey: ["known-custom-fields"],
    queryFn: async (): Promise<string[]> => {
      try {
        const [mappingRes, sourceFieldRes] = await Promise.all([
          (supabase as any)
            .from("column_mappings")
            .select("canonical_field")
            .eq("is_active", true)
            .ilike("canonical_field", "custom:%"),
          (supabase as any)
            .from("source_fields")
            .select("mapping_rule")
            .not("mapping_rule", "is", null)
            .ilike("mapping_rule", "custom:%")
            .limit(1000),
        ]);

        const keys = new Set<string>();
        for (const row of mappingRes.data ?? []) {
          const canonical = String(row?.canonical_field ?? "");
          if (canonical.startsWith("custom:")) {
            const key = toSnakeCase(canonical.slice("custom:".length));
            if (key) keys.add(key);
          }
        }
        for (const row of sourceFieldRes.data ?? []) {
          const canonical = String(row?.mapping_rule ?? "");
          if (canonical.startsWith("custom:")) {
            const key = toSnakeCase(canonical.slice("custom:".length));
            if (key) keys.add(key);
          }
        }

        return Array.from(keys).sort((a, b) => a.localeCompare(b));
      } catch (error) {
        console.warn("[DataQualityQueue] Failed to load known custom fields:", error);
        return [];
      }
    },
  });

  // ... (existing queries) ...
  const { data: sourceRow } = useQuery({
    queryKey: ["source-row", selectedTask?.source_row_id],
    enabled: !!selectedTask?.source_row_id,
    queryFn: async (): Promise<SourceRow | null> => {
      const { data, error } = await supabase
        .from("source_rows")
        .select("*")
        .eq("id", selectedTask!.source_row_id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    }
  });

  const { data: sourceFields = [] } = useQuery({
    // ... existing ...
    queryKey: ["source-fields", selectedTask?.source_row_id],
    enabled: !!selectedTask?.source_row_id,
    queryFn: async (): Promise<SourceField[]> => {
      const { data, error } = await supabase
        .from("source_fields")
        .select("*")
        .eq("source_row_id", selectedTask!.source_row_id!)
        .order("field_name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    }
  });

  const { data: transaction } = useQuery({
    queryKey: ["transaction", selectedTask?.source_row_id],
    enabled: !!selectedTask?.source_row_id,
    queryFn: async (): Promise<Tables<"royalty_transactions"> | null> => {
      const sourceRowId = selectedTask?.source_row_id;
      if (!sourceRowId) return null;

      const { data, error } = await supabase
        .from("royalty_transactions")
        .select("*")
        .eq("source_row_id", sourceRowId)
        .maybeSingle();
      if (error) throw error;
      return data;
    }
  });

  const actionMutation = useMutation({
    mutationFn: async (payload: { taskId: string; action: string; rule?: any; correctedValue?: string; correctedField?: string; applyToReport?: boolean }) => {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) {
        throw new Error("Session expired. Please sign in again.");
      }

      const { data, error } = await supabase.functions.invoke("submit-review-resolution", {
        body: {
          task_id: payload.taskId,
          action: payload.action,
          resolution_note: resolutionNote || null,
          corrected_value: payload.correctedValue,
          corrected_field: payload.correctedField,
          apply_to_report: payload.applyToReport,
          rule: payload.rule,
        },
      });
      if (error) {
        let message = error.message;
        const context = (error as any)?.context;
        if (context instanceof Response) {
          try {
            const body = await context.clone().json();
            if (body?.error && typeof body.error === "string") {
              message = body.error;
            }
          } catch {
            // Ignore JSON parse failures and keep fallback message.
          }
        }
        throw new Error(message);
      }
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["review-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["reports_with_tasks"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["report-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["analytics-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["source-fields"] });
      queryClient.invalidateQueries({ queryKey: ["source-row"] });
      queryClient.invalidateQueries({ queryKey: ["known-custom-fields"] });

      // Reset local input state
      setResolutionNote("");
      setResolutionForm({ canonicalField: "", customMappingKey: "", correctedValue: "" });
      setApplyToReport(false);

      if (data.bulk) {
        setSelectedTask(null);
        toast({ title: "Bulk resolution applied", description: data.message });
        return;
      }

      // CO-FOUNDER UX: If the task is partially resolved (in_progress), keep sheet open
      // and update the selectedTask state with the new payload from the server.
      if (data.task?.status === "in_progress") {
        const nextPayload = toTaskPayload(data.task.payload as ReviewTask["payload"]);
        const nextErrors = Array.isArray(nextPayload?.errors) ? nextPayload.errors : [];
        setSelectedTask(data.task);
        setActiveIssueIndex((current) => Math.min(Math.max(0, nextErrors.length - 1), current + 1));
        toast({ title: "Issue resolved", description: "Continuing to next issue for this row." });
      } else {
        setSelectedTask(null);
        toast({ title: "Task fully resolved" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update review task", description: error.message, variant: "destructive" });
    },
  });

  const handleResolve = () => {
    if (!selectedTask) return;

    const payload = toTaskPayload(selectedTask.payload);
    // Sequential Multi-Issue Logic: target the issue selected in the progression rail.
    const errors = Array.isArray(payload?.errors) ? payload.errors : [];
    const activeError = errors.length > 0 ? errors[Math.min(activeIssueIndex, errors.length - 1)] : null;
    const activeErrorType = activeError?.type || payload?.error_type || selectedTask.task_type;
    const activeField = activeError?.field || payload?.field;

    // 1. Header Mapping (Global)
    if (activeErrorType === "mapping_unresolved" || activeErrorType === "mapping_unmapped_header") {
      const isCustomMapping = resolutionForm.canonicalField === "custom_property";
      const finalCanonical = isCustomMapping ? `custom:${resolutionForm.customMappingKey}` : resolutionForm.canonicalField;

      if (!resolutionForm.canonicalField) {
        toast({ title: "Please select a field to map to", variant: "destructive" });
        return;
      }
      if (isCustomMapping && !resolutionForm.customMappingKey) {
        toast({ title: "Please enter a key for the custom property", variant: "destructive" });
        return;
      }

      actionMutation.mutate({
        taskId: selectedTask.id,
        action: "define_rule",
        rule: {
          target_table: "column_mappings",
          raw_header: activeError?.actual || payload?.unmapped_header,
          canonical_field: finalCanonical,
        }
      });
      return;
    }

    // 2. Normalization Uncertainty (Row-Level)
    if (activeErrorType === "normalization_uncertainty" || activeErrorType === "mapping_low_confidence") {
      actionMutation.mutate({
        taskId: selectedTask.id,
        action: resolutionForm.correctedValue ? "correct" : "approve",
        correctedValue: resolutionForm.correctedValue,
        correctedField: activeField || "mapping_confidence",
        applyToReport
      });
      return;
    }

    // 3. Row Corrections (Sequential)
    const isCorrectionType = [
      "numeric_parse_guard", "revenue_math_mismatch", "numeric_outlier", "quantity_missing",
      "missing_required_field", "unrecognized_field_value", "parse_guard", "negative_value",
      "currency_missing", "period_mismatch", "period_inversion", "period_year_out_of_range",
      "provenance_missing", "provenance_missing_page"
    ].includes(activeErrorType);

    if (isCorrectionType) {
      const isProvenanceType = ["provenance_missing", "provenance_missing_page"].includes(activeErrorType);
      const requiresSourcePageValue = isProvenanceType && activeField === "source_page";
      const hasCorrectedValue = Boolean(resolutionForm.correctedValue);

      if (isProvenanceType && !activeField) {
        // Non-field provenance acknowledgements should be approvals, not data corrections.
        actionMutation.mutate({ taskId: selectedTask.id, action: "approve" });
        return;
      }

      if (!hasCorrectedValue && !isProvenanceType) {
        toast({ title: `Please provide a value for ${activeField || "field"}`, variant: "destructive" });
        return;
      }

      if (requiresSourcePageValue && !hasCorrectedValue) {
        toast({ title: "Please provide a source page value", variant: "destructive" });
        return;
      }

      actionMutation.mutate({
        taskId: selectedTask.id,
        action: "correct",
        correctedValue: resolutionForm.correctedValue,
        correctedField: activeField,
        applyToReport
      });
      return;
    }

    // Default Approve
    actionMutation.mutate({ taskId: selectedTask.id, action: "approve" });
  };

  const metrics = useMemo(() => {
    if (selectedReportId) {
      const open = filteredTasks.filter((task) => task.status === "open" || task.status === "in_progress").length;
      const critical = filteredTasks.filter(
        (task) => (task.status === "open" || task.status === "in_progress") && task.severity === "critical"
      ).length;
      const resolved = filteredTasks.filter((task) => task.status === "resolved").length;
      return { open, critical, resolved };
    } else {
      const open = reports.reduce((acc, r) => acc + (r.metrics?.open || 0), 0);
      const critical = reports.reduce((acc, r) => acc + (r.metrics?.critical || 0), 0);
      const resolved = reports.reduce((acc, r) => acc + (r.metrics?.resolved || 0), 0);
      return { open, critical, resolved };
    }
  }, [tasks, reports, selectedReportId]);

  const selectedReportName = useMemo(() => {
    const report = reports.find(r => r.id === selectedReportId);
    if (!report) return "Selected Report";
    return `${report.cmo_name || "Unknown CMO"} | ${report.file_name}`;
  }, [reports, selectedReportId]);

  // SENIOR ENGINEER RELIABILITY: Safe date formatting wrapper
  const safeFormat = (dateStr: any, formatStr: string) => {
    if (!dateStr) return "N/A";
    const date = new Date(dateStr);
    if (!isValid(date)) return "N/A";
    return format(date, formatStr);
  };

  // Memoize derived task state for stability and performance
  const activeDetail = useMemo(() => {
    if (!selectedTask) return null;
    const payload = toTaskPayload(selectedTask.payload);
    const errors = Array.isArray(payload?.errors) ? payload.errors : [];
    const safeIndex = Math.min(activeIssueIndex, Math.max(0, errors.length - 1));
    const activeError = errors.length > 0
      ? errors[safeIndex]
      : {
        type: payload?.error_type || selectedTask.task_type || "other",
        field: payload?.field,
        actual: payload?.actual,
        message: selectedTask.reason,
        severity: selectedTask.severity
      };

    return {
      payload,
      errors,
      activeError,
      isHeaderMapping: activeError.type === "mapping_unresolved" || activeError.type === "mapping_unmapped_header",
      isUncertainty:
        activeError.type === "normalization_uncertainty" ||
        activeError.type === "mapping_low_confidence" ||
        activeError.type === "low_confidence" ||
        selectedTask.task_type === "low_confidence",
      isCorrection: ["numeric_parse_guard", "revenue_math_mismatch", "numeric_outlier", "quantity_missing", "missing_required_field", "unrecognized_field_value", "parse_guard", "negative_value"].includes(activeError.type),
      isCurrency: activeError.type === "currency_missing",
      isPeriod: activeError.type === "period_mismatch" || activeError.type === "period_inversion" || activeError.type === "period_year_out_of_range",
      isProvenance: activeError.type === "provenance_missing" || activeError.type === "provenance_missing_page" || activeError.type === "provenance_missing_evidence",
      activeIssueIndex: safeIndex,
    };
  }, [selectedTask, activeIssueIndex]);

  const sourcePayload = useMemo(() => {
    const raw = sourceRow?.raw_payload;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, any>) : null;
  }, [sourceRow]);

  const activeTrackTitle = sourcePayload?.track_title || sourcePayload?.track_name || "Unknown Track";
  const activeArtistName = sourcePayload?.track_artist || sourcePayload?.artist_name || "Unknown Artist";
  const activeIssueLabel = activeDetail
    ? toPublisherIssueLabel(String(activeDetail.activeError.type || activeDetail.payload?.error_type || selectedTask?.task_type || ""))
    : "Review needed";
  const activeIssueMessage = activeDetail ? toPublisherIssueMessage(activeDetail.activeError) : "";
  const activeFieldLabel = activeDetail?.activeError.field ? toReadableField(activeDetail.activeError.field) : "Review item";
  const activeActualValue = activeDetail ? toIssueValueText(activeDetail.activeError.actual) : null;
  const activeExpectedValue = activeDetail ? toIssueValueText(activeDetail.activeError.expected) : null;
  const correctedPeriod = useMemo(() => parseCorrectedPeriod(resolutionForm.correctedValue), [resolutionForm.correctedValue]);
  const canApplyToStatement = Boolean(activeDetail && (activeDetail.isCurrency || activeDetail.isPeriod));
  const saveReviewLabel = actionMutation.isPending
    ? "Saving..."
    : activeDetail && activeDetail.errors.length > 1 && activeDetail.activeIssueIndex < activeDetail.errors.length - 1
      ? "Save and continue"
      : "Save resolution";

  return (
    <div className="rhythm-page min-w-0 overflow-x-hidden">
      <PageHeader
        title={selectedReportId ? selectedReportName : "Statement Reviews"}
        meta={
          <>
            <span className="rounded-full border border-[hsl(var(--brand-accent)/0.16)] bg-[hsl(var(--brand-accent-ghost)/0.7)] px-2.5 py-1 text-[10px] font-ui uppercase tracking-[0.12em] text-[hsl(var(--brand-accent))]">
              {metrics.open} open
            </span>
            <span className="rounded-full border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-elevated)/0.84)] px-2.5 py-1 text-[10px] font-ui uppercase tracking-[0.12em] text-muted-foreground">
              {metrics.critical} critical
            </span>
          </>
        }
        actions={
          selectedReportId ? (
            <Button variant="outline" size="sm" onClick={() => setSelectedReportId(null)}>
              Back to Reports
            </Button>
          ) : null
        }
      />

      <KpiStrip
        variant="hero"
        items={[
          {
            label: "Open Tasks",
            value: metrics.open.toLocaleString(),
            icon: <ClipboardCheck className="h-4 w-4 text-[hsl(var(--brand-accent))]" />,
          },
          {
            label: "Critical Open",
            value: metrics.critical.toLocaleString(),
            tone: "critical",
            icon: <AlertTriangle className="h-4 w-4 text-[hsl(var(--tone-critical))]" />,
          },
          {
            label: "Resolved",
            value: metrics.resolved.toLocaleString(),
            tone: "success",
            icon: <CircleCheckBig className="h-4 w-4 text-[hsl(var(--tone-success))]" />,
          },
        ]}
        columnsClassName="sm:grid-cols-3"
      />

      {!selectedReportId ? (
        <Card surface="evidence">
          <CardHeader className="border-b border-[hsl(var(--border)/0.1)] pb-4">
            <CardTitle className="text-base">Review queue</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingReports ? (
              <p className="text-sm text-muted-foreground">Loading reports...</p>
            ) : reports.length > 0 ? (
              <Table className="w-full min-w-[760px]" variant="evidence" density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[10rem]">CMO</TableHead>
                    <TableHead className="min-w-[24rem]">File Name</TableHead>
                    <TableHead className="w-[8.5rem] whitespace-nowrap">Processed</TableHead>
                    <TableHead className="w-[8rem] whitespace-nowrap">Open Issues</TableHead>
                    <TableHead className="w-[6rem] whitespace-nowrap">Critical</TableHead>
                    <TableHead className="w-[13rem] text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reports.map((report) => (
                    <TableRow key={report.id}>
                      <TableCell className="font-medium">
                        {report.cmo_name ?? "-"}
                      </TableCell>
                      <TableCell className="font-medium">
                        {report.file_name}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {safeFormat(report.processed_at, "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="font-bold">{report.metrics?.open ?? 0}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {(report.metrics?.critical ?? 0) > 0 ? (
                          <span className="font-mono font-bold">{report.metrics?.critical}</span>
                        ) : (
                          <span className="font-mono text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" className="w-full sm:w-auto" onClick={() => setSelectedReportId(report.id)}>
                          Review Statement
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="surface-muted forensic-frame rounded-[calc(var(--radius-sm))] px-4 py-10 text-center text-sm text-muted-foreground">
                No statements in review.
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card surface="hero">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-[hsl(var(--border)/0.1)] pb-4">
            <CardTitle className="text-base">Issues</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingTasks ? (
              <p className="text-sm text-muted-foreground">Loading tasks...</p>
            ) : filteredTasks.length > 0 ? (
               <Table className="w-full min-w-[940px]" variant="evidence" density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[8.5rem]">Status</TableHead>
                    <TableHead className="w-[8.5rem]">Severity</TableHead>
                    <TableHead className="w-[13rem]">Issue</TableHead>
                    <TableHead className="min-w-[24rem]">What Needs Review</TableHead>
                    <TableHead className="w-[6rem] whitespace-nowrap">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTasks.map((task) => (
                    (() => {
                      const taskPayload = toTaskPayload(task.payload);
                      const issueList = Array.isArray(taskPayload?.errors) ? taskPayload.errors : [];
                      const issuePreview = issueList.length > 0
                        ? issueList[0]
                        : {
                          type: taskPayload?.error_type || task.task_type,
                          field: taskPayload?.field,
                          actual: taskPayload?.actual,
                          expected: taskPayload?.expected,
                          message: task.reason,
                        };

                      return (
                        <TableRow
                          key={task.id}
                          role="button"
                          tabIndex={0}
                          className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={(event) => {
                            event.currentTarget.focus();
                            setSelectedTask(task);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedTask(task);
                            }
                          }}
                        >
                          <TableCell>
                            <StatusBadge status={task.status} />
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={task.severity} />
                          </TableCell>
                          <TableCell className="text-xs">{toPublisherIssueLabel(String(issuePreview.type || ""))}</TableCell>
                          <TableCell className="min-w-[24rem] whitespace-normal text-sm leading-relaxed">
                            {toPublisherIssueMessage(issuePreview)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-[10px] text-muted-foreground">
                            {safeFormat(task.created_at, "HH:mm")}
                          </TableCell>
                        </TableRow>
                      );
                    })()
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="surface-muted forensic-frame rounded-[calc(var(--radius-sm))] px-4 py-10 text-center text-sm text-muted-foreground">
                No open tasks remain for this statement.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Sheet open={!!selectedTask} onOpenChange={(open) => !open && setSelectedTask(null)}>
        <SheetContent className="w-[min(98vw,1260px)] max-w-[min(98vw,1260px)] overflow-y-auto p-0 sm:max-w-[min(95vw,1260px)]">
          {selectedTask && activeDetail ? (
            <>
              <SheetHeader className="border-b border-[hsl(var(--border)/0.1)] px-6 pb-5 pt-6">
                <div className="flex flex-col gap-4 pr-8 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="editorial-kicker">
                        {selectedTask.status === "resolved" ? "Resolved issue" : "Resolve issue"}
                      </span>
                      <StatusBadge status={selectedTask.status} />
                      <StatusBadge status={selectedTask.severity} />
                    </div>
                    <SheetTitle className="min-w-0 break-words text-xl">{activeIssueLabel}</SheetTitle>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">{activeTrackTitle}</p>
                      <p className="text-sm text-muted-foreground">by {activeArtistName}</p>
                      {sourceRow ? (
                        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--brand-accent-soft))]">
                          Page {sourceRow.source_page || 1} • Row {sourceRow.source_row_index + 1}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </SheetHeader>

              <div className="mt-6 space-y-6 px-6 pb-6">
                {/* 1. Decision Card (Action Area) */}
                <div
                  className={cn(
                    selectedTask.status === "resolved"
                      ? "surface-hero forensic-frame rounded-[calc(var(--radius)-2px)] p-5"
                      : "space-y-5",
                  )}
                >
                  {selectedTask.status === "resolved" ? (
                    <div className="mb-4 flex items-center gap-3">
                      <div className="p-1">
                        <CircleCheckBig className="h-5 w-5 text-[hsl(var(--tone-success))]" />
                      </div>
                      <h3 className="font-display text-xl">Resolution Summary</h3>
                    </div>
                  ) : null}

                  {selectedTask.status === "resolved" ? (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="space-y-4 border-t border-[hsl(var(--border)/0.1)] pt-3">
                        <div className="flex items-center justify-between border-b border-[hsl(var(--border)/0.1)] pb-3">
                          <div className="flex items-center gap-2">
                            <Lock className="h-3 w-3 text-foreground" />
                            <span className="text-[10px] font-black tracking-widest text-foreground uppercase">Audit Trail Locked</span>
                          </div>
                          <span className="text-[9px] font-mono text-muted-foreground italic">
                            REF-{selectedTask.id.split('-')[0].toUpperCase()}
                          </span>
                        </div>

                        <div className="space-y-3">
                          <div className="flex justify-between items-start text-sm">
                            <span className="text-muted-foreground">Decision Outcome:</span>
                            <span className="font-bold text-foreground flex items-center gap-1">
                              <CircleCheckBig className="h-4 w-4" />
                              Resolution Applied
                            </span>
                          </div>

                          <div className="flex justify-between items-start text-sm">
                            <span className="text-muted-foreground">Resolved By:</span>
                            <span className="font-medium font-mono text-xs">{selectedTask.resolved_by || "System/User"}</span>
                          </div>

                          <div className="flex justify-between items-start text-sm">
                            <span className="text-muted-foreground">Completed At:</span>
                            <span className="font-medium font-mono text-xs">{safeFormat(selectedTask.resolved_at, "PPP 'at' HH:mm")}</span>
                          </div>

                          <div className="mt-2 border-t border-[hsl(var(--border)/0.1)] pt-3">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Impact Analysis</p>
                            <div className="space-y-2">
                              <p className="text-sm">
                                Action <span className="font-mono text-xs">{activeDetail.payload?.resolution_action || "approval"}</span>
                                {activeDetail.payload?.corrected_value && (
                                  <> applied to <span className="font-bold">{activeDetail.payload?.field}</span></>
                                )}
                              </p>
                              {activeDetail.payload?.corrected_value && (
                                <p className="text-sm">
                                  Value corrected to: <span className="font-mono text-xs text-foreground font-bold">{activeDetail.payload?.corrected_value}</span>
                                </p>
                              )}
                            </div>
                          </div>

                          {selectedTask.resolution_note && (
                            <div className="pt-2">
                              <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Decision Note</p>
                              <p className="text-sm italic text-muted-foreground">
                                "{selectedTask.resolution_note}"
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      <Button variant="outline" className="w-full" onClick={() => setSelectedTask(null)}>
                        Back to Statements
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="surface-hero forensic-frame mb-4 rounded-[calc(var(--radius)-2px)] p-5">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="editorial-kicker">Review context</span>
                              {activeDetail.errors.length > 1 ? (
                                <span className="rounded-full border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.78)] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                                  Issue {activeDetail.activeIssueIndex + 1} of {activeDetail.errors.length}
                                </span>
                              ) : null}
                            </div>
                            <p className="max-w-3xl text-sm leading-6 text-foreground/88">{activeIssueMessage}</p>
                          </div>

                          {activeDetail.errors.length > 1 ? (
                            <div className="flex items-center gap-2 self-start">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={activeDetail.activeIssueIndex === 0}
                                onClick={() => setActiveIssueIndex((current) => Math.max(0, current - 1))}
                              >
                                <ChevronLeft className="h-4 w-4" />
                                Previous
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={activeDetail.activeIssueIndex >= activeDetail.errors.length - 1}
                                onClick={() => setActiveIssueIndex((current) => Math.min(activeDetail.errors.length - 1, current + 1))}
                              >
                                Next
                                <ChevronRight className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-3">
                            <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Field</p>
                            <p className="mt-2 text-sm font-semibold capitalize text-foreground">{activeFieldLabel}</p>
                          </div>
                          <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-3">
                            <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">Current value</p>
                            <p className="mt-2 break-words font-mono text-xs text-foreground [overflow-wrap:anywhere]">
                              {activeActualValue ?? "Not supplied"}
                            </p>
                          </div>
                          <div className="surface-elevated forensic-frame rounded-[calc(var(--radius-sm))] p-3">
                            <p className="text-[10px] font-ui uppercase tracking-[0.14em] text-muted-foreground">
                              {activeExpectedValue ? "Expected" : "Audit reference"}
                            </p>
                            <p className="mt-2 break-words font-mono text-xs text-foreground [overflow-wrap:anywhere]">
                              {activeExpectedValue ?? (sourceRow ? `Page ${sourceRow.source_page || 1} • Row ${sourceRow.source_row_index + 1}` : "This row")}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Dynamic Resolution Form */}
                      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
                        <div className="space-y-4">
                          {/* Active Error Form */}
                          <div className="surface-elevated forensic-frame space-y-4 rounded-[calc(var(--radius-sm))] p-4">
                            <div className="space-y-1.5">
                              <h4 className="text-base font-semibold text-foreground">Choose the right fix</h4>
                              <p className="text-sm text-muted-foreground">
                                Keep the correction as focused as possible for this issue.
                              </p>
                            </div>

                            {activeDetail.isHeaderMapping && (
                              <div className="space-y-3">
                                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Map this header to</Label>
                                <Select
                                  value={resolutionForm.canonicalField || "__none__"}
                                  onValueChange={(value) =>
                                    setResolutionForm({
                                      ...resolutionForm,
                                      canonicalField: value === "__none__" ? "" : value,
                                    })
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select target..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">Select Target...</SelectItem>
                                    <SelectItem value="track_title">Track Title</SelectItem>
                                    <SelectItem value="artist_name">Artist Name</SelectItem>
                                    <SelectItem value="isrc">ISRC</SelectItem>
                                    <SelectItem value="iswc">ISWC</SelectItem>
                                    <SelectItem value="territory">Territory</SelectItem>
                                    <SelectItem value="platform">Platform</SelectItem>
                                    <SelectItem value="quantity">Quantity</SelectItem>
                                    <SelectItem value="gross_revenue">Gross Revenue</SelectItem>
                                    <SelectItem value="net_revenue">Net Revenue</SelectItem>
                                    <SelectItem value="commission">Commission</SelectItem>
                                    <SelectItem value="label_name">Label Name</SelectItem>
                                    <SelectItem value="rights_type">Rights Type</SelectItem>
                                    {knownCustomFields.map((fieldKey) => (
                                      <SelectItem key={fieldKey} value={`custom:${fieldKey}`}>
                                        Saved: {toCustomFieldLabel(fieldKey)}
                                      </SelectItem>
                                    ))}
                                    <SelectItem value="custom_property">Save as custom property...</SelectItem>
                                  </SelectContent>
                                </Select>

                                {resolutionForm.canonicalField === "custom_property" && (
                                  <div className="space-y-2 pt-1 animate-in fade-in slide-in-from-top-1">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Custom property key</Label>
                                    <Input
                                      type="text"
                                      className="font-mono"
                                      placeholder="e.g. label_code"
                                      value={resolutionForm.customMappingKey}
                                      onChange={(e) =>
                                        setResolutionForm({ ...resolutionForm, customMappingKey: toSnakeCase(e.target.value) })
                                      }
                                    />
                                    <p className="text-[10px] text-muted-foreground">
                                      Saves as <span className="font-mono text-foreground">{resolutionForm.customMappingKey || "..."}</span>
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}

                            {activeDetail.isUncertainty && (
                              <div className="space-y-3">
                                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Correct value (optional)</Label>
                                <Input
                                  type="text"
                                  placeholder="Enter the correct value if you want to override"
                                  value={resolutionForm.correctedValue}
                                  onChange={(e) => setResolutionForm({ ...resolutionForm, correctedValue: e.target.value })}
                                />
                                <p className="text-xs text-muted-foreground">
                                  Leave this blank if the extracted value is acceptable and you only want to approve it.
                                </p>
                              </div>
                            )}

                            {activeDetail.isCorrection && (
                              <div className="space-y-3">
                                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Correct {activeFieldLabel}</Label>
                                <Input
                                  type="text"
                                  className="font-mono"
                                  placeholder={`Enter corrected ${activeFieldLabel}`}
                                  value={resolutionForm.correctedValue}
                                  onChange={(e) => setResolutionForm({ ...resolutionForm, correctedValue: e.target.value })}
                                />
                              </div>
                            )}

                            {activeDetail.isCurrency && (
                              <div className="space-y-3">
                                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Currency code</Label>
                                <Select
                                  value={resolutionForm.correctedValue || "__none__"}
                                  onValueChange={(value) =>
                                    setResolutionForm({
                                      ...resolutionForm,
                                      correctedValue: value === "__none__" ? "" : value,
                                    })
                                  }
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder="Select currency" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">Select currency...</SelectItem>
                                    <SelectItem value="USD">USD - Dollar</SelectItem>
                                    <SelectItem value="EUR">EUR - Euro</SelectItem>
                                    <SelectItem value="GBP">GBP - Pound</SelectItem>
                                    <SelectItem value="NGN">NGN - Naira</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            )}

                            {activeDetail.isPeriod && (
                              <div className="space-y-3">
                                <Label className="text-[10px] uppercase font-bold text-muted-foreground">Correct date window</Label>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Start date</Label>
                                    <Input
                                      type="date"
                                      value={correctedPeriod.start ?? ""}
                                      onChange={(e) => {
                                        const nextValue = { ...correctedPeriod, start: e.target.value };
                                        setResolutionForm({ ...resolutionForm, correctedValue: JSON.stringify(nextValue) });
                                      }}
                                    />
                                  </div>
                                  <div className="space-y-1.5">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">End date</Label>
                                    <Input
                                      type="date"
                                      value={correctedPeriod.end ?? ""}
                                      onChange={(e) => {
                                        const nextValue = { ...correctedPeriod, end: e.target.value };
                                        setResolutionForm({ ...resolutionForm, correctedValue: JSON.stringify(nextValue) });
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>
                            )}

                            {activeDetail.isProvenance && (
                              <div className="space-y-3">
                                {activeDetail.activeError.field === "source_page" ? (
                                  <>
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Source page</Label>
                                    <Input
                                      type="number"
                                      placeholder="Page #"
                                      value={resolutionForm.correctedValue}
                                      onChange={(e) => setResolutionForm({ ...resolutionForm, correctedValue: e.target.value })}
                                    />
                                  </>
                                ) : (
                                  <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.72)] px-3 py-3 text-sm text-muted-foreground">
                                    No corrected value is needed here. Save the review once you have confirmed the source evidence is acceptable.
                                  </div>
                                )}
                              </div>
                            )}

                            {!activeDetail.isHeaderMapping &&
                              !activeDetail.isUncertainty &&
                              !activeDetail.isCorrection &&
                              !activeDetail.isCurrency &&
                              !activeDetail.isPeriod &&
                              !activeDetail.isProvenance && (
                                <div className="rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.72)] px-3 py-3 text-sm text-muted-foreground">
                                  No data correction is required here. Save the review once you have confirmed the issue.
                                </div>
                              )}
                          </div>

                        </div>

                        <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
                          <div className="surface-hero forensic-frame space-y-4 rounded-[calc(var(--radius-sm))] p-4">
                            <div className="space-y-1.5">
                              <p className="editorial-kicker">Finalize</p>
                              <h4 className="text-base font-semibold text-foreground">Apply this review</h4>
                              <p className="text-sm leading-6 text-muted-foreground">
                                {canApplyToStatement
                                  ? `This will update the current issue now. You can also reuse the same correction across ${selectedReportName}.`
                                  : "This will save the decision for the current issue only."}
                              </p>
                            </div>

                            {canApplyToStatement && (
                              <label
                                htmlFor="mass-fix"
                                className="flex cursor-pointer items-start gap-3 rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.12)] bg-[hsl(var(--surface-panel)/0.72)] p-3"
                              >
                                <Checkbox
                                  id="mass-fix"
                                  checked={applyToReport}
                                  onCheckedChange={(checked) => setApplyToReport(!!checked)}
                                  className="mt-0.5"
                                />
                                <span className="grid gap-1.5 leading-none">
                                  <span className="text-sm font-semibold text-foreground">Apply across this statement</span>
                                  <span className="text-xs leading-5 text-muted-foreground">
                                    Reuse this correction for matching issues in {selectedReportName}.
                                  </span>
                                </span>
                              </label>
                            )}

                            <div className="space-y-2">
                              <Label htmlFor="resolution-note" className="text-[10px] uppercase font-bold text-muted-foreground">
                                Reviewer note
                              </Label>
                              <Textarea
                                id="resolution-note"
                                placeholder="Add context for the audit trail..."
                                value={resolutionNote}
                                className="h-24 resize-none text-sm"
                                onChange={(e) => setResolutionNote(e.target.value)}
                              />
                            </div>

                            <div className="flex flex-col gap-2 pt-1">
                              <Button
                                onClick={handleResolve}
                                disabled={actionMutation.isPending}
                                className="w-full font-bold"
                              >
                                {saveReviewLabel}
                              </Button>
                              <Button
                                variant="quiet"
                                onClick={() => actionMutation.mutate({ taskId: selectedTask.id, action: "dismiss" })}
                                disabled={actionMutation.isPending}
                                className="w-full text-xs text-muted-foreground"
                              >
                                Skip for now
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* 2. Evidence Grid */}
                <section className="surface-elevated forensic-frame rounded-[calc(var(--radius)-2px)] p-5">
                  <h3 className="pb-3 text-sm font-display text-muted-foreground">Source</h3>
                  {sourceRow ? (
                    <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2 lg:grid-cols-3">
                      {Object.entries((sourceRow.raw_payload as any) || {})
                        .filter(([_, v]) => v !== null && v !== undefined && v !== "")
                        .map(([key, value]) => (
                          <div key={key} className="flex flex-col border-b border-[hsl(var(--border)/0.08)] py-1">
                            <span className="text-[10px] font-bold uppercase text-muted-foreground">
                              {String(key).replace(/_/g, " ")}
                            </span>
                            <span className="text-sm font-medium">{String(value)}</span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">No source data found for this row.</p>
                  )}
                </section>

                {/* 3. Normalized Mapping */}
                {transaction?.custom_properties && Object.keys(transaction.custom_properties).length > 0 && (
                  <section className="surface-elevated forensic-frame rounded-[calc(var(--radius)-2px)] p-5">
                    <h3 className="flex items-center gap-2 pb-2 text-sm font-display text-foreground">
                      <ClipboardCheck className="h-3 w-3" />
                      Custom fields
                    </h3>
                    <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2 lg:grid-cols-3">
                      {Object.entries((transaction.custom_properties as any) || {}).map(([key, value]) => (
                        <div key={key} className="flex flex-col border-b border-[hsl(var(--border)/0.08)] py-1">
                          <span className="text-[10px] font-bold uppercase text-muted-foreground">
                            {String(key).replace(/_/g, " ")}
                          </span>
                          <span className="text-sm font-medium">{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <section className="surface-elevated forensic-frame rounded-[calc(var(--radius)-2px)] p-5">
                  <h3 className="pb-3 text-sm font-display text-muted-foreground">Normalized row</h3>
                  {sourceFields.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {sourceFields.map((field) => (
                        <div key={field.id} className="border-t border-[hsl(var(--border)/0.08)] pt-3">
                          <p className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">{field.field_name}</p>
                          <p className="truncate text-sm font-semibold" title={field.normalized_value?.toString()}>
                            {field.normalized_value ?? <span className="text-destructive">Missing</span>}
                          </p>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="text-[9px] text-muted-foreground">Match Confidence</span>
                            <span
                              className={`text-[9px] font-mono ${Number(field.mapping_confidence) > 90
                                ? "text-foreground"
                                : Number(field.mapping_confidence) > 70
                                  ? "text-foreground/80"
                                  : "text-muted-foreground"
                                }`}
                            >
                              {field.mapping_confidence ? `${field.mapping_confidence}%` : "0%"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">No normalized values are available for this row.</p>
                  )}
                </section>

                {/* 4. Technical Details (Collapsible) */}
                <details className="group surface-muted forensic-frame rounded-[calc(var(--radius)-2px)] p-5">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                    Technical details
                  </summary>
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Task Payload</p>
                        <pre className="max-h-40 overflow-auto rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.08)] bg-[hsl(var(--surface-panel)/0.84)] p-3 text-[10px] text-muted-foreground">
                          {JSON.stringify(selectedTask.payload, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Source Raw Evidence</p>
                        <pre className="max-h-40 overflow-auto rounded-[calc(var(--radius-sm))] border border-[hsl(var(--border)/0.08)] bg-[hsl(var(--surface-panel)/0.84)] p-3 text-[10px] text-muted-foreground">
                          {JSON.stringify(sourceRow?.evidence || sourceRow?.raw_payload, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                </details>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
