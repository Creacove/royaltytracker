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
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { ClipboardCheck, AlertTriangle, CircleCheckBig, Lock } from "lucide-react";
import { format, isValid } from "date-fns";

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
  const [resolutionNote, setResolutionNote] = useState("");
  const [resolutionForm, setResolutionForm] = useState({
    canonicalField: "",
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

    setResolutionForm({ canonicalField: "", correctedValue: String(initialValue ?? "") });
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

  // ... (existing queries) ...
  const { data: sourceRow } = useQuery({
    queryKey: ["source-row", selectedTask?.source_row_id],
    enabled: !!selectedTask?.source_row_id,
    queryFn: async (): Promise<SourceRow | null> => {
      // ... existing ... 
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

  const actionMutation = useMutation({
    mutationFn: async (payload: { taskId: string; action: string; rule?: any; correctedValue?: string; correctedField?: string; applyToReport?: boolean }) => {
      const { data: authData } = await supabase.auth.getSession();
      const accessToken = authData.session?.access_token;
      if (!accessToken) {
        throw new Error("Session expired. Please sign in again.");
      }

      const { data, error } = await supabase.functions.invoke("submit-review-resolution", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
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

      // Reset local input state
      setResolutionNote("");
      setResolutionForm({ canonicalField: "", correctedValue: "" });
      setApplyToReport(false);

      if (data.bulk) {
        setSelectedTask(null);
        toast({ title: "Bulk resolution applied", description: data.message });
        return;
      }

      // CO-FOUNDER UX: If the task is partially resolved (in_progress), keep sheet open
      // and update the selectedTask state with the new payload from the server.
      if (data.task?.status === "in_progress") {
        setSelectedTask(data.task);
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
    // Sequential Multi-Issue Logic: Always target the FIRST unresolved error
    const errors = Array.isArray(payload?.errors) ? payload.errors : [];
    const activeError = errors.length > 0 ? errors[0] : null;
    const activeErrorType = activeError?.type || payload?.error_type || selectedTask.task_type;
    const activeField = activeError?.field || payload?.field;

    // 1. Header Mapping (Global)
    if (activeErrorType === "mapping_unresolved" || activeErrorType === "mapping_unmapped_header") {
      if (!resolutionForm.canonicalField) {
        toast({ title: "Please select a field to map to", variant: "destructive" });
        return;
      }
      actionMutation.mutate({
        taskId: selectedTask.id,
        action: "define_rule",
        rule: {
          target_table: "column_mappings",
          raw_header: activeError?.actual || payload?.unmapped_header,
          canonical_field: resolutionForm.canonicalField,
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
    const activeError = errors.length > 0
      ? errors[0]
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
    };
  }, [selectedTask]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {selectedReportId && (
              <Button
                variant="ghost"
                size="sm"
                className="-ml-2 h-8 text-muted-foreground hover:text-foreground"
                onClick={() => setSelectedReportId(null)}
              >
                {"<"} Reports
              </Button>
            )}
            <h1 className="text-2xl font-bold tracking-tight">
              {selectedReportId ? "Reviewing Report" : "Review Queue"}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {selectedReportId
              ? `Resolving issues for ${selectedReportName}`
              : "Grouped by submission. Review blockers and low-confidence data."
            }
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-accent/20 bg-accent/5">
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="rounded-lg bg-accent p-2">
              <ClipboardCheck className="h-5 w-5 text-accent-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold">{metrics.open}</p>
              <p className="text-xs text-muted-foreground">Open Tasks</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="rounded-lg bg-destructive/10 p-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold">{metrics.critical}</p>
              <p className="text-xs text-muted-foreground">Critical Open</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-success/20 bg-success/5">
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="rounded-lg bg-success/10 p-2">
              <CircleCheckBig className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold">{metrics.resolved}</p>
              <p className="text-xs text-muted-foreground">Resolved</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {!selectedReportId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Reports Requiring Review</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingReports ? (
              <p className="text-sm text-muted-foreground">Loading reports...</p>
            ) : reports.length > 0 ? (
              <Table>
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
                          <span className="text-destructive font-bold">{report.metrics?.critical}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" onClick={() => setSelectedReportId(report.id)}>
                          Open Queue
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
            <CardTitle className="text-base">Tasks for {selectedReportName}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingTasks ? (
              <p className="text-sm text-muted-foreground">Loading tasks...</p>
            ) : tasks.length > 0 ? (
              <Table>
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
                        <TableRow key={task.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedTask(task)}>
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
        <SheetContent className="w-[96vw] max-w-[96vw] overflow-y-auto sm:max-w-[70vw]">
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

              <div className="mt-6 space-y-6">
                {/* 1. Decision Card (Action Area) */}
                <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`p-2 rounded-full ${selectedTask.status === "resolved" ? "bg-success/10" : "bg-primary/10"}`}>
                      {selectedTask.status === "resolved" ? <CircleCheckBig className="h-5 w-5 text-success" /> : <ClipboardCheck className="h-5 w-5 text-primary" />}
                    </div>
                    <h3 className="text-lg font-bold">
                      {selectedTask.status === "resolved" ? "Resolution Summary" : selectedTask.status === "in_progress" ? "Continue Review" : "Review Decision"}
                    </h3>
                  </div>

                  {selectedTask.status === "resolved" ? (
                    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="p-5 rounded-xl bg-success/5 border-2 border-success/20 space-y-4 shadow-inner">
                        <div className="flex items-center justify-between border-b border-success/10 pb-3">
                          <div className="flex items-center gap-2">
                            <div className="h-6 w-6 rounded-full bg-success/20 flex items-center justify-center">
                              <Lock className="h-3 w-3 text-success" />
                            </div>
                            <span className="text-[10px] font-black tracking-widest text-success uppercase">Audit Trail Locked</span>
                          </div>
                          <span className="text-[9px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded italic">
                            REF-{selectedTask.id.split('-')[0].toUpperCase()}
                          </span>
                        </div>

                        <div className="space-y-3">
                          <div className="flex justify-between items-start text-sm">
                            <span className="text-muted-foreground">Decision Outcome:</span>
                            <span className="font-bold text-success flex items-center gap-1">
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

                          <div className="p-3 rounded-lg bg-background/50 border border-muted mt-2">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Impact Analysis</p>
                            <div className="space-y-2">
                              <p className="text-sm">
                                Action <span className="font-mono text-xs bg-muted px-1 rounded">{activeDetail.payload?.resolution_action || "approval"}</span>
                                {activeDetail.payload?.corrected_value && (
                                  <> applied to <span className="font-bold">{activeDetail.payload?.field}</span></>
                                )}
                              </p>
                              {activeDetail.payload?.corrected_value && (
                                <p className="text-sm">
                                  Value corrected to: <span className="font-mono text-xs bg-yellow-50 text-yellow-800 px-1.5 py-0.5 rounded border border-yellow-100 font-bold">{activeDetail.payload?.corrected_value}</span>
                                </p>
                              )}
                            </div>
                          </div>

                          {selectedTask.resolution_note && (
                            <div className="pt-2">
                              <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">Decision Note</p>
                              <p className="text-sm italic text-muted-foreground border-l-2 border-primary/30 pl-3 py-1 bg-primary/5 rounded-r">
                                "{selectedTask.resolution_note}"
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                      <Button variant="outline" className="w-full shadow-sm hover:bg-muted/50 transition-colors" onClick={() => setSelectedTask(null)}>
                        Back to Queue
                      </Button>
                    </div>
                  ) : (
                    <>
                      {/* Multi-Issue Warning */}
                      {activeDetail.errors.length > 1 && (
                        <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-100 text-blue-800 text-xs flex items-start gap-2">
                          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-bold">Multiple issues found for this row.</p>
                            <p>Please resolve each issue below. The task will stay open until all critical items are fixed.</p>
                          </div>
                        </div>
                      )}

                      {/* Dynamic Resolution Form */}
                      <div className="space-y-6">
                        <div className="space-y-6">
                          {/* Progress Indicator */}
                          {activeDetail.errors.length > 1 && (
                            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-tighter text-blue-600 bg-blue-50 px-2 py-1 rounded">
                              <span>Now Resolving: Issue 1 of {activeDetail.errors.length}</span>
                              <div className="flex gap-1">
                                {activeDetail.errors.map((_: any, i: number) => (
                                  <div key={i} className={`h-1.5 w-4 rounded-full ${i === 0 ? "bg-blue-600" : "bg-blue-200"}`} />
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Active Error Form */}
                          <div className="p-4 rounded-lg border-2 border-primary/40 bg-background shadow-sm space-y-4">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-black uppercase tracking-widest text-primary/70">
                                {toReadableField(activeDetail.activeError.field || "Review item")}
                              </span>
                              {activeDetail.activeError.severity && <StatusBadge status={activeDetail.activeError.severity} />}
                            </div>

                            {activeDetail.isHeaderMapping && (
                              <div className="space-y-3">
                                <p className="text-sm text-foreground">
                                  {toPublisherIssueMessage(activeDetail.activeError)}
                                </p>
                                <select
                                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary shadow-sm"
                                  value={resolutionForm.canonicalField}
                                  onChange={(e) => setResolutionForm({ ...resolutionForm, canonicalField: e.target.value })}
                                >
                                  <option value="">Select Target...</option>
                                  <option value="track_title">Track Title</option>
                                  <option value="artist_name">Artist Name</option>
                                  <option value="isrc">ISRC</option>
                                  <option value="iswc">ISWC</option>
                                  <option value="territory">Territory</option>
                                  <option value="platform">Platform</option>
                                  <option value="quantity">Quantity</option>
                                  <option value="gross_revenue">Gross Revenue</option>
                                  <option value="net_revenue">Net Revenue</option>
                                </select>
                              </div>
                            )}

                            {activeDetail.isUncertainty && (
                              <div className="space-y-3">
                                <p className="text-sm text-foreground">
                                  {toPublisherIssueMessage(activeDetail.activeError)}
                                </p>
                                <input
                                  type="text"
                                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary shadow-sm"
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
                                <input
                                  type="text"
                                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary shadow-sm font-mono"
                                  placeholder={`Enter corrected ${toReadableField(activeDetail.activeError.field || "value")}`}
                                  value={resolutionForm.correctedValue}
                                  onChange={(e) => setResolutionForm({ ...resolutionForm, correctedValue: e.target.value })}
                                />
                              </div>
                            )}

                            {activeDetail.isCurrency && (
                              <div className="space-y-3">
                                <p className="text-sm text-foreground">Currency is missing.</p>
                                <select
                                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary shadow-sm"
                                  value={resolutionForm.correctedValue}
                                  onChange={(e) => setResolutionForm({ ...resolutionForm, correctedValue: e.target.value })}
                                >
                                  <option value="">Select...</option>
                                  <option value="USD">USD - Dollar</option>
                                  <option value="EUR">EUR - Euro</option>
                                  <option value="GBP">GBP - Pound</option>
                                  <option value="NGN">NGN - Naira</option>
                                </select>
                              </div>
                            )}

                            {activeDetail.isPeriod && (
                              <div className="space-y-2">
                                <p className="text-xs text-muted-foreground">{toPublisherIssueMessage(activeDetail.activeError)}</p>
                                <div className="grid grid-cols-2 gap-2">
                                  <input type="date" className="h-9 rounded border text-xs px-2" onChange={(e) => {
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
                                  <input type="date" className="h-9 rounded border text-xs px-2" onChange={(e) => {
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
                                  <input
                                    type="number"
                                    className="h-10 w-full rounded border px-3 text-sm"
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
                              <span className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">Pending Fixes ({activeDetail.errors.length - 1})</span>
                              {activeDetail.errors.slice(1).map((err: any, i: number) => (
                                <div key={i} className="flex items-center gap-2 p-2 rounded border bg-muted/5 opacity-50 text-[10px]">
                                  <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                                  <span className="font-bold">{toPublisherIssueLabel(err?.type)}</span>: {toPublisherIssueMessage(err)}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Mass Fix Toggle */}
                        {(activeDetail.isCurrency || activeDetail.isPeriod) && (
                          <div className="flex items-center space-x-2 py-2 px-3 rounded-lg border border-blue-100 bg-blue-50/50 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <Checkbox
                              id="mass-fix"
                              checked={applyToReport}
                              onCheckedChange={(checked) => setApplyToReport(!!checked)}
                            />
                            <div className="grid gap-1.5 leading-none">
                              <label
                                htmlFor="mass-fix"
                                className="text-xs font-bold leading-none cursor-pointer text-blue-800"
                              >
                                Apply to all issues in this report
                              </label>
                              <p className="text-[10px] text-blue-600/70">
                                Perform this correction for all rows in {reports.find(r => r.id === selectedReportId)?.file_name || "this report"}.
                              </p>
                            </div>
                          </div>
                        )}

                        <div className="space-y-2">
                          <Label htmlFor="resolution-note" className="text-[10px] uppercase font-bold text-muted-foreground">Decision Note (Optional)</Label>
                          <Textarea
                            id="resolution-note"
                            placeholder="Audit trail note..."
                            value={resolutionNote}
                            className="resize-none h-20 text-sm focus:ring-2 focus:ring-primary shadow-inner"
                            onChange={(e) => setResolutionNote(e.target.value)}
                          />
                        </div>

                        <div className="flex gap-3 pt-2">
                          <Button
                            onClick={handleResolve}
                            disabled={actionMutation.isPending}
                            className="flex-1 shadow-md hover:scale-[1.01] active:scale-100 transition-all font-bold"
                          >
                            {actionMutation.isPending ? "Applying..." : "Apply Decision"}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => actionMutation.mutate({ taskId: selectedTask.id, action: "dismiss" })}
                            disabled={actionMutation.isPending}
                            className="flex-1 text-muted-foreground text-xs"
                          >
                            Dismiss Row
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* 2. Evidence Grid */}
                <Card className="border-none shadow-none bg-muted/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                      Source Evidence
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {sourceRow ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-4 gap-x-8">
                        {Object.entries((sourceRow.raw_payload as any) || {})
                          .filter(([_, v]) => v !== null && v !== undefined && v !== "")
                          .map(([key, value]) => (
                            <div key={key} className="flex flex-col border-b border-muted py-1">
                              <span className="text-[10px] font-bold uppercase text-muted-foreground">
                                {String(key).replace(/_/g, " ")}
                              </span>
                              <span className="text-sm font-medium">
                                {String(value)}
                              </span>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No evidence data found for this row.</p>
                    )}
                  </CardContent>
                </Card>

                {/* 3. Normalized Mapping */}
                <Card className="border-none shadow-none bg-muted/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                      System Mapping
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {sourceFields.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {sourceFields.map((field) => (
                          <div key={field.id} className="p-3 rounded-lg border bg-background/50">
                            <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">{field.field_name}</p>
                            <p className="text-sm font-semibold truncate" title={field.normalized_value?.toString()}>
                              {field.normalized_value ?? <span className="text-destructive">Missing</span>}
                            </p>
                            <div className="mt-2 flex items-center justify-between">
                              <span className="text-[9px] text-muted-foreground">Match Confidence</span>
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${Number(field.mapping_confidence) > 90 ? "bg-green-100 text-green-700" :
                                Number(field.mapping_confidence) > 70 ? "bg-yellow-100 text-yellow-700" :
                                  "bg-red-100 text-red-700"
                                }`}>
                                {field.mapping_confidence ? `${field.mapping_confidence}%` : "0%"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No mappings available for this row.</p>
                    )}
                  </CardContent>
                </Card>

                {/* 4. Technical Details (Collapsible) */}
                <details className="group rounded-lg border bg-muted/10 p-2">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                    Technical Specifications (Developer Only)
                  </summary>
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Task Payload</p>
                        <pre className="p-3 rounded bg-black/5 text-[10px] text-muted-foreground overflow-auto max-h-40">
                          {JSON.stringify(selectedTask.payload, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase text-muted-foreground mb-1">Source Raw Evidence</p>
                        <pre className="p-3 rounded bg-black/5 text-[10px] text-muted-foreground overflow-auto max-h-40">
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
