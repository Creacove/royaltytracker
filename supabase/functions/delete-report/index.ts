import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type JsonRecord = Record<string, unknown>;

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

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
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
        return new Response(JSON.stringify({ error: "Invalid or expired access token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      requesterId = authData.user.id;
    }

    const body = (await req.json().catch(() => ({}))) as JsonRecord;
    const reportId = asString(body.report_id);
    if (!reportId) throw new Error("report_id is required");

    const { data: report, error: reportErr } = await supabase
      .from("cmo_reports")
      .select("id, company_id, file_path")
      .eq("id", reportId)
      .maybeSingle();
    if (reportErr) throw new Error(`Failed to load report: ${reportErr.message}`);
    if (!report) throw new Error("Report not found");

    if (requesterRole !== "service_role") {
      if (!report.company_id) throw new Error("Report has no company scope");
      const { data: allowed, error: accessErr } = await supabase.rpc("can_access_company_data", {
        p_company_id: report.company_id,
        p_fallback_user_id: requesterId,
      });
      if (accessErr || !allowed) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { data: catalogClaims, error: catalogClaimsErr } = await supabase
      .from("catalog_claims")
      .select("id")
      .eq("source_report_id", reportId);
    if (catalogClaimsErr) throw new Error(`Failed to load catalog claims: ${catalogClaimsErr.message}`);
    const catalogClaimIds = (catalogClaims ?? []).map((claim: { id: string }) => claim.id);

    const { data: splitClaims, error: splitClaimsErr } = await supabase
      .from("catalog_split_claims")
      .select("id")
      .eq("source_report_id", reportId);
    if (splitClaimsErr) throw new Error(`Failed to load split claims: ${splitClaimsErr.message}`);
    const splitClaimIds = (splitClaims ?? []).map((claim: { id: string }) => claim.id);

    if (splitClaimIds.length > 0) {
      const { error } = await supabase.from("catalog_resolution_events").delete().in("entity_id", splitClaimIds);
      if (error) throw new Error(`Failed to delete split resolution events: ${error.message}`);
    }
    if (catalogClaimIds.length > 0) {
      const { error } = await supabase.from("catalog_rights_positions").delete().in("source_claim_id", catalogClaimIds);
      if (error) throw new Error(`Failed to delete rights positions: ${error.message}`);
    }

    const deleteSteps: Array<[string, string]> = [
      ["validation_errors", "report_id"],
      ["review_tasks", "report_id"],
      ["source_fields", "report_id"],
      ["royalty_transactions", "report_id"],
      ["catalog_split_claims", "source_report_id"],
      ["catalog_claims", "source_report_id"],
      ["document_ai_report_items", "report_id"],
      ["source_rows", "report_id"],
    ];

    for (const [table, column] of deleteSteps) {
      const { error } = await supabase.from(table).delete().eq(column, reportId);
      if (error) throw new Error(`Failed to delete ${table}: ${error.message}`);
    }

    const { error: reportDeleteErr } = await supabase.from("cmo_reports").delete().eq("id", reportId);
    if (reportDeleteErr) throw new Error(`Failed to delete report: ${reportDeleteErr.message}`);

    if (report.file_path) {
      const { error: storageErr } = await supabase.storage.from("cmo-reports").remove([report.file_path]);
      if (storageErr) console.warn(`[delete-report] Storage removal failed for ${report.file_path}: ${storageErr.message}`);
    }

    return new Response(JSON.stringify({ deleted: true, report_id: reportId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
