import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseStripeSignature(value: string): { timestamp: string; signatures: string[] } | null {
  const parts = value.split(",").map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith("t="));
  if (!timestampPart) return null;
  const timestamp = timestampPart.slice(2);
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3))
    .filter((part) => part.length > 0);
  if (!timestamp || signatures.length === 0) return null;
  return { timestamp, signatures };
}

async function verifyStripeSignature({
  payload,
  signatureHeader,
  webhookSecret,
}: {
  payload: string;
  signatureHeader: string;
  webhookSecret: string;
}): Promise<boolean> {
  const parsed = parseStripeSignature(signatureHeader);
  if (!parsed) return false;

  const timestampSeconds = Number(parsed.timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > 5 * 60) return false;

  const signedPayload = `${parsed.timestamp}.${payload}`;
  const digest = await hmacHex(webhookSecret, signedPayload);
  return parsed.signatures.some((sig) => timingSafeEqual(sig, digest));
}

function mapStripeSubscriptionStatus(status: string | null): "inactive" | "active_paid" | "past_due" | "canceled" {
  if (!status) return "inactive";
  if (status === "active" || status === "trialing") return "active_paid";
  if (status === "past_due" || status === "unpaid" || status === "incomplete" || status === "incomplete_expired") {
    return "past_due";
  }
  if (status === "canceled") return "canceled";
  return "inactive";
}

type StripeEvent = {
  id?: string;
  type?: string;
  data?: {
    object?: Record<string, unknown>;
  };
};

async function lookupCompanyIdFromSubscription(
  supabase: ReturnType<typeof createClient>,
  providerSubscriptionId: string | null,
  providerCustomerId: string | null,
): Promise<string | null> {
  if (providerSubscriptionId) {
    const { data: bySub } = await supabase
      .from("workspace_subscriptions")
      .select("company_id")
      .eq("provider_subscription_id", providerSubscriptionId)
      .maybeSingle();
    const companyId = asString(bySub?.company_id);
    if (companyId) return companyId;
  }

  if (providerCustomerId) {
    const { data: byCustomer } = await supabase
      .from("workspace_subscriptions")
      .select("company_id")
      .eq("provider_customer_id", providerCustomerId)
      .maybeSingle();
    const companyId = asString(byCustomer?.company_id);
    if (companyId) return companyId;
  }

  return null;
}

