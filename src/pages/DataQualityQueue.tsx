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
import { ClipboardCheck, AlertTriangle, CircleCheckBig, Lock } from "lucide-react";
import { format, isValid } from "date-fns";
import { KpiStrip, PageHeader } from "@/components/layout";

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
  }, [selectedTask?.id]);

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
        .select("report_id, status, severity");

      if (taskError) throw taskError;

      return reportsData.map(report => {
        const reportTasks = (taskSummary || []).filter(t => t.report_id === report.id);
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
      const open = tasks.filter((task) => task.status === "open" || task.status === "in_progress").length;
      const critical = tasks.filter(
        (task) => (task.status === "open" || task.status === "in_progress") && task.severity === "critical"
      ).length;
      const resolved = tasks.filter((task) => task.status === "resolved").length;
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

  return (
    <div className="rhythm-page min-w-0 overflow-x-hidden">
      <PageHeader
        title={selectedReportId ? "Reviewing Statement" : "Statement Reviews"}
        subtitle={
          selectedReportId
            ? `Resolving issues for ${selectedReportName}`
            : "Choose a statement and resolve flagged items."
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Statements Requiring Review</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingReports ? (
              <p className="text-sm text-muted-foreground">Loading reports...</p>
            ) : reports.length > 0 ? (
              <Table className="min-w-[760px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>CMO</TableHead>
                    <TableHead>File Name</TableHead>
                    <TableHead>Processed</TableHead>
                    <TableHead>Open Issues</TableHead>
                    <TableHead>Critical</TableHead>
                    <TableHead>Action</TableHead>
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
                      <TableCell className="text-muted-foreground text-xs">
                        {safeFormat(report.processed_at, "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <span className="font-bold">{report.metrics?.open ?? 0}</span>
                      </TableCell>
                      <TableCell>
                        {(report.metrics?.critical ?? 0) > 0 ? (
                          <span className="font-mono font-bold">{report.metrics?.critical}</span>
                        ) : (
                          <span className="font-mono text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" onClick={() => setSelectedReportId(report.id)}>
                          Review Statement
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">All reports are clean! No tasks found.</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Issues in {selectedReportName}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingTasks ? (
              <p className="text-sm text-muted-foreground">Loading tasks...</p>
            ) : tasks.length > 0 ? (
               <Table className="min-w-[940px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Issue</TableHead>
                    <TableHead>What Needs Review</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
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
                          className="cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                          <TableCell className="max-w-[400px] truncate text-sm">{toPublisherIssueMessage(issuePreview)}</TableCell>
                          <TableCell className="text-muted-foreground text-[10px]">
                            {safeFormat(task.created_at, "HH:mm")}
                          </TableCell>
                        </TableRow>
                      );
                    })()
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No open tasks for this report.</p>
            )}
          </CardContent>
        </Card>
      )}

      <Sheet open={!!selectedTask} onOpenChange={(open) => !open && setSelectedTask(null)}>
        <SheetContent className="w-[min(96vw,1180px)] max-w-[min(96vw,1180px)] overflow-y-auto sm:max-w-[min(92vw,1180px)]">
          {selectedTask && activeDetail ? (
            <>
              <SheetHeader>
                <SheetTitle className="text-xl flex items-center justify-between pr-8">
                  <div className="flex flex-col">
                    <span>
                      {(sourceRow?.raw_payload as any)?.track_title || (sourceRow?.raw_payload as any)?.track_name || "Unknown Track"}
                    </span>
                    <span className="text-sm font-normal text-muted-foreground">
                      by {(sourceRow?.raw_payload as any)?.track_artist || (sourceRow?.raw_payload as any)?.artist_name || "Unknown Artist"}
                    </span>
                    {sourceRow && (
                      <span className="text-[10px] mt-1 font-bold uppercase text-primary/60 tracking-wider">
                        Audit Reference: Page {sourceRow.source_page || 1}, Row {sourceRow.source_row_index + 1}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <StatusBadge status={selectedTask.status} />
                    <StatusBadge status={selectedTask.severity} />
                  </div>
                </SheetTitle>
              </SheetHeader>

              <div className="mt-6 rhythm-section">
                {/* 1. Decision Card (Action Area) */}
                <div className="border-t border-black/20 pt-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-1">
                      {selectedTask.status === "resolved"
                        ? <CircleCheckBig className="h-5 w-5 text-[hsl(var(--tone-success))]" />
                        : <ClipboardCheck className="h-5 w-5 text-[hsl(var(--brand-accent))]" />}
                    </div>
                    <h3 className="font-display text-xl">
                      {selectedTask.status === "resolved" ? "Resolution Summary" : selectedTask.status === "in_progress" ? "Continue Review" : "Review Decision"}
                    </h3>
                  </div>

                  {selectedTask.status === "resolved" ? (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="space-y-4 border-t border-black/20 pt-3">
                        <div className="flex items-center justify-between border-b border-black/20 pb-3">
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

                          <div className="mt-2 border-t border-black/20 pt-3">
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
                      {/* Multi-Issue Warning */}
                      {activeDetail.errors.length > 1 && (
                        <div className="mb-4 border-t border-black/20 pt-3 text-foreground text-xs flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-[hsl(var(--tone-warning))]" />
                          <div>
                            <p className="font-bold">Multiple issues found for this row.</p>
                            <p>Please resolve each issue below. The task will stay open until all critical items are fixed.</p>
                          </div>
                        </div>
                      )}

                      {/* Dynamic Resolution Form */}
                      <div className="rhythm-section">
                        <div className="rhythm-section">
                          {/* Progress Indicator */}
                          {activeDetail.errors.length > 1 && (
                            <div className="flex items-center justify-between border-t border-black/20 py-2 text-[10px] font-black uppercase tracking-tighter text-foreground">
                              <span>
                                Now Resolving: Issue {activeDetail.activeIssueIndex + 1} of {activeDetail.errors.length}
                              </span>
                              <div className="flex gap-1">
                                {activeDetail.errors.map((_: any, i: number) => (
                                  <div
                                    key={i}
                                    className={`h-1.5 w-4 border border-border ${
                                      i === activeDetail.activeIssueIndex ? "bg-foreground" : "bg-transparent"
                                    }`}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Active Error Form */}
                          <div className="space-y-4 border-t border-black/20 pt-3">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                {toReadableField(activeDetail.activeError.field || "Review item")}
                              </span>
                              {activeDetail.activeError.severity && <StatusBadge status={activeDetail.activeError.severity} />}
                            </div>

                            {activeDetail.isHeaderMapping && (
                              <div className="space-y-3">
                                <p className="text-sm text-foreground">
                                  {toPublisherIssueMessage(activeDetail.activeError)}
                                </p>
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
                                  <div className="space-y-2 pt-2 animate-in fade-in slide-in-from-top-1">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Property Name (System ID)</Label>
                                    <Input
                                      type="text"
                                      className="font-mono"
                                      placeholder="e.g. label_code"
                                      value={resolutionForm.customMappingKey}
                                      onChange={(e) =>
                                        setResolutionForm({ ...resolutionForm, customMappingKey: toSnakeCase(e.target.value) })
                                      }
                                    />
                                    <p className="text-[10px] text-muted-foreground italic">
                                      This will be saved as <span className="font-bold text-primary">{resolutionForm.customMappingKey || "..."}</span>
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}

                            {activeDetail.isUncertainty && (
                              <div className="space-y-3">
                                <p className="text-sm text-foreground">
                                  {toPublisherIssueMessage(activeDetail.activeError)}
                                </p>
                                <Input
                                  type="text"
                                  placeholder="Enter correct value"
                                  value={resolutionForm.correctedValue}
                                  onChange={(e) => setResolutionForm({ ...resolutionForm, correctedValue: e.target.value })}
                                />
                              </div>
                            )}

                            {activeDetail.isCorrection && (
                              <div className="space-y-3">
                                <p className="text-sm text-foreground">
                                  {toPublisherIssueMessage(activeDetail.activeError)}
                                </p>
                                <Input
                                  type="text"
                                  className="font-mono"
                                  placeholder={`Enter corrected ${toReadableField(activeDetail.activeError.field || "value")}`}
                                  value={resolutionForm.correctedValue}
                                  onChange={(e) => setResolutionForm({ ...resolutionForm, correctedValue: e.target.value })}
                                />
                              </div>
                            )}

                            {activeDetail.isCurrency && (
                              <div className="space-y-3">
                                <p className="text-sm text-foreground">Currency is missing.</p>
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
                                    <SelectItem value="__none__">Select...</SelectItem>
                                    <SelectItem value="USD">USD - Dollar</SelectItem>
                                    <SelectItem value="EUR">EUR - Euro</SelectItem>
                                    <SelectItem value="GBP">GBP - Pound</SelectItem>
                                    <SelectItem value="NGN">NGN - Naira</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            )}

                            {activeDetail.isPeriod && (
                              <div className="space-y-2">
                                <p className="text-xs text-muted-foreground">{toPublisherIssueMessage(activeDetail.activeError)}</p>
                                <div className="grid grid-cols-2 gap-2">
                                  <Input type="date" className="h-9 px-2 text-xs" onChange={(e) => {
                                    try {
                                      const c = (resolutionForm.correctedValue && resolutionForm.correctedValue.startsWith('{'))
                                        ? JSON.parse(resolutionForm.correctedValue)
                                        : {};
                                      c.start = e.target.value;
                                      setResolutionForm({ ...resolutionForm, correctedValue: JSON.stringify(c) });
                                    } catch (err) {
                                      setResolutionForm({ ...resolutionForm, correctedValue: JSON.stringify({ start: e.target.value }) });
                                    }
                                  }} />
                                  <Input type="date" className="h-9 px-2 text-xs" onChange={(e) => {
                                    try {
                                      const c = (resolutionForm.correctedValue && resolutionForm.correctedValue.startsWith('{'))
                                        ? JSON.parse(resolutionForm.correctedValue)
                                        : {};
                                      c.end = e.target.value;
                                      setResolutionForm({ ...resolutionForm, correctedValue: JSON.stringify(c) });
                                    } catch (err) {
                                      setResolutionForm({ ...resolutionForm, correctedValue: JSON.stringify({ end: e.target.value }) });
                                    }
                                  }} />
                                </div>
                              </div>
                            )}

                            {activeDetail.isProvenance && (
                              <div className="space-y-2">
                                <p className="text-sm">{toPublisherIssueMessage(activeDetail.activeError)}</p>
                                {activeDetail.activeError.field === "source_page" && (
                                  <Input
                                    type="number"
                                    placeholder="Page #"
                                    value={resolutionForm.correctedValue}
                                    onChange={(e) => setResolutionForm({ ...resolutionForm, correctedValue: e.target.value })}
                                  />
                                )}
                              </div>
                            )}
                          </div>

                          {/* Remaining Issues List (Read Only) */}
                          {activeDetail.errors.length > 1 && (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">
                                  Remaining Fixes ({Math.max(0, activeDetail.errors.length - 1)})
                                </span>
                                <div className="flex gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={activeDetail.activeIssueIndex === 0}
                                    onClick={() => setActiveIssueIndex((current) => Math.max(0, current - 1))}
                                  >
                                    Previous
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={activeDetail.activeIssueIndex >= activeDetail.errors.length - 1}
                                    onClick={() =>
                                      setActiveIssueIndex((current) =>
                                        Math.min(activeDetail.errors.length - 1, current + 1)
                                      )
                                    }
                                  >
                                    Next
                                  </Button>
                                </div>
                              </div>
                              {activeDetail.errors
                                .filter((_: any, idx: number) => idx !== activeDetail.activeIssueIndex)
                                .map((err: any, i: number) => (
                                <div key={i} className="flex items-center gap-2 border-b border-black/15 py-1.5 text-[10px] text-muted-foreground">
                                  <div className="h-1.5 w-1.5 bg-muted-foreground" />
                                  <span className="font-bold">{toPublisherIssueLabel(err?.type)}</span>: {toPublisherIssueMessage(err)}
                                </div>
                                ))}
                            </div>
                          )}
                        </div>

                        {/* Mass Fix Toggle */}
                        {(activeDetail.isCurrency || activeDetail.isPeriod) && (
                          <div className="flex items-center space-x-2 border-t border-black/20 py-3">
                            <Checkbox
                              id="mass-fix"
                              checked={applyToReport}
                              onCheckedChange={(checked) => setApplyToReport(!!checked)}
                            />
                            <div className="grid gap-1.5 leading-none">
                              <label
                                htmlFor="mass-fix"
                                className="text-xs font-bold leading-none cursor-pointer text-foreground"
                              >
                                Apply to all similar issues in this statement
                              </label>
                              <p className="text-[10px] text-muted-foreground">
                                Use this correction for all matching rows in {reports.find(r => r.id === selectedReportId)?.file_name || "this statement"}.
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="space-y-2">
                          <Label htmlFor="resolution-note" className="text-[10px] uppercase font-bold text-muted-foreground">Reviewer Note (Optional)</Label>
                          <Textarea
                            id="resolution-note"
                            placeholder="Audit trail note..."
                            value={resolutionNote}
                            className="resize-none h-20 text-sm focus:ring-2 focus:ring-primary"
                            onChange={(e) => setResolutionNote(e.target.value)}
                          />
                        </div>

                        <div className="flex gap-3 pt-2">
                          <Button
                            onClick={handleResolve}
                            disabled={actionMutation.isPending}
                            className="flex-1 font-bold"
                          >
                            {actionMutation.isPending ? "Saving..." : "Save Review"}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => actionMutation.mutate({ taskId: selectedTask.id, action: "dismiss" })}
                            disabled={actionMutation.isPending}
                            className="flex-1 text-muted-foreground text-xs"
                          >
                            Skip for Now
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* 2. Evidence Grid */}
                <section className="border-t border-black/20 pt-4">
                  <h3 className="pb-2 text-sm font-display text-muted-foreground">Source Evidence</h3>
                  {sourceRow ? (
                    <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2 lg:grid-cols-3">
                      {Object.entries((sourceRow.raw_payload as any) || {})
                        .filter(([_, v]) => v !== null && v !== undefined && v !== "")
                        .map(([key, value]) => (
                          <div key={key} className="flex flex-col border-b border-black/15 py-1">
                            <span className="text-[10px] font-bold uppercase text-muted-foreground">
                              {String(key).replace(/_/g, " ")}
                            </span>
                            <span className="text-sm font-medium">{String(value)}</span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="text-sm italic text-muted-foreground">No evidence data found for this row.</p>
                  )}
                </section>

                {/* 3. Normalized Mapping */}
                {transaction?.custom_properties && Object.keys(transaction.custom_properties).length > 0 && (
                  <section className="border-t border-black/20 pt-4">
                    <h3 className="flex items-center gap-2 pb-2 text-sm font-display text-foreground">
                      <ClipboardCheck className="h-3 w-3" />
                      Mapped Custom Data
                    </h3>
                    <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2 lg:grid-cols-3">
                      {Object.entries((transaction.custom_properties as any) || {}).map(([key, value]) => (
                        <div key={key} className="flex flex-col border-b border-black/15 py-1">
                          <span className="text-[10px] font-bold uppercase text-muted-foreground">
                            {String(key).replace(/_/g, " ")}
                          </span>
                          <span className="text-sm font-medium">{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <section className="border-t border-black/20 pt-4">
                  <h3 className="pb-2 text-sm font-display text-muted-foreground">System Mapping</h3>
                  {sourceFields.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {sourceFields.map((field) => (
                        <div key={field.id} className="border-t border-black/20 pt-3">
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
                    <p className="text-sm italic text-muted-foreground">No mappings available for this row.</p>
                  )}
                </section>

                {/* 4. Technical Details (Collapsible) */}
                <details className="group border-t border-black/20 pt-3">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                    Technical Details (Advanced)
                  </summary>
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Task Payload</p>
                        <pre className="max-h-40 overflow-auto border border-black/15 bg-background p-3 text-[10px] text-muted-foreground">
                          {JSON.stringify(selectedTask.payload, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Source Raw Evidence</p>
                        <pre className="max-h-40 overflow-auto border border-black/15 bg-background p-3 text-[10px] text-muted-foreground">
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
