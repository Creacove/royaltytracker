import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type AccessRequestPayload = {
  fullName: string;
  email: string;
  companyName?: string | null;
  message?: string | null;
  website?: string | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asString(value: unknown, maxLen = 500): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function normalizeEmail(value: unknown): string | null {
  const raw = asString(value, 320)?.toLowerCase() ?? null;
  if (!raw) return null;
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(raw) ? raw : null;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function sendNotificationEmail(
  payload: AccessRequestPayload,
  requestId: string,
): Promise<{ status: "sent" | "not_configured" | "failed"; error?: string }> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    return { status: "not_configured" };
  }

  const toEmail = Deno.env.get("ACCESS_REQUEST_TO_EMAIL") ?? "ordersoundsapp@gmail.com";
  const fromEmail = Deno.env.get("ACCESS_REQUEST_FROM_EMAIL") ?? "OrderSounds <onboarding@ordersounds.app>";

  const subject = `New OrderSounds access request: ${payload.fullName}`;
  const safeName = escapeHtml(payload.fullName);
  const safeEmail = escapeHtml(payload.email);
  const safeCompany = escapeHtml(payload.companyName ?? "-");
  const safeMessage = escapeHtml(payload.message ?? "-");

  const html = `
    <h2>New Access Request</h2>
    <p><strong>Request ID:</strong> ${escapeHtml(requestId)}</p>
    <p><strong>Name:</strong> ${safeName}</p>
    <p><strong>Email:</strong> ${safeEmail}</p>
    <p><strong>Company:</strong> ${safeCompany}</p>
    <p><strong>Message:</strong></p>
    <pre style="white-space: pre-wrap; font-family: Arial, sans-serif;">${safeMessage}</pre>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      subject,
      html,
      reply_to: payload.email,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "Unknown email error");
    return { status: "failed", error: text };
  }

  return { status: "sent" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Missing Supabase environment variables." }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const fullName = asString((body as Record<string, unknown>).fullName, 120);
    const email = normalizeEmail((body as Record<string, unknown>).email);
    const companyName = asString((body as Record<string, unknown>).companyName, 160);
    const message = asString((body as Record<string, unknown>).message, 2000);
    const website = asString((body as Record<string, unknown>).website, 200);

    // Honeypot for basic bot filtering. Return generic success to avoid probing.
    if (website) {
      return jsonResponse({ ok: true });
    }

    if (!fullName) return jsonResponse({ error: "Full name is required." }, 400);
    if (!email) return jsonResponse({ error: "Valid email is required." }, 400);

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const metadata = {
      ip: req.headers.get("x-forwarded-for"),
      user_agent: req.headers.get("user-agent"),
      origin: req.headers.get("origin"),
    };

    const { data: created, error: insertError } = await serviceClient
      .from("access_requests")
      .insert({
        full_name: fullName,
        email,
        company_name: companyName,
        message,
        source: "auth_page",
        metadata,
      })
      .select("id")
      .single();

    if (insertError || !created) {
      return jsonResponse({ error: insertError?.message ?? "Unable to record access request." }, 500);
    }

    const emailResult = await sendNotificationEmail({ fullName, email, companyName, message }, created.id);
    if (emailResult.status === "failed") {
      console.error("request-access email failed", emailResult.error ?? "Unknown error");
    }

    return jsonResponse({
      ok: true,
      request_id: created.id,
      email_status: emailResult.status,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