async function lookupPlanCodeFromPriceId(
  supabase: ReturnType<typeof createClient>,
  priceId: string | null,
): Promise<string | null> {
  if (!priceId) return null;
  const { data } = await supabase
    .from("billing_plans")
    .select("plan_code")
    .eq("stripe_price_id", priceId)
    .maybeSingle();
  return asString(data?.plan_code);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeWebhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !stripeWebhookSecret) {
    return jsonResponse({ error: "Missing required environment variables." }, 500);
  }

  const signatureHeader = req.headers.get("stripe-signature") ?? req.headers.get("Stripe-Signature");
  if (!signatureHeader) return jsonResponse({ error: "Missing Stripe signature header." }, 400);

  const payloadText = await req.text();
  const signatureValid = await verifyStripeSignature({
    payload: payloadText,
    signatureHeader,
    webhookSecret: stripeWebhookSecret,
  });
  if (!signatureValid) return jsonResponse({ error: "Invalid Stripe signature." }, 400);

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const event = JSON.parse(payloadText) as StripeEvent;
    const eventId = asString(event.id);
    const eventType = asString(event.type);
    if (!eventId || !eventType) return jsonResponse({ error: "Invalid Stripe event payload." }, 400);

    const { error: insertEventError } = await supabase.from("billing_events").insert({
      provider: "stripe",
      provider_event_id: eventId,
      event_type: eventType,
      event_payload: event as unknown as Record<string, unknown>,
      status: "ignored",
      processed_at: new Date().toISOString(),
    });

    if (insertEventError) {
      if ((insertEventError as { code?: string }).code === "23505") {
        return jsonResponse({ received: true, duplicate: true });
      }
      return jsonResponse({ error: `Failed to persist billing event: ${insertEventError.message}` }, 500);
    }

    let finalStatus: "processed" | "ignored" | "failed" = "ignored";
    let finalErrorMessage: string | null = null;

    try {
      const object = (event.data?.object ?? {}) as Record<string, unknown>;

      if (eventType.startsWith("customer.subscription.")) {
        const subscriptionId = asString(object.id);
        const customerId = asString(object.customer);
        const stripeStatus = asString(object.status);
        const metadata =
          object.metadata && typeof object.metadata === "object" && !Array.isArray(object.metadata)
            ? (object.metadata as Record<string, unknown>)
            : {};
        const metadataCompanyId = asString(metadata.company_id);
        const priceId =
          object.items && typeof object.items === "object" && !Array.isArray(object.items)
            ? asString(
                (
                  ((object.items as Record<string, unknown>).data as Array<Record<string, unknown>> | undefined)?.[0]
                    ?.price as Record<string, unknown> | undefined
                )?.id,
              )
            : null;
        const planCode = await lookupPlanCodeFromPriceId(supabase, priceId);
        const companyId =
          metadataCompanyId ?? (await lookupCompanyIdFromSubscription(supabase, subscriptionId, customerId));

        if (companyId) {
          const periodStartUnix = Number(object.current_period_start);
          const periodEndUnix = Number(object.current_period_end);
          const currentPeriodStart = Number.isFinite(periodStartUnix)
            ? new Date(periodStartUnix * 1000).toISOString()
            : null;
          const currentPeriodEnd = Number.isFinite(periodEndUnix)
            ? new Date(periodEndUnix * 1000).toISOString()
            : null;

          const { error: syncError } = await supabase.rpc("upsert_workspace_subscription_from_billing", {
            p_company_id: companyId,
            p_plan_code: planCode,
            p_status: mapStripeSubscriptionStatus(stripeStatus),
            p_provider: "stripe",
            p_provider_customer_id: customerId,
            p_provider_subscription_id: subscriptionId,
            p_current_period_start: currentPeriodStart,
            p_current_period_end: currentPeriodEnd,
            p_sponsor_expires_at: null,
            p_metadata: {
              stripe_status: stripeStatus,
              stripe_event_type: eventType,
              stripe_event_id: eventId,
            },
          });
          if (syncError) throw new Error(syncError.message);

          finalStatus = "processed";
        } else {
          finalStatus = "ignored";
        }
      } else if (eventType === "invoice.payment_failed" || eventType === "invoice.paid") {
        const subscriptionId = asString(object.subscription);
        const customerId = asString(object.customer);
        const companyId = await lookupCompanyIdFromSubscription(supabase, subscriptionId, customerId);

        if (companyId) {
          const nextStatus = eventType === "invoice.payment_failed" ? "past_due" : "active_paid";
          const { error: syncError } = await supabase.rpc("upsert_workspace_subscription_from_billing", {
            p_company_id: companyId,
            p_plan_code: null,
            p_status: nextStatus,
            p_provider: "stripe",
            p_provider_customer_id: customerId,
            p_provider_subscription_id: subscriptionId,
            p_current_period_start: null,
            p_current_period_end: null,
            p_sponsor_expires_at: null,
            p_metadata: {
              stripe_event_type: eventType,
              stripe_event_id: eventId,
            },
          });
          if (syncError) throw new Error(syncError.message);

          finalStatus = "processed";
        } else {
          finalStatus = "ignored";
        }
      } else {
        finalStatus = "ignored";
      }
    } catch (processError) {
      finalStatus = "failed";
      finalErrorMessage = processError instanceof Error ? processError.message : "Unknown processing error";
    }

    const { error: updateEventError } = await supabase
      .from("billing_events")
      .update({
        status: finalStatus,
        error_message: finalErrorMessage,
        processed_at: new Date().toISOString(),
      })
      .eq("provider", "stripe")
      .eq("provider_event_id", eventId);

    if (updateEventError) {
      return jsonResponse({ error: `Failed to update billing event status: ${updateEventError.message}` }, 500);
    }

    if (finalStatus === "failed") {
      return jsonResponse({ error: finalErrorMessage ?? "Stripe event processing failed." }, 500);
    }

    return jsonResponse({ received: true, status: finalStatus });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      500,
    );
  }
});
