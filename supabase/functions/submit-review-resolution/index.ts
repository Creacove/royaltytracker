import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const allowedActions = ["approve", "correct", "define_rule", "dismiss"] as const;
type Action = (typeof allowedActions)[number];
type JsonRecord = Record<string, any>;

function parseJwtClaims(token: string): { role?: string; sub?: string; user_id?: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(b64 + pad));
  } catch {
    return null;
  }
}

function asObject(value: unknown): JsonRecord {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonRecord;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as JsonRecord)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

function asErrors(payload: JsonRecord): JsonRecord[] {
  if (!Array.isArray(payload.errors)) return [];
  return payload.errors.filter((item) => typeof item === "object" && item !== null) as JsonRecord[];
}

function matchesErrorContext(err: JsonRecord, field: string | null, type: string | null): boolean {
  const errField = asString(err.field);
  const errType = asString(err.type);
  if (field && type) return errField === field && errType === type;
  if (field) return errField === field;
  if (type) return errType === type;
  return false;
}

function mapToTransactionField(field: string): string {
  const aliases: Record<string, string> = {
    track_artist: "artist_name",
    usage_count: "quantity",
    country: "territory",
    channel: "platform",
    amount_in_original_currency: "amount_original",
    amount_in_reporting_currency: "amount_reporting",
    master_commission: "commission",
    royalty_revenue: "net_revenue",
    original_currency: "currency_original",
    reporting_currency: "currency_reporting",
  };
  return aliases[field] ?? field;
}

function isCurrencyField(field: string): boolean {
  return ["currency", "currency_original", "currency_reporting"].includes(field);
}

function normalizeCurrencyCode(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeCorrectedValueForField(field: string, correctedValue: string): string {
  const mapped = mapToTransactionField(field);
  if (isCurrencyField(mapped)) return normalizeCurrencyCode(correctedValue);
  return correctedValue;
}

function sourceFieldTargets(field: string): string[] {
  const mapped = mapToTransactionField(field);
  const names = new Set<string>([field, mapped]);

  if (mapped === "currency") {
    names.add("currency_original");
    names.add("currency_reporting");
    names.add("original_currency");
    names.add("reporting_currency");
  }

  if (mapped === "currency_original") {
    names.add("original_currency");
    names.add("currency");
  }

  if (mapped === "currency_reporting") {
    names.add("reporting_currency");
    names.add("currency");
  }

  if (mapped === "artist_name") {
    names.add("track_artist");
  }

  if (mapped === "quantity") {
    names.add("usage_count");
  }

  return Array.from(names);
}

function extractTransactionId(payload: JsonRecord): string | null {
  return (
    asString(payload.transaction_id) ??
    asString(payload.transactionId) ??
    asString(payload.royalty_transaction_id)
  );
}

function buildTransactionUpdates(inputField: string, correctedValue: string): JsonRecord {
  const updates: JsonRecord = {};
  const field = mapToTransactionField(inputField);
  const numericFields = [
    "quantity",
    "gross_revenue",
    "commission",
    "net_revenue",
    "amount_original",
    "amount_reporting",
    "exchange_rate",
  ];

  if (numericFields.includes(field)) {
    const n = Number(correctedValue);
    if (!Number.isFinite(n)) throw new Error(`Corrected value for ${field} must be numeric.`);
    updates[field] = n;
    return updates;
  }

  if (isCurrencyField(field)) {
    const code = normalizeCurrencyCode(correctedValue);
    updates.currency = code;
    updates.currency_original = code;
    updates.currency_reporting = code;
    return updates;
  }

  if (field === "period") {
    let p: JsonRecord;
    try {
      p = JSON.parse(correctedValue);
    } catch {
      throw new Error("Period correction must be a valid JSON object with start/end.");
    }
    updates.period_start = asString(p.start);
    updates.period_end = asString(p.end);
    return updates;
  }

  updates[field] = correctedValue;
  return updates;
}

function parseSourcePage(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error("source_page correction must be a positive integer.");
  }
  return n;
}

function deriveValidationStatus(errors: JsonRecord[]): "failed" | "passed" {
  const hasCritical = errors.some((err) => asString(err.severity) === "critical");
  return hasCritical ? "failed" : "passed";
}

