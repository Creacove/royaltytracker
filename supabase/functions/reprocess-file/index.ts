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
    const jwt = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!authHeader || !jwt) throw new Error("Missing Authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey || !anonKey) throw new Error("Missing Supabase env.");

    const admin = createClient(supabaseUrl, serviceKey);
    const claims = parseJwtClaims(jwt);
    const requesterRole = claims?.role ?? null;
    let requesterId = claims?.sub ?? claims?.user_id ?? null;

    if (requesterRole !== "service_role") {
      const { data: authData, error: authErr } = await admin.auth.getUser(jwt);
      if (authErr || !authData?.user?.id) {
        return new Response(JSON.stringify({ error: "Invalid or expired access token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      requesterId = authData.user.id;
    }

    const body = await req.json().catch(() => ({}));
    let reportId = (body as { report_id?: string }).report_id ?? null;
    const ingestionFileId = (body as { ingestion_file_id?: string }).ingestion_file_id ?? null;

    if (!reportId && ingestionFileId) {
      const { data: ingestion, error } = await admin
        .from("ingestion_files")
        .select("report_id,user_id")
        .eq("id", ingestionFileId)
        .single();
      if (error || !ingestion) throw new Error(`Ingestion file not found: ${error?.message ?? "missing"}`);
      if (requesterRole !== "service_role" && requesterId !== ingestion.user_id) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      reportId = ingestion.report_id;
    }

    if (!reportId) throw new Error("report_id or ingestion_file_id is required");

    const invokeStage = async (fn: string) => {
      const resp = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ report_id: reportId, force_reprocess: true }),
      });
      const text = await resp.text();
      if (!resp.ok) {
        return { ok: false as const, status: resp.status, text };
      }
      return { ok: true as const, status: resp.status, text };
    };

    const extraction = await invokeStage("run-extraction");
    if (!extraction.ok) {
      return new Response(extraction.text, {
        status: extraction.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalization = await invokeStage("run-normalization");
    if (!normalization.ok) {
      return new Response(normalization.text, {
        status: normalization.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const validation = await invokeStage("run-validation");
    if (!validation.ok) {
      return new Response(validation.text, {
        status: validation.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        status: "reprocessed",
        report_id: reportId,
        extraction: extraction.text ? JSON.parse(extraction.text) : null,
        normalization: normalization.text ? JSON.parse(normalization.text) : null,
        validation: validation.text ? JSON.parse(validation.text) : null,
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
