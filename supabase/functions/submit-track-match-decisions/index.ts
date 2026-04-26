import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { normalizeIsrc } from "../_shared/report-track-matching.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type TrackMatchCandidate = {
  track_key: string;
  track_title: string;
  artist_name: string;
  isrc: string | null;
};

type TrackMatchPayload = {
  kind: "track_match";
  group_key: string;
  track_title: string;
  artist_name: string;
  isrc: string | null;
  transaction_ids: string[];
  source_row_ids: string[];
  candidates: TrackMatchCandidate[];
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

function readTrackMatchPayload(value: unknown): TrackMatchPayload | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (payload.kind !== "track_match") return null;
  return {
    kind: "track_match",
    group_key: String(payload.group_key ?? ""),
    track_title: String(payload.track_title ?? "Unknown Track"),
    artist_name: String(payload.artist_name ?? "Unknown Artist"),
    isrc: normalizeIsrc(payload.isrc as string | null | undefined),
    transaction_ids: Array.isArray(payload.transaction_ids) ? payload.transaction_ids.map(String) : [],
    source_row_ids: Array.isArray(payload.source_row_ids) ? payload.source_row_ids.map(String) : [],
    candidates: Array.isArray(payload.candidates)
      ? payload.candidates
          .filter((candidate) => typeof candidate === "object" && candidate !== null && !Array.isArray(candidate))
          .map((candidate) => {
            const item = candidate as Record<string, unknown>;
            return {
              track_key: String(item.track_key ?? ""),
              track_title: String(item.track_title ?? "Unknown Track"),
              artist_name: String(item.artist_name ?? "Unknown Artist"),
              isrc: normalizeIsrc(item.isrc as string | null | undefined),
            };
          })
      : [],
  };
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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey || !anonKey) throw new Error("Missing Supabase env.");

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
    const decisions = Array.isArray((body as { decisions?: unknown[] }).decisions)
      ? ((body as { decisions: Array<{ task_id?: string; candidate_track_key?: string | null }> }).decisions)
      : [];
    if (!reportId) throw new Error("report_id is required");

    const { data: report, error: reportErr } = await supabase
      .from("cmo_reports")
      .select("id,user_id")
      .eq("id", reportId)
      .single();
    if (reportErr || !report) throw new Error(`Report not found: ${reportErr?.message ?? "missing"}`);

    if (requesterRole !== "service_role" && requesterId !== report.user_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: rawTasks, error: tasksErr } = await supabase
      .from("review_tasks")
      .select("id, payload, status")
      .eq("report_id", reportId)
      .eq("task_type", "other")
      .in("status", ["open", "in_progress"]);
    if (tasksErr) throw new Error(`Failed to load track match tasks: ${tasksErr.message}`);

    const trackMatchTasks = (rawTasks ?? [])
      .map((task) => ({ ...task, parsed: readTrackMatchPayload(task.payload) }))
      .filter((task): task is typeof task & { parsed: TrackMatchPayload } => Boolean(task.parsed));

    if (trackMatchTasks.length === 0) {
      return new Response(
        JSON.stringify({
          stage: "track_matching",
          status: "no_open_tasks",
          report_id: reportId,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const decisionMap = new Map<string, string | null>();
    for (const decision of decisions) {
      if (!decision?.task_id) continue;
      decisionMap.set(String(decision.task_id), decision.candidate_track_key ? String(decision.candidate_track_key) : null);
    }

    for (const task of trackMatchTasks) {
      if (!decisionMap.has(task.id)) {
        throw new Error("A decision is required for every open track match task.");
      }
    }

    const acceptedIds = trackMatchTasks.flatMap((task) => {
      const selectedTrackKey = decisionMap.get(task.id);
      if (!selectedTrackKey) return [];
      return task.parsed.transaction_ids;
    });

    const txLookup = new Map<string, { id: string; isrc: string | null }>();
    if (acceptedIds.length > 0) {
      const { data: currentRows, error: currentRowsErr } = await supabase
        .from("royalty_transactions")
        .select("id, isrc")
        .in("id", acceptedIds);
      if (currentRowsErr) throw new Error(`Failed to load transactions for match application: ${currentRowsErr.message}`);
      for (const row of currentRows ?? []) {
        txLookup.set(row.id, { id: row.id, isrc: normalizeIsrc(row.isrc) });
      }
    }

    const resolvedAt = new Date().toISOString();

    for (const task of trackMatchTasks) {
      const selectedTrackKey = decisionMap.get(task.id) ?? null;
      const selectedCandidate = selectedTrackKey
        ? task.parsed.candidates.find((candidate) => candidate.track_key === selectedTrackKey) ?? null
        : null;

      if (selectedTrackKey && !selectedCandidate) {
        throw new Error(`Selected candidate ${selectedTrackKey} is not valid for task ${task.id}.`);
      }

      if (selectedCandidate) {
        const { error: updateErr } = await supabase
          .from("royalty_transactions")
          .update({
            track_title: selectedCandidate.track_title,
            artist_name: selectedCandidate.artist_name,
          })
          .in("id", task.parsed.transaction_ids);
        if (updateErr) throw new Error(`Failed to apply track title/artist match: ${updateErr.message}`);

        if (selectedCandidate.isrc) {
          const idsMissingIsrc = task.parsed.transaction_ids.filter((id) => {
            const tx = txLookup.get(id);
            return tx ? !tx.isrc : false;
          });
          if (idsMissingIsrc.length > 0) {
            const { error: isrcUpdateErr } = await supabase
              .from("royalty_transactions")
              .update({ isrc: selectedCandidate.isrc })
              .in("id", idsMissingIsrc);
            if (isrcUpdateErr) throw new Error(`Failed to apply matched ISRC: ${isrcUpdateErr.message}`);
          }
        }
      }

      const { error: taskUpdateErr } = await supabase
        .from("review_tasks")
        .update({
          status: "resolved",
          resolved_by: requesterId,
          resolved_at: resolvedAt,
          payload: {
            ...task.parsed,
            resolution: selectedCandidate
              ? {
                  candidate_track_key: selectedCandidate.track_key,
                  track_title: selectedCandidate.track_title,
                  artist_name: selectedCandidate.artist_name,
                  isrc: selectedCandidate.isrc,
                }
              : {
                  candidate_track_key: null,
                },
          },
        })
        .eq("id", task.id);
      if (taskUpdateErr) throw new Error(`Failed to resolve track match task: ${taskUpdateErr.message}`);
    }

    const { error: reportUpdateErr } = await supabase
      .from("cmo_reports")
      .update({ status: "processing" })
      .eq("id", reportId);
    if (reportUpdateErr) throw new Error(`Failed to keep report in processing before validation: ${reportUpdateErr.message}`);

    const validationResp = await fetch(`${supabaseUrl}/functions/v1/run-validation`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ report_id: reportId }),
    });

    const validationText = await validationResp.text();
    if (!validationResp.ok) {
      return new Response(validationText, {
        status: validationResp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        stage: "track_matching",
        status: "ok",
        report_id: reportId,
        decisions_applied: trackMatchTasks.length,
        validation: validationText ? JSON.parse(validationText) : null,
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
