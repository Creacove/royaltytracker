import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PIPELINE_VERSION = "v2";
const PARSER_VERSION = "v2";

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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function detectSourceFormat(fileName: string): "pdf" | "csv" | "xlsx" | "xls" | "unknown" {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".xls")) return "xls";
  return "unknown";
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
    const role = claims?.role ?? null;
    const requesterId = claims?.sub ?? claims?.user_id ?? null;
    let effectiveRequesterId = requesterId;

    if (role !== "service_role") {
      const { data: authData, error: authErr } = await supabase.auth.getUser(jwt);
      if (authErr || !authData?.user?.id) {
        return new Response(JSON.stringify({ error: "Invalid or expired access token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      effectiveRequesterId = authData.user.id;
    }

    const body = await req.json().catch(() => ({}));
    const reportId = (body as { report_id?: string }).report_id;
    const forceReprocess = Boolean((body as { force_reprocess?: boolean }).force_reprocess);
    if (!reportId) throw new Error("report_id is required");

    const { data: report, error: reportErr } = await supabase
      .from("cmo_reports")
      .select("id,user_id,company_id,file_name,file_path,file_size,cmo_name")
      .eq("id", reportId)
      .single();
    if (reportErr || !report) throw new Error(`Report not found: ${reportErr?.message ?? "missing"}`);

    if (role !== "service_role" && effectiveRequesterId !== report.user_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: fileData, error: fileErr } = await supabase.storage
      .from("cmo-reports")
      .download(report.file_path);
    if (fileErr || !fileData) throw new Error(`Failed to download file: ${fileErr?.message}`);
    const fileBytes = new Uint8Array(await fileData.arrayBuffer());
    const fileHash = await sha256Hex(fileBytes);
    const sourceFormat = detectSourceFormat(report.file_name);

    const { data: existing } = await supabase
      .from("ingestion_files")
      .select("id,report_id,file_hash_sha256")
      .eq("file_hash_sha256", fileHash)
      .eq("pipeline_version", PIPELINE_VERSION)
      .maybeSingle();

    if (existing && existing.report_id && existing.report_id !== reportId && !forceReprocess) {
      return new Response(
        JSON.stringify({
          status: "duplicate_blocked",
          duplicate_of_report_id: existing.report_id,
          ingestion_file_id: existing.id,
          file_hash_sha256: fileHash,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let ingestionFileId = existing?.id ?? null;
    if (!ingestionFileId) {
      const { data: inserted, error: insertErr } = await supabase
        .from("ingestion_files")
        .insert({
          company_id: report.company_id ?? null,
          user_id: report.user_id,
          report_id: reportId,
          storage_bucket: "cmo-reports",
          file_path: report.file_path,
          file_name: report.file_name,
          file_extension: report.file_name.split(".").pop() ?? null,
          file_hash_sha256: fileHash,
          file_size: report.file_size ?? null,
          source_format: sourceFormat,
          parser_version: PARSER_VERSION,
          pipeline_version: PIPELINE_VERSION,
          ingestion_status: "pending",
          metadata: { cmo_name: report.cmo_name },
        })
        .select("id")
        .single();
      if (insertErr || !inserted) throw new Error(`Failed to create ingestion file: ${insertErr?.message}`);
      ingestionFileId = inserted.id;
    } else {
      await supabase
        .from("ingestion_files")
        .update({
          company_id: report.company_id ?? null,
          report_id: reportId,
          file_path: report.file_path,
          file_name: report.file_name,
          file_size: report.file_size ?? null,
          source_format: sourceFormat,
          ingestion_status: "pending",
        })
        .eq("id", ingestionFileId);
    }

    await supabase
      .from("cmo_reports")
      .update({
        file_hash_sha256: fileHash,
        source_format: sourceFormat,
        pipeline_version: PIPELINE_VERSION,
        ingestion_file_id: ingestionFileId,
      })
      .eq("id", reportId);

    return new Response(
      JSON.stringify({
        ingestion_file_id: ingestionFileId,
        report_id: reportId,
        file_hash_sha256: fileHash,
        source_format: sourceFormat,
        pipeline_version: PIPELINE_VERSION,
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
