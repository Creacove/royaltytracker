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

function normalizePlanCode(value: unknown): "solo" | "team" | null {
  const raw = asString(value)?.toLowerCase();
  if (raw === "solo" || raw === "team") return raw;
  return null;
}

type StripeCheckoutSession = {
  id: string;
  url: string;
  customer?: string | null;
};

async function stripeCreateCheckoutSession(
  secretKey: string,
  params: URLSearchParams,
): Promise<StripeCheckoutSession> {
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
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
        ? ((payload as { error?: { message?: string } }).error?.message ?? "Stripe checkout creation failed.")
        : "Stripe checkout creation failed.";
    throw new Error(message);
  }

  const session = payload as Record<string, unknown>;
  const id = asString(session.id);
  const url = asString(session.url);
  const customer = asString(session.customer);
  if (!id || !url) throw new Error("Stripe checkout response missing id/url.");
  return { id, url, customer };
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

    const body = await req.json().catch(() => ({}));
    const planCode = normalizePlanCode((body as Record<string, unknown>).plan_code);
    const successUrl = asString((body as Record<string, unknown>).success_url) ?? `${appOrigin}/activate?checkout=success`;
    const cancelUrl = asString((body as Record<string, unknown>).cancel_url) ?? `${appOrigin}/activate?checkout=canceled`;

    if (!planCode) {
      return jsonResponse({ error: "plan_code must be 'solo' or 'team'." }, 400);
    }

    const { data: stateData, error: stateError } = await callerClient.rpc("get_my_workspace_subscription_state");
    if (stateError) return jsonResponse({ error: `Unable to load workspace subscription state: ${stateError.message}` }, 400);

    const state = Array.isArray(stateData)
      ? ((stateData[0] ?? null) as Record<string, unknown> | null)
      : ((stateData ?? null) as Record<string, unknown> | null);

    const companyId = asString(state?.company_id);
    const canManageBilling = Boolean(state?.can_manage_billing);
    if (!companyId) return jsonResponse({ error: "No active company workspace found." }, 400);
    if (!canManageBilling) return jsonResponse({ error: "Only owner/admin can activate billing." }, 403);

    const { data: plan, error: planError } = await serviceClient
      .from("billing_plans")
      .select("id, plan_code, stripe_price_id")
      .eq("plan_code", planCode)
      .eq("is_active", true)
      .single();
    if (planError || !plan) return jsonResponse({ error: `Plan not found: ${planError?.message ?? "missing"}` }, 400);
    if (!plan.stripe_price_id) {
      return jsonResponse({ error: `Stripe price is not configured for plan '${planCode}'.` }, 400);
    }

    const { data: existingSubscription } = await serviceClient
      .from("workspace_subscriptions")
      .select("status,provider_customer_id")
      .eq("company_id", companyId)
      .maybeSingle();

    const params = new URLSearchParams();
    params.set("mode", "subscription");
    params.set("success_url", successUrl);
    params.set("cancel_url", cancelUrl);
    params.set("line_items[0][price]", plan.stripe_price_id);
    params.set("line_items[0][quantity]", "1");
    params.set("allow_promotion_codes", "true");
    params.set("client_reference_id", companyId);
    params.set("metadata[company_id]", companyId);
    params.set("metadata[plan_code]", planCode);
    params.set("metadata[source]", "ordersounds");
    params.set("subscription_data[metadata][company_id]", companyId);
    params.set("subscription_data[metadata][plan_code]", planCode);
    params.set("subscription_data[metadata][source]", "ordersounds");

    if (existingSubscription?.provider_customer_id) {
      params.set("customer", existingSubscription.provider_customer_id);
    } else {
      params.set("customer_creation", "always");
    }

    const session = await stripeCreateCheckoutSession(stripeSecretKey, params);

    const persistedStatus =
      asString(existingSubscription?.status) &&
      ["inactive", "active_paid", "active_sponsored", "past_due", "canceled"].includes(existingSubscription.status)
        ? existingSubscription.status
        : "inactive";

    const { error: syncError } = await serviceClient.rpc("upsert_workspace_subscription_from_billing", {
      p_company_id: companyId,
      p_plan_code: planCode,
      p_status: persistedStatus,
      p_provider: "stripe",
      p_provider_customer_id: session.customer ?? existingSubscription?.provider_customer_id ?? null,
      p_provider_subscription_id: null,
      p_current_period_start: null,
      p_current_period_end: null,
      p_sponsor_expires_at: null,
      p_metadata: {
        pending_checkout_session_id: session.id,
        pending_checkout_plan_code: planCode,
        pending_checkout_started_at: new Date().toISOString(),
      },
    });

    if (syncError) {
      console.error("create-billing-checkout-session: failed to persist pending checkout metadata", syncError.message);
    }

    return jsonResponse({
      checkout_url: session.url,
      checkout_session_id: session.id,
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      500,
    );
  }
});
