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
    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jwt = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!jwt) throw new Error("Invalid Authorization header");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase env.");
    const supabase = createClient(supabaseUrl, serviceKey);
    const claims = parseJwtClaims(jwt);
    const requesterRole = claims?.role ?? null;
    let requesterId = claims?.sub ?? claims?.user_id ?? null;

    if (requesterRole !== "service_role") {
      const { data: authData, error: authErr } = await supabase.auth.getUser(jwt);
      if (authErr || !authData?.user?.id) {
        return new Response(JSON.stringify({ error: "Invalid or expired access token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      requesterId = authData.user.id;
    }

    const body = await req.json().catch(() => ({}));
    const reportId = (body as { report_id?: string }).report_id;
    if (!reportId) throw new Error("report_id is required");

    const { data: report, error: reportErr } = await supabase
      .from("cmo_reports")
      .select("id,user_id,ingestion_file_id")
      .eq("id", reportId)
      .single();
    if (reportErr || !report) throw new Error(`Report not found: ${reportErr?.message ?? "missing"}`);

    if (requesterRole !== "service_role" && requesterId !== report.user_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
        processed_at: new Date().toISOString(),
        transaction_count: txCount,
        error_count: validationErrorCount,
      })
      .eq("id", reportId);
    if (reportUpdateErr) {
      throw new Error(`Failed to update report validation status: ${reportUpdateErr.message}`);
    }

    if (report.ingestion_file_id) {
      const { error: ingestionUpdateErr } = await supabase
        .from("ingestion_files")
        .update({ ingestion_status: ingestionStatus })
        .eq("id", report.ingestion_file_id);
      if (ingestionUpdateErr) {
        throw new Error(`Failed to update ingestion validation status: ${ingestionUpdateErr.message}`);
      }
    }

    const { data: usageData, error: usageError } = await supabase.rpc("record_workspace_usage_from_report", {
      p_report_id: reportId,
    });
    const usageWarning = usageError ? `Failed to record workspace usage: ${usageError.message}` : null;

    return new Response(
      JSON.stringify({
        stage: "validation",
        status: "ok",
        report_id: reportId,
        quality_gate_status: qualityGateStatus,
        report_status: reportStatus,
        ingestion_status: ingestionStatus,
        usage: usageData ?? [],
        usage_warning: usageWarning,
        metrics: {
          transactions: txCount,
          failed_transactions: failedTxCount,
          open_review_tasks: openTaskCount,
          open_critical_review_tasks: openCriticalTaskCount,
          validation_errors: validationErrorCount,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
