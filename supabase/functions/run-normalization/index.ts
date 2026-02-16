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

    const [txCountRes, extractedCountRes] = await Promise.all([
      supabase
        .from("royalty_transactions")
        .select("*", { count: "exact", head: true })
        .eq("report_id", reportId),
      supabase
        .from("document_ai_report_items")
        .select("*", { count: "exact", head: true })
        .eq("report_id", reportId),
    ]);
    if (txCountRes.error) throw new Error(`Failed to count normalized rows: ${txCountRes.error.message}`);
    if (extractedCountRes.error) {
      throw new Error(`Failed to count extracted rows: ${extractedCountRes.error.message}`);
    }
    const txCount = txCountRes.count ?? 0;
    const extractedCount = extractedCountRes.count ?? 0;

    const noData = txCount === 0 && extractedCount === 0;

    if (report.ingestion_file_id) {
      const { error: ingestionUpdateErr } = await supabase
        .from("ingestion_files")
        .update({ ingestion_status: "normalized" })
        .eq("id", report.ingestion_file_id);
      if (ingestionUpdateErr) {
        throw new Error(`Failed to mark ingestion as normalized: ${ingestionUpdateErr.message}`);
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
      throw new Error(`Failed to update report normalization status: ${reportUpdateErr.message}`);
    }

    return new Response(
      JSON.stringify({
        stage: "normalization",
        status: "ok",
        report_id: reportId,
        normalized_rows: txCount,
        extracted_rows: extractedCount,
        no_data: noData,
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
