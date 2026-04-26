import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import {
  collectTrackMatchTasks,
  createTrackGroupKey,
  normalizeIsrc,
  type WorkspaceTrack,
} from "../_shared/report-track-matching.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FINAL_CATALOG_STATUSES = ["completed_passed", "completed_with_warnings", "needs_review"] as const;

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

function toWorkspaceTracks(rows: Array<{ track_title: string | null; artist_name: string | null; isrc: string | null }>): WorkspaceTrack[] {
  const grouped = new Map<string, WorkspaceTrack>();

  for (const row of rows) {
    const trackKey = createTrackGroupKey(row.isrc, row.track_title, row.artist_name);
    if (grouped.has(trackKey)) continue;
    grouped.set(trackKey, {
      track_key: trackKey,
      track_title: row.track_title,
      artist_name: row.artist_name,
      isrc: normalizeIsrc(row.isrc),
    });
  }

  return Array.from(grouped.values());
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
      .select("id,user_id,status")
      .eq("id", reportId)
      .single();
    if (reportErr || !report) throw new Error(`Report not found: ${reportErr?.message ?? "missing"}`);

    if (requesterRole !== "service_role" && requesterId !== report.user_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: reportRows, error: reportRowsErr } = await supabase
      .from("royalty_transactions")
      .select("id, source_row_id, track_title, artist_name, isrc")
      .eq("report_id", reportId);
    if (reportRowsErr) {
      throw new Error(`Failed to load report transactions: ${reportRowsErr.message}`);
    }

    const { data: existingTasks, error: existingTasksErr } = await supabase
      .from("review_tasks")
      .select("id, payload")
      .eq("report_id", reportId)
      .eq("task_type", "other");
    if (existingTasksErr) {
      throw new Error(`Failed to load existing review tasks: ${existingTasksErr.message}`);
    }

    const matchTaskIds = (existingTasks ?? [])
      .filter((task) => {
        const payload = task.payload;
        return typeof payload === "object" && payload !== null && !Array.isArray(payload)
          ? (payload as Record<string, unknown>).kind === "track_match"
          : false;
      })
      .map((task) => task.id);

    if (matchTaskIds.length > 0) {
      const { error: deleteErr } = await supabase
        .from("review_tasks")
        .delete()
        .in("id", matchTaskIds);
      if (deleteErr) throw new Error(`Failed to clear prior track match tasks: ${deleteErr.message}`);
    }

    if (!reportRows || reportRows.length === 0) {
      return new Response(
        JSON.stringify({
          stage: "track_matching",
          status: "no_rows",
          report_id: reportId,
          task_count: 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: catalogReports, error: catalogReportsErr } = await supabase
      .from("cmo_reports")
      .select("id")
      .eq("user_id", report.user_id)
      .neq("id", reportId)
      .in("status", [...FINAL_CATALOG_STATUSES]);
    if (catalogReportsErr) {
      throw new Error(`Failed to load completed reports for matching: ${catalogReportsErr.message}`);
    }

    const catalogReportIds = (catalogReports ?? []).map((row) => row.id);
    if (catalogReportIds.length === 0) {
      return new Response(
        JSON.stringify({
          stage: "track_matching",
          status: "no_candidates",
          report_id: reportId,
          task_count: 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: catalogRows, error: catalogRowsErr } = await supabase
      .from("royalty_transactions")
      .select("track_title, artist_name, isrc")
      .in("report_id", catalogReportIds);
    if (catalogRowsErr) {
      throw new Error(`Failed to load workspace tracks for matching: ${catalogRowsErr.message}`);
    }

    const workspaceTracks = toWorkspaceTracks(catalogRows ?? []);
    const matchTasks = collectTrackMatchTasks(reportRows, workspaceTracks);

    if (matchTasks.length > 0) {
      const inserts = matchTasks.map((task) => ({
        report_id: reportId,
        user_id: report.user_id,
        source_row_id: task.source_row_ids[0] ?? null,
        source_field_id: null,
        task_type: "other",
        severity: "info",
        status: "open",
        reason: `Possible track match for ${task.track_title} by ${task.artist_name}`,
        payload: {
          kind: "track_match",
          group_key: task.group_key,
          track_title: task.track_title,
          artist_name: task.artist_name,
          isrc: task.isrc,
          transaction_ids: task.transaction_ids,
          source_row_ids: task.source_row_ids,
          candidates: task.candidates,
        },
      }));

      const { error: insertErr } = await supabase.from("review_tasks").insert(inserts);
      if (insertErr) throw new Error(`Failed to create track match tasks: ${insertErr.message}`);

      const { error: reportUpdateErr } = await supabase
        .from("cmo_reports")
        .update({ status: "processing" })
        .eq("id", reportId);
      if (reportUpdateErr) throw new Error(`Failed to keep report in processing: ${reportUpdateErr.message}`);
    }

    return new Response(
      JSON.stringify({
        stage: "track_matching",
        status: matchTasks.length > 0 ? "needs_input" : "no_candidates",
        report_id: reportId,
        task_count: matchTasks.length,
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
      },
    );
  }
});
