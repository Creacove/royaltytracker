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
    const reportId = (body as { report_id?: string }).report_id;
    if (!reportId) throw new Error("report_id is required");

    const { data: report, error: reportErr } = await supabase
      .from("cmo_reports")
      .select("id,user_id,status,quality_gate_status,ingestion_file_id")
      .eq("id", reportId)
      .single();
    if (reportErr || !report) throw new Error(`Report not found: ${reportErr?.message ?? "missing"}`);

    if (requesterRole !== "service_role" && requesterId !== report.user_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (report.quality_gate_status !== "passed") {
      return new Response(
        JSON.stringify({
          error: "Quality gate did not pass. Resolve blockers before publishing.",
          quality_gate_status: report.quality_gate_status,
          status: report.status,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    await supabase
      .from("cmo_reports")
      .update({ status: "completed_passed" })
      .eq("id", reportId);

    if (report.ingestion_file_id) {
      await supabase
        .from("ingestion_files")
        .update({ ingestion_status: "published" })
        .eq("id", report.ingestion_file_id);
    }

    const { count } = await supabase
      .from("royalty_transactions")
      .select("*", { count: "exact", head: true })
      .eq("report_id", reportId);

    return new Response(
      JSON.stringify({
        status: "published",
        report_id: reportId,
        published_rows: count ?? 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