async function recomputeReportQualityGate(
  supabase: ReturnType<typeof createClient>,
  reportId: string
): Promise<{
  quality_gate_status: "passed" | "needs_review" | "failed";
  report_status: "completed_passed" | "completed_with_warnings" | "needs_review";
  ingestion_status: "validated" | "needs_review";
  metrics: {
    transactions: number;
    failed_transactions: number;
    open_review_tasks: number;
    open_critical_review_tasks: number;
    validation_errors: number;
  };
}> {
  const { data: report, error: reportErr } = await supabase
    .from("cmo_reports")
    .select("id, ingestion_file_id")
    .eq("id", reportId)
    .single();
  if (reportErr || !report) {
    throw new Error(`Failed to load report for gate recompute: ${reportErr?.message ?? "missing"}`);
  }

  const [txCountRes, failedTxRes, openTasksRes, openCriticalTasksRes, validationErrorsRes] =
    await Promise.all([
      supabase
        .from("royalty_transactions")
        .select("*", { count: "exact", head: true })
        .eq("report_id", reportId),
      supabase
        .from("royalty_transactions")
        .select("*", { count: "exact", head: true })
        .eq("report_id", reportId)
        .eq("validation_status", "failed"),
      supabase
        .from("review_tasks")
        .select("*", { count: "exact", head: true })
        .eq("report_id", reportId)
        .in("status", ["open", "in_progress"]),
      supabase
        .from("review_tasks")
        .select("*", { count: "exact", head: true })
        .eq("report_id", reportId)
        .in("status", ["open", "in_progress"])
        .eq("severity", "critical"),
      supabase
        .from("validation_errors")
        .select("*", { count: "exact", head: true })
        .eq("report_id", reportId),
    ]);

  if (txCountRes.error) throw new Error(`Failed to count transactions: ${txCountRes.error.message}`);
  if (failedTxRes.error) throw new Error(`Failed to count failed transactions: ${failedTxRes.error.message}`);
  if (openTasksRes.error) throw new Error(`Failed to count open review tasks: ${openTasksRes.error.message}`);
  if (openCriticalTasksRes.error) {
    throw new Error(`Failed to count critical review tasks: ${openCriticalTasksRes.error.message}`);
  }
  if (validationErrorsRes.error) {
    throw new Error(`Failed to count validation errors: ${validationErrorsRes.error.message}`);
  }

  const txCount = txCountRes.count ?? 0;
  const failedTxCount = failedTxRes.count ?? 0;
  const openTaskCount = openTasksRes.count ?? 0;
  const openCriticalTaskCount = openCriticalTasksRes.count ?? 0;
  const validationErrorCount = validationErrorsRes.count ?? 0;

  let qualityGateStatus: "passed" | "needs_review" | "failed" = "passed";
  let reportStatus: "completed_passed" | "completed_with_warnings" | "needs_review" = "completed_passed";
  let ingestionStatus: "validated" | "needs_review" = "validated";

  if (txCount === 0) {
    qualityGateStatus = "failed";
    reportStatus = "needs_review";
    ingestionStatus = "needs_review";
  } else if (openCriticalTaskCount > 0 || failedTxCount > 0) {
    qualityGateStatus = "failed";
    reportStatus = "needs_review";
    ingestionStatus = "needs_review";
  } else if (openTaskCount > 0) {
    qualityGateStatus = "needs_review";
    reportStatus = "needs_review";
    ingestionStatus = "needs_review";
  } else if (validationErrorCount > 0) {
    qualityGateStatus = "passed";
    reportStatus = "completed_with_warnings";
    ingestionStatus = "validated";
  }

  const { error: reportUpdateErr } = await supabase
    .from("cmo_reports")
    .update({
      status: reportStatus,
      quality_gate_status: qualityGateStatus,
    })
    .eq("id", reportId);
  if (reportUpdateErr) {
    throw new Error(`Failed to update report gate state: ${reportUpdateErr.message}`);
  }

  if (report.ingestion_file_id) {
    const { error: ingestionUpdateErr } = await supabase
      .from("ingestion_files")
      .update({ ingestion_status: ingestionStatus })
      .eq("id", report.ingestion_file_id);
    if (ingestionUpdateErr) {
      throw new Error(`Failed to update ingestion gate state: ${ingestionUpdateErr.message}`);
    }
  }

  return {
    quality_gate_status: qualityGateStatus,
    report_status: reportStatus,
    ingestion_status: ingestionStatus,
    metrics: {
      transactions: txCount,
      failed_transactions: failedTxCount,
      open_review_tasks: openTaskCount,
      open_critical_review_tasks: openCriticalTaskCount,
      validation_errors: validationErrorCount,
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase env.");
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    const jwt = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!jwt) throw new Error("Missing Authorization header");

    const claims = parseJwtClaims(jwt);
    const requesterRole = claims?.role ?? null;
    let requesterId = claims?.sub ?? claims?.user_id ?? null;

    if (requesterRole !== "service_role") {
      const { data: authData, error: authErr } = await supabase.auth.getUser(jwt);
      if (authErr || !authData?.user?.id) {
        throw new Error("Unable to resolve authenticated user from access token.");
      }
      requesterId = authData.user.id;
    }

    const body = await req.json().catch(() => ({}));
    const taskId = asString((body as { task_id?: string }).task_id);
    const actionRaw = (body as { action?: string }).action ?? "approve";
    const resolutionNote = asString((body as { resolution_note?: string }).resolution_note);
    const correctedValue = asString((body as { corrected_value?: string }).corrected_value);
    const correctedField = asString((body as { corrected_field?: string }).corrected_field);
    const applyToReport = (body as { apply_to_report?: boolean }).apply_to_report ?? false;
    const rule = (body as { rule?: JsonRecord }).rule;

    if (!taskId) throw new Error("task_id is required");
    if (!allowedActions.includes(actionRaw as Action)) {
      throw new Error(`Invalid action "${actionRaw}"`);
    }
    const action = actionRaw as Action;

    const { data: task, error: taskErr } = await supabase
      .from("review_tasks")
      .select("*")
      .eq("id", taskId)
      .single();
    if (taskErr || !task) throw new Error(`Review task not found: ${taskErr?.message ?? "missing"}`);

    if (requesterRole !== "service_role" && requesterId !== task.user_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const taskPayload = asObject(task.payload);
    const taskErrors = asErrors(taskPayload);
    const activeError = taskErrors.length > 0 ? taskErrors[0] : null;
    const activeErrorType =
      asString(activeError?.type) ?? asString(taskPayload.error_type) ?? asString(task.task_type);
    const activeField =
      correctedField ?? asString(activeError?.field) ?? asString(taskPayload.field);

    if (applyToReport && action === "correct") {
      if (!activeField) throw new Error("Cannot apply report-wide correction without a target field.");
      if (!correctedValue) throw new Error("corrected_value is required for bulk correction.");
      const normalizedBulkValue = normalizeCorrectedValueForField(activeField, correctedValue);

      const { data: sameTasks, error: sameTasksErr } = await supabase
        .from("review_tasks")
        .select("id, payload, status, source_row_id")
        .eq("report_id", task.report_id)
        .in("status", ["open", "in_progress"]);
      if (sameTasksErr) throw new Error(`Failed to load matching tasks: ${sameTasksErr.message}`);

      const matchingTasks = (sameTasks ?? []).filter((candidate) => {
        const payload = asObject(candidate.payload);
        const errors = asErrors(payload);
        const payloadField = asString(payload.field);
        const payloadType = asString(payload.error_type);
        const fieldMatch = payloadField === activeField || errors.some((e) => asString(e.field) === activeField);
        const typeMatch = !activeErrorType || payloadType === activeErrorType || errors.some((e) => asString(e.type) === activeErrorType);
        return fieldMatch && typeMatch;
      });

      const taskTargets = matchingTasks.map((candidate) => {
        const payload = asObject(candidate.payload);
        return {
          candidate,
          payload,
          sourceRowId: asString(candidate.source_row_id) ?? asString(payload.source_row_id),
          transactionId: extractTransactionId(payload),
        };
      });

      const resolvableTargets = taskTargets.filter((target) => target.sourceRowId || target.transactionId);
      const skippedCount = taskTargets.length - resolvableTargets.length;

      if (resolvableTargets.length === 0) {
        throw new Error(
          "No row linkage found for matching tasks (missing source_row_id/transaction_id), so normalized data could not be updated.",
        );
      }

      const sourceRowIds = Array.from(
        new Set(
          resolvableTargets
            .map((target) => target.sourceRowId)
            .filter((value): value is string => Boolean(value)),
        ),
      );

      const transactionIds = Array.from(
        new Set(
          resolvableTargets
            .map((target) => target.transactionId)
            .filter((value): value is string => Boolean(value)),
        ),
      );

      if (activeField === "source_page") {
        const sourcePage = parseSourcePage(normalizedBulkValue);
        let touchedSourceRows = 0;
        let touchedTransactions = 0;

        if (sourceRowIds.length > 0) {
          const { data: srcRows, error: srcErr } = await supabase
            .from("source_rows")
            .update({ source_page: sourcePage })
            .in("id", sourceRowIds)
            .select("id");
          if (srcErr) throw new Error(`Bulk source_rows update failed: ${srcErr.message}`);
          touchedSourceRows += srcRows?.length ?? 0;
        }

        if (sourceRowIds.length > 0) {
          const { data: txRows, error: txBySourceErr } = await supabase
            .from("royalty_transactions")
            .update({ source_page: sourcePage })
            .eq("report_id", task.report_id)
            .in("source_row_id", sourceRowIds)
            .select("id");
          if (txBySourceErr) throw new Error(`Bulk transaction source_page update failed: ${txBySourceErr.message}`);
          touchedTransactions += txRows?.length ?? 0;
        }

        if (transactionIds.length > 0) {
          const { data: txRowsById, error: txByIdErr } = await supabase
            .from("royalty_transactions")
            .update({ source_page: sourcePage })
            .eq("report_id", task.report_id)
            .in("id", transactionIds)
            .select("id");
          if (txByIdErr) throw new Error(`Bulk transaction source_page by id update failed: ${txByIdErr.message}`);
          touchedTransactions += txRowsById?.length ?? 0;
        }

        if (sourceRowIds.length > 0 && touchedSourceRows === 0) {
          throw new Error("No source rows were updated for source_page bulk correction.");
        }
        if (touchedTransactions === 0) {
          throw new Error("No normalized rows were updated for source_page bulk correction.");
        }
      } else {
        const updates = buildTransactionUpdates(activeField, normalizedBulkValue);
        let touchedTransactions = 0;

        if (sourceRowIds.length > 0) {
          const { data: txRows, error: bulkTxErr } = await supabase
            .from("royalty_transactions")
            .update(updates)
            .eq("report_id", task.report_id)
            .in("source_row_id", sourceRowIds)
            .select("id");
          if (bulkTxErr) throw new Error(`Bulk transaction update failed: ${bulkTxErr.message}`);
          touchedTransactions += txRows?.length ?? 0;
        }

        if (transactionIds.length > 0) {
          const { data: txRowsById, error: bulkTxByIdErr } = await supabase
            .from("royalty_transactions")
            .update(updates)
            .eq("report_id", task.report_id)
            .in("id", transactionIds)
            .select("id");
          if (bulkTxByIdErr) throw new Error(`Bulk transaction update by id failed: ${bulkTxByIdErr.message}`);
          touchedTransactions += txRowsById?.length ?? 0;
        }

        if (touchedTransactions === 0) {
          throw new Error(`No normalized rows were updated for field "${activeField}" bulk correction.`);
        }

        if (sourceRowIds.length > 0) {
          const fieldTargets = sourceFieldTargets(activeField);
          const { error: sourceFieldsErr } = await supabase
            .from("source_fields")
            .update({ normalized_value: normalizedBulkValue })
            .eq("report_id", task.report_id)
            .in("source_row_id", sourceRowIds)
            .in("field_name", fieldTargets);
          if (sourceFieldsErr) throw new Error(`Bulk source field update failed: ${sourceFieldsErr.message}`);
        }
      }

      const now = new Date().toISOString();
      let updatedCount = 0;

      for (const { candidate, payload, sourceRowId, transactionId } of resolvableTargets) {
        const errors = asErrors(payload);
        const remainingErrors = errors.filter((err) => !matchesErrorContext(err, activeField, activeErrorType));
        const nextError = remainingErrors.length > 0 ? remainingErrors[0] : null;
        const nextStatus = remainingErrors.length > 0 ? "in_progress" : "resolved";

        const nextPayload: JsonRecord = {
          ...payload,
          errors: remainingErrors,
          field: asString(nextError?.field) ?? activeField,
          actual: nextError?.actual ?? payload.actual ?? null,
          error_type: asString(nextError?.type) ?? activeErrorType,
          corrected_value: normalizedBulkValue,
          resolution_action: "correct",
          resolved_at: now,
          bulk_resolved: true,
        };

        const { error: candidateErr } = await supabase
          .from("review_tasks")
          .update({
            status: nextStatus,
            resolved_by: requesterId,
            resolved_at: nextStatus === "resolved" ? now : null,
            payload: nextPayload,
          })
          .eq("id", candidate.id);
        if (candidateErr) throw new Error(`Failed to update task ${candidate.id}: ${candidateErr.message}`);

        const validationStatus = deriveValidationStatus(remainingErrors);
        let txStatusQuery = supabase
          .from("royalty_transactions")
          .update({ validation_status: validationStatus })
          .eq("report_id", task.report_id);

        txStatusQuery = sourceRowId
          ? txStatusQuery.eq("source_row_id", sourceRowId)
          : txStatusQuery.eq("id", transactionId!);

        const { error: txStatusErr } = await txStatusQuery;
        if (txStatusErr) {
          throw new Error(`Failed to refresh transaction validation status: ${txStatusErr.message}`);
        }
        updatedCount += 1;
      }

      const gateState = await recomputeReportQualityGate(supabase, task.report_id);
      return new Response(
        JSON.stringify({
          bulk: true,
          message:
            skippedCount > 0
              ? `Applied ${activeField} correction to ${updatedCount} task(s); skipped ${skippedCount} task(s) with no row linkage.`
              : `Applied ${activeField} correction to ${updatedCount} task(s).`,
          tasks_updated: updatedCount,
          tasks_skipped: skippedCount,
          gate: gateState,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let updatedErrors = [...taskErrors];
    let nextStatus = action === "dismiss" ? "dismissed" : "resolved";

    if (action !== "dismiss" && updatedErrors.length > 0) {
      // Sequential resolution: always consume the currently active issue first.
      updatedErrors = updatedErrors.slice(1);
      if (updatedErrors.length > 0) nextStatus = "in_progress";
    }

    const sourceRowIdForTask = asString(task.source_row_id) ?? asString(taskPayload.source_row_id);
    const transactionIdForTask = extractTransactionId(taskPayload);

    if (action === "correct") {
      if (!activeField) throw new Error("corrected_field is required for correction.");
      if (correctedValue === null) throw new Error("corrected_value is required for correction.");

      const normalizedCorrectedValue = normalizeCorrectedValueForField(activeField, correctedValue);
      const sourceRowId = sourceRowIdForTask;
      const transactionId = transactionIdForTask;
      const rawValue = asString(taskPayload.actual) ?? asString(taskPayload.raw_value);

      if (!sourceRowId && !transactionId) {
        throw new Error(
          "Task is missing source_row_id/transaction_id, so normalized data could not be updated.",
        );
      }

      if (activeField === "source_page") {
        const sourcePage = parseSourcePage(normalizedCorrectedValue);
        let touchedSourceRows = 0;

        if (sourceRowId) {
          const { data: sourceRows, error: srcErr } = await supabase
            .from("source_rows")
            .update({ source_page: sourcePage })
            .eq("id", sourceRowId)
            .select("id");
          if (srcErr) throw new Error(`Failed to update source_page: ${srcErr.message}`);
          touchedSourceRows = sourceRows?.length ?? 0;
        }

        let txQuery = supabase
          .from("royalty_transactions")
          .update({ source_page: sourcePage })
          .eq("report_id", task.report_id);

        txQuery = sourceRowId ? txQuery.eq("source_row_id", sourceRowId) : txQuery.eq("id", transactionId);

        const { data: txRows, error: txPageErr } = await txQuery.select("id");
        if (txPageErr) throw new Error(`Failed to update transaction source_page: ${txPageErr.message}`);
        if ((txRows?.length ?? 0) === 0) {
          throw new Error("No normalized rows were updated for source_page correction.");
        }
        if (sourceRowId && touchedSourceRows === 0) {
          throw new Error("No source rows were updated for source_page correction.");
        }
      } else {
        const updates = buildTransactionUpdates(activeField, normalizedCorrectedValue);
        let txQuery = supabase
          .from("royalty_transactions")
          .update(updates)
          .eq("report_id", task.report_id);

        txQuery = sourceRowId ? txQuery.eq("source_row_id", sourceRowId) : txQuery.eq("id", transactionId);

        const { data: txRows, error: txError } = await txQuery.select("id");
        if (txError) throw new Error(`Failed to update transaction: ${txError.message}`);
        if ((txRows?.length ?? 0) === 0) {
          throw new Error(`No normalized rows were updated for field "${activeField}" correction.`);
        }

        if (sourceRowId) {
          const fieldTargets = sourceFieldTargets(activeField);
          const { error: sourceFieldErr } = await supabase
            .from("source_fields")
            .update({ normalized_value: normalizedCorrectedValue })
            .eq("report_id", task.report_id)
            .eq("source_row_id", sourceRowId)
            .in("field_name", fieldTargets);
          if (sourceFieldErr) throw new Error(`Failed to update source fields: ${sourceFieldErr.message}`);
        }
      }

      const mappedField = mapToTransactionField(activeField);
      const learnableFields = ["territory", "platform", "track_title", "artist_name"];
      if (learnableFields.includes(mappedField) && rawValue && normalizedCorrectedValue) {
        const { error: ruleErr } = await supabase.from("normalization_rules").upsert(
          {
            user_id: task.user_id,
            source_field: mappedField,
            source_value: rawValue.toLowerCase(),
            canonical_field: mappedField,
            canonical_value: normalizedCorrectedValue,
            scope: "tenant",
            confidence: 100,
            is_active: true,
          },
          {
            onConflict: "user_id,source_field,source_value",
          },
        );
        if (ruleErr) console.warn("[SmartLearning] Failed to auto-save rule:", ruleErr.message);
      }
    }

    if (action === "define_rule" && !rule) {
      throw new Error("rule payload is required for define_rule action.");
    }

    if (action === "define_rule" && rule) {
      const targetTable = asString(rule.target_table) ?? "normalization_rules";
      if (targetTable === "column_mappings") {
        const rawHeader = asString(rule.raw_header);
        const canonicalField = asString(rule.canonical_field);
        if (!rawHeader || !canonicalField) {
          throw new Error("raw_header and canonical_field are required for column_mappings.");
        }

        const { error: ruleErr } = await supabase.from("column_mappings").upsert(
          {
            user_id: task.user_id,
            raw_header: rawHeader,
            canonical_field: canonicalField,
            scope: "user",
            confidence: 100,
            is_active: true,
          },
          {
            onConflict: "user_id,raw_header",
          },
        );
        if (ruleErr) throw new Error(`Failed to create column mapping: ${ruleErr.message}`);

        const { data: matchedFields, error: matchedFieldsErr } = await supabase
          .from("source_fields")
          .select("source_row_id, normalized_value")
          .eq("report_id", task.report_id)
          .eq("field_name", rawHeader);
        if (matchedFieldsErr) throw new Error(`Failed to fetch source fields: ${matchedFieldsErr.message}`);

        if (matchedFields && matchedFields.length > 0) {
          const isCustom = canonicalField.startsWith("custom:");
          const customKey = isCustom ? canonicalField.split(":")[1] : null;

          const numericFields = [
            "quantity",
            "gross_revenue",
            "commission",
            "net_revenue",
            "amount_original",
            "amount_reporting",
            "exchange_rate",
          ];

          for (const field of matchedFields) {
            if (isCustom && customKey) {
              // Primary path: use the atomic RPC
              const { error: rpcErr } = await supabase.rpc('merge_custom_property', {
                p_report_id: task.report_id,
                p_source_row_id: field.source_row_id,
                p_key: customKey,
                p_value: field.normalized_value
              });

              if (rpcErr) {
                // Fallback: fetch-merge-write (safe, no exotic Supabase tricks)
                console.warn("[submit-review-resolution] RPC failed, using fetch-merge-write:", rpcErr.message);
                const { data: existing, error: fetchErr } = await supabase
                  .from("royalty_transactions")
                  .select("custom_properties")
                  .eq("report_id", task.report_id)
                  .eq("source_row_id", field.source_row_id)
                  .maybeSingle();

                if (fetchErr) throw new Error(`Failed to fetch transaction for merge: ${fetchErr.message}`);

                const merged = { ...(existing?.custom_properties as Record<string, any> || {}), [customKey]: field.normalized_value };
                const { error: writeErr } = await supabase
                  .from("royalty_transactions")
                  .update({ custom_properties: merged })
                  .eq("report_id", task.report_id)
                  .eq("source_row_id", field.source_row_id);

                if (writeErr) throw new Error(`Failed to write merged custom_properties: ${writeErr.message}`);
              }
            } else {
              const updates: JsonRecord = {};
              updates[canonicalField] = numericFields.includes(canonicalField)
                ? Number(field.normalized_value)
                : field.normalized_value;

              const { error: txUpdateErr } = await supabase
                .from("royalty_transactions")
                .update(updates)
                .eq("report_id", task.report_id)
                .eq("source_row_id", field.source_row_id);

              if (txUpdateErr) {
                throw new Error(`Failed to apply mapping to transaction rows: ${txUpdateErr.message}`);
              }
            }
          }

          // Mark source_fields as mapped
          const { error: sfUpdateErr } = await supabase
            .from("source_fields")
            .update({
              is_mapped: true,
              mapping_rule: canonicalField
            })
            .eq("report_id", task.report_id)
            .eq("field_name", rawHeader);

          if (sfUpdateErr) {
            console.error("[submit-review-resolution] Failed to update source_fields:", sfUpdateErr.message);
          }
        }
      } else {
        const scope = asString(rule.scope);
        const normalizedScope = scope && ["global", "tenant", "cmo"].includes(scope) ? scope : "tenant";
        const { error: ruleErr } = await supabase.from("normalization_rules").insert({
          user_id: task.user_id,
          cmo_name: asString(rule.cmo_name),
          source_format: asString(rule.source_format),
          source_field: asString(rule.source_field) ?? "",
          source_value: asString(rule.source_value) ?? "",
          canonical_field: asString(rule.canonical_field) ?? "",
          canonical_value: asString(rule.canonical_value) ?? "",
          scope: normalizedScope,
          confidence: Number(rule.confidence ?? 100),
          is_active: true,
          created_by: requesterId,
        });
        if (ruleErr) throw new Error(`Failed to create normalization rule: ${ruleErr.message}`);
      }
    }

    const nextError = updatedErrors.length > 0 ? updatedErrors[0] : null;
    const now = new Date().toISOString();
    const payload: JsonRecord = {
      ...taskPayload,
      errors: updatedErrors,
      field: asString(nextError?.field) ?? activeField,
      actual: nextError?.actual ?? taskPayload.actual ?? null,
      error_type: asString(nextError?.type) ?? activeErrorType,
      resolution_action: action,
      corrected_value:
        action === "correct" && correctedValue !== null && activeField
          ? normalizeCorrectedValueForField(activeField, correctedValue)
          : correctedValue,
      resolved_at: now,
    };

    const { data: updatedTask, error: updateErr } = await supabase
      .from("review_tasks")
      .update({
        status: nextStatus,
        resolution_note: resolutionNote,
        resolved_by: requesterId,
        resolved_at: nextStatus === "resolved" ? now : null,
        payload,
      })
      .eq("id", taskId)
      .select("*")
      .single();
    if (updateErr) throw new Error(`Failed to update review task: ${updateErr.message}`);

    if (sourceRowIdForTask || transactionIdForTask) {
      const validationStatus = deriveValidationStatus(updatedErrors);
      let txStatusQuery = supabase
        .from("royalty_transactions")
        .update({ validation_status: validationStatus })
        .eq("report_id", task.report_id);

      txStatusQuery = sourceRowIdForTask
        ? txStatusQuery.eq("source_row_id", sourceRowIdForTask)
        : txStatusQuery.eq("id", transactionIdForTask!);

      const { error: txStatusErr } = await txStatusQuery;
      if (txStatusErr) {
        throw new Error(`Failed to refresh transaction validation status: ${txStatusErr.message}`);
      }
    }

    const gateState = await recomputeReportQualityGate(supabase, task.report_id);

    return new Response(
      JSON.stringify({
        task: updatedTask,
        open_tasks_remaining: gateState.metrics.open_review_tasks,
        gate: gateState,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : null,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
