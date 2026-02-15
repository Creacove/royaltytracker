import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
    const requesterId = claims?.sub ?? claims?.user_id ?? null;
    const requesterRole = claims?.role ?? null;

    const body = await req.json().catch(() => ({}));
    const taskId = (body as { task_id?: string }).task_id;
    const action = (body as { action?: "approve" | "correct" | "define_rule" | "dismiss" }).action ?? "approve";
    const resolutionNote = (body as { resolution_note?: string }).resolution_note ?? null;
    const correctedValue = (body as { corrected_value?: string }).corrected_value ?? null;
    const correctedField = (body as { corrected_field?: string }).corrected_field ?? null;
    const applyToReport = (body as { apply_to_report?: boolean }).apply_to_report ?? false;

    if (!taskId) throw new Error("task_id is required");

    const { data: task, error: taskErr } = await supabase
      .from("review_tasks")
      .select("*")
      .eq("id", taskId)
      .single();
    if (taskErr || !task) throw new Error(`Review task not found: ${taskErr?.message ?? "missing"}`);

    if (requesterRole !== "service_role" && requesterId !== task.user_id) {
      // ... auth check ...
    }

    // --- CALCULATE NEXT STATUS (Multi-issue aware) ---
    const errors = (task.payload as any)?.errors || [];
    const fieldToUpdate = correctedField || (task.payload as any)?.field;

    // --- BULK RESOLUTION LOGIC ---
    if (applyToReport && action === "correct") {
      console.log(`[BulkResolution] Applying ${fieldToUpdate}=${correctedValue} to all matching tasks in report ${task.report_id}`);

      // 1. Update source_rows if needed
      if (fieldToUpdate === "source_page") {
        await supabase
          .from("source_rows")
          .update({ source_page: Number(correctedValue) })
          .eq("report_id", task.report_id);
      } else {
        // 2. Update royalty_transactions
        const updates: any = {};
        const numericFields = ["quantity", "gross_revenue", "commission", "net_revenue", "amount_original", "amount_reporting", "exchange_rate"];
        if (numericFields.includes(fieldToUpdate)) {
          updates[fieldToUpdate] = Number(correctedValue);
        } else if (fieldToUpdate === "currency") {
          updates.currency_original = correctedValue;
          updates.currency_reporting = correctedValue;
        } else if (fieldToUpdate === "period") {
          try {
            const p = JSON.parse(correctedValue);
            updates.period_start = p.start;
            updates.period_end = p.end;
          } catch (e) { console.error("Bulk period parse failed", e); }
        } else {
          updates[fieldToUpdate] = correctedValue;
        }

        // We apply to ALL transactions in the report that have this field as an issue
        // For now, simpler: Update all transactions in the report if they are linked to an open task of this type
        const { error: bulkTxErr } = await supabase
          .from("royalty_transactions")
          .update(updates)
          .eq("report_id", task.report_id); // Simple global update for the report
        if (bulkTxErr) console.error("Bulk transaction update failed:", bulkTxErr);
      }

      // 3. Resolve all tasks of the SAME type/field in this report
      // We need to be careful with multi-issue tasks. 
      // For now, if a task has multiple errors, we surgically remove the specific field being bulk-corrected.
      const { data: sameTasks } = await supabase
        .from("review_tasks")
        .select("id, payload, status")
        .eq("report_id", task.report_id)
        .in("status", ["open", "in_progress"]);

      if (sameTasks) {
        for (const t of sameTasks) {
          const tPayload = t.payload as any;
          const tErrors = tPayload?.errors || [];
          const tField = tPayload?.field;
          const tType = tPayload?.error_type;

          // Match if main field matches or if it's in the sub-errors
          const hasError = tField === fieldToUpdate || tErrors.some((e: any) => e.field === fieldToUpdate);

          if (hasError) {
            const remainingErrors = tErrors.filter((e: any) => e.field !== fieldToUpdate);
            const isFullyResolved = remainingErrors.length === 0;
            const nextStatus = isFullyResolved ? "resolved" : "in_progress";

            // Shift context if needed
            const nextError = remainingErrors.length > 0 ? remainingErrors[0] : null;

            await supabase.from("review_tasks").update({
              status: nextStatus,
              resolved_by: requesterId,
              resolved_at: isFullyResolved ? new Date().toISOString() : null,
              payload: {
                ...tPayload,
                errors: remainingErrors,
                field: nextError ? nextError.field : tField,
                actual: nextError ? nextError.actual : tPayload.actual,
                error_type: nextError ? nextError.type : tPayload.error_type,
                bulk_resolved: true
              }
            }).eq("id", t.id);
          }
        }
      }

      return new Response(JSON.stringify({ bulk: true, message: `Report-wide update for ${fieldToUpdate} applied.` }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // --- SINGLE RESOLUTION LOGIC ---
    let nextStatus = action === "dismiss" ? "dismissed" : "resolved";
    let updatedErrors = [...errors];

    if (action === "correct" && errors.length > 1) {
      // Remove the specific error that was just resolved
      updatedErrors = errors.filter((e: any) => e.field !== fieldToUpdate);
      if (updatedErrors.length > 0) {
        nextStatus = "in_progress";
        console.log(`[PartialResolution] Task ${taskId} still has ${updatedErrors.length} errors. Status: in_progress`);
      }
    }

    // Prepare updated payload
    const nextError = updatedErrors.length > 0 ? updatedErrors[0] : null;
    const payload = {
      ...(task.payload ?? {}),
      errors: updatedErrors,
      // Shift context to the next error if we are still in progress
      field: nextError ? nextError.field : fieldToUpdate,
      actual: nextError ? nextError.actual : (task.payload as any).actual,
      error_type: nextError ? nextError.type : (task.payload as any).error_type,
      resolution_action: action,
      corrected_value: correctedValue,
      resolved_at: new Date().toISOString(),
    };

    // --- APPLY RESOLUTION ---
    const { data: updatedTask, error: updateErr } = await supabase
      .from("review_tasks")
      .update({
        status: nextStatus,
        resolution_note: resolutionNote,
        resolved_by: requesterId,
        resolved_at: nextStatus === "resolved" ? new Date().toISOString() : null,
        payload,
      })
      .eq("id", taskId)
      .select("*")
      .single();

    if (updateErr) {
      console.error("Task update failed:", updateErr);
      throw new Error(`Failed to update review task: ${updateErr.message}`);
    }

    // --- APPLY DATA CORRECTION ---
    if (action === "correct" && correctedValue !== null) {
      const fieldToUpdate = (task.payload as any)?.field;
      const sourceRowId = task.source_row_id ?? (task.payload as any)?.source_row_id;
      const rawValue = (task.payload as any)?.actual || (task.payload as any)?.raw_value;

      if (fieldToUpdate && sourceRowId) {
        if (fieldToUpdate === "source_page") {
          const { error: srcErr } = await supabase
            .from("source_rows")
            .update({ source_page: Number(correctedValue) })
            .eq("id", sourceRowId);
          if (srcErr) console.warn("Failed to update source_page:", srcErr);
        } else {
          const updates: any = {};
          const numericFields = ["quantity", "gross_revenue", "commission", "net_revenue", "amount_original", "amount_reporting", "exchange_rate"];

          if (numericFields.includes(fieldToUpdate)) {
            updates[fieldToUpdate] = Number(correctedValue);
          } else if (fieldToUpdate === "currency") {
            updates.currency_original = correctedValue;
            updates.currency_reporting = correctedValue;
          } else if (fieldToUpdate === "period") {
            try {
              const p = JSON.parse(correctedValue);
              updates.period_start = p.start;
              updates.period_end = p.end;
            } catch (e) {
              console.error("Failed to parse period correction:", e);
            }
          } else {
            updates[fieldToUpdate] = correctedValue;
          }

          const { error: txError } = await supabase
            .from("royalty_transactions")
            .update(updates)
            .eq("report_id", task.report_id)
            .eq("source_row_id", sourceRowId);

          if (txError) console.error("Failed to update transaction:", txError);

          // --- SMART LEARNING CORE: Auto-generate normalization rule ---
          // If the user corrected a field that supports learning, save it globally for them.
          const learnableFields = ["territory", "platform", "track_title", "artist_name", "track_artist"];
          if (learnableFields.includes(fieldToUpdate) && rawValue && correctedValue) {
            console.log(`[SmartLearning] Creating rule for ${fieldToUpdate}: ${rawValue} -> ${correctedValue}`);
            const { error: ruleErr } = await supabase.from("normalization_rules").upsert({
              user_id: task.user_id,
              source_field: fieldToUpdate,
              source_value: String(rawValue).trim().toLowerCase(),
              canonical_field: fieldToUpdate,
              canonical_value: correctedValue,
              scope: "user",
              confidence: 100,
              is_active: true,
            }, {
              onConflict: 'user_id,source_field,source_value'
            });
            if (ruleErr) console.warn("[SmartLearning] Failed to auto-save rule:", ruleErr);
          }
        }
      }
    }

    // --- RULE DEFINITION ---
    const rule = (body as { rule?: any }).rule;
    if (action === "define_rule" && rule) {
      const targetTable = rule.target_table ?? "normalization_rules";
      if (targetTable === "column_mappings") {
        const { error: ruleErr } = await supabase.from("column_mappings").insert({
          user_id: task.user_id,
          raw_header: String(rule.raw_header ?? "").trim(),
          canonical_field: String(rule.canonical_field ?? "").trim(),
          scope: "user",
          confidence: 100,
          is_active: true
        });
        if (ruleErr) throw new Error(`Failed to create column mapping: ${ruleErr.message}`);

        // --- REIFICATION: Update all transactions in this report that were waiting for this mapping ---
        console.log(`[Reification] Applying new mapping for "${rule.raw_header}" -> "${rule.canonical_field}" in report ${task.report_id}`);

        // 1. Find all source fields in this report that match the raw header
        const { data: matchedFields } = await supabase
          .from("source_fields")
          .select("source_row_id, normalized_value")
          .eq("report_id", task.report_id)
          .eq("field_name", rule.raw_header);

        if (matchedFields && matchedFields.length > 0) {
          // 2. Perform batched updates for the transactions
          // To keep it simple and safe for edge functions, we update one by one or in small chunks
          // but for the best UX, we want to update the transactions linked to these source rows.
          for (const field of matchedFields) {
            if (field.normalized_value === null) continue;

            const updates: any = {};
            const fieldName = rule.canonical_field;

            // Handle numeric casting if needed
            const numericFields = ["quantity", "gross_revenue", "commission", "net_revenue", "amount_original", "amount_reporting", "exchange_rate"];
            updates[fieldName] = numericFields.includes(fieldName) ? Number(field.normalized_value) : field.normalized_value;

            await supabase
              .from("royalty_transactions")
              .update(updates)
              .eq("report_id", task.report_id)
              .eq("source_row_id", field.source_row_id);
          }
          console.log(`[Reification] Updated ${matchedFields.length} transactions.`);
        }
      } else {
        const { error: ruleErr } = await supabase.from("normalization_rules").insert({
          user_id: task.user_id,
          cmo_name: rule.cmo_name ?? null,
          source_format: rule.source_format ?? null,
          source_field: String(rule.source_field ?? "").trim(),
          source_value: String(rule.source_value ?? "").trim(),
          canonical_field: String(rule.canonical_field ?? "").trim(),
          canonical_value: String(rule.canonical_value ?? "").trim(),
          scope: rule.scope ?? "tenant",
          confidence: Number(rule.confidence ?? 100),
          is_active: true,
          created_by: requesterId,
        });
        if (ruleErr) throw new Error(`Failed to create normalization rule: ${ruleErr.message}`);
      }
    }

    // --- CHECK COMPLETION ---
    const { count: openCount } = await supabase
      .from("review_tasks")
      .select("*", { count: "exact", head: true })
      .eq("report_id", task.report_id)
      .in("status", ["open", "in_progress"]);

    if ((openCount ?? 0) === 0) {
      await supabase
        .from("cmo_reports")
        .update({ status: "completed_with_warnings", quality_gate_status: "needs_review" })
        .eq("id", task.report_id)
        .eq("status", "needs_review");
    }

    return new Response(
      JSON.stringify({ task: updatedTask, open_tasks_remaining: openCount ?? 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Edge function error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : null
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
