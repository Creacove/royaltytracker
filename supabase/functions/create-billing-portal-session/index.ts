import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

async function stripeCreatePortalSession(
  secretKey: string,
  customerId: string,
  returnUrl: string,
): Promise<{ id: string; url: string }> {
  const params = new URLSearchParams();
  params.set("customer", customerId);
  params.set("return_url", returnUrl);

  const response = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      (payload as Record<string, unknown>)?.error &&
      typeof (payload as Record<string, unknown>).error === "object"
        ? ((payload as { error?: { message?: string } }).error?.message ?? "Stripe portal session creation failed.")
        : "Stripe portal session creation failed.";
    throw new Error(message);
  }

  const id = asString((payload as Record<string, unknown>).id);
  const url = asString((payload as Record<string, unknown>).url);
  if (!id || !url) throw new Error("Stripe portal response missing id/url.");
  return { id, url };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const appOrigin = Deno.env.get("APP_ORIGIN") ?? "http://localhost:8080";
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !stripeSecretKey) {
      return jsonResponse({ error: "Missing required environment variables." }, 500);
    }

    const authorization = req.headers.get("authorization") ?? req.headers.get("Authorization");
    if (!authorization) return jsonResponse({ error: "Missing Authorization header." }, 401);

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user: callerUser },
      error: authError,
    } = await callerClient.auth.getUser();
    if (authError || !callerUser) {
      return jsonResponse({ error: authError?.message ?? "Invalid user token." }, 401);
    }

    const { data: stateData, error: stateError } = await callerClient.rpc("get_my_workspace_subscription_state");
    if (stateError) return jsonResponse({ error: `Unable to load workspace subscription state: ${stateError.message}` }, 400);

    const state = Array.isArray(stateData)
      ? ((stateData[0] ?? null) as Record<string, unknown> | null)
      : ((stateData ?? null) as Record<string, unknown> | null);

    const companyId = asString(state?.company_id);
    const canManageBilling = Boolean(state?.can_manage_billing);
    if (!companyId) return jsonResponse({ error: "No active company workspace found." }, 400);
    if (!canManageBilling) return jsonResponse({ error: "Only owner/admin can manage billing." }, 403);

    const body = await req.json().catch(() => ({}));
    const returnUrl = asString((body as Record<string, unknown>).return_url) ?? `${appOrigin}/workspace`;

    const { data: subscription, error: subscriptionError } = await serviceClient
      .from("workspace_subscriptions")
      .select("provider_customer_id")
      .eq("company_id", companyId)
      .maybeSingle();

    if (subscriptionError) {
      return jsonResponse({ error: `Failed to load subscription: ${subscriptionError.message}` }, 500);
    }

    const customerId = asString(subscription?.provider_customer_id);
    if (!customerId) {
      return jsonResponse({ error: "No Stripe customer found for this workspace." }, 400);
    }

    const session = await stripeCreatePortalSession(stripeSecretKey, customerId, returnUrl);
    return jsonResponse({
      portal_url: session.url,
      portal_session_id: session.id,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      500,
    );
  }
});
