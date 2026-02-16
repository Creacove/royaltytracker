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
    const forceReprocess = Boolean((body as { force_reprocess?: boolean }).force_reprocess);
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

    const createIngestion = async (force: boolean) =>
      fetch(`${supabaseUrl}/functions/v1/create-ingestion-file`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ report_id: reportId, force_reprocess: force }),
      });

    let ingestionResp = await createIngestion(forceReprocess);
    let ingestionText = await ingestionResp.text();
    if (!ingestionResp.ok && ingestionResp.status === 409) {
      let duplicatePayload: { status?: string } | null = null;
      try {
        duplicatePayload = ingestionText ? JSON.parse(ingestionText) : null;
      } catch {
        duplicatePayload = null;
      }

      if (duplicatePayload?.status === "duplicate_blocked") {
        ingestionResp = await createIngestion(true);
        ingestionText = await ingestionResp.text();
      }
    }

    if (!ingestionResp.ok) {
      return new Response(ingestionText, {
        status: ingestionResp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ingestionPayload = ingestionText ? JSON.parse(ingestionText) : {};
    const ingestionFileId =
      (ingestionPayload?.ingestion_file_id as string | undefined) ?? report.ingestion_file_id ?? null;

    const processResp = await fetch(`${supabaseUrl}/functions/v1/process-report`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ report_id: reportId, force_reprocess: forceReprocess }),
    });

    const processText = await processResp.text();
    if (!processResp.ok) {
      return new Response(processText, {
        status: processResp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (ingestionFileId) {
      const { error: ingestionUpdateErr } = await supabase
        .from("ingestion_files")
        .update({ ingestion_status: "extracted" })
        .eq("id", ingestionFileId);
      if (ingestionUpdateErr) {
        throw new Error(`Failed to mark ingestion as extracted: ${ingestionUpdateErr.message}`);
      }
    }

    const { error: reportUpdateErr } = await supabase
      .from("cmo_reports")
      .update({
        status: "processing",
        quality_gate_status: "needs_review",
      })
      .eq("id", reportId);
    if (reportUpdateErr) {
      throw new Error(`Failed to update report extraction status: ${reportUpdateErr.message}`);
    }

    const processPayload = processText ? JSON.parse(processText) : {};
    return new Response(
      JSON.stringify({
        stage: "extraction",
        status: "ok",
        report_id: reportId,
        ingestion_file_id: ingestionFileId,
        extraction: processPayload,
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
