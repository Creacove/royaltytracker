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

function normalizeEmail(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  return raw.toLowerCase();
}

function normalizeRole(value: unknown): "owner" | "admin" | "member" | "viewer" {
  const raw = asString(value)?.toLowerCase();
  if (raw === "owner" || raw === "admin" || raw === "member" || raw === "viewer") {
    return raw;
  }
  return "member";
}

function normalizeExpiresInDays(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(60, Math.max(1, Math.trunc(value)));
  }
  return 14;
}

function isInviteManager(state: Record<string, unknown> | null): boolean {
  if (!state) return false;
  const isPlatformAdmin = Boolean(state.is_platform_admin);
  const role = typeof state.active_membership_role === "string" ? state.active_membership_role : null;
  return isPlatformAdmin || role === "owner" || role === "admin";
}

function inferAuthStatus(message: string): "invited" | "already_exists" | "failed" {
  const normalized = message.toLowerCase();
  if (normalized.includes("already") || normalized.includes("exists") || normalized.includes("registered")) {
    return "already_exists";
  }
  return "failed";
}

function extractActionLink(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  if (typeof root.action_link === "string" && root.action_link.length > 0) {
    return root.action_link;
  }

  const props = root.properties;
  if (!props || typeof props !== "object") return null;
  const properties = props as Record<string, unknown>;
  if (typeof properties.action_link === "string" && properties.action_link.length > 0) {
    return properties.action_link;
  }
  return null;
}

async function generateReusableInviteLink(
  serviceClient: ReturnType<typeof createClient>,
  email: string,
  redirectTo: string | null,
  preferMagicLink: boolean,
): Promise<{ link: string | null; errorMessage: string | null }> {
  const requestedType = preferMagicLink ? "magiclink" : "invite";
  const fallbackType = preferMagicLink ? "invite" : "magiclink";

  const firstAttempt = await serviceClient.auth.admin.generateLink({
    type: requestedType,
    email,
    options: redirectTo ? { redirectTo } : undefined,
  });

  const firstLink = extractActionLink(firstAttempt.data);
  if (firstLink) {
    return { link: firstLink, errorMessage: null };
  }

  const secondAttempt = await serviceClient.auth.admin.generateLink({
    type: fallbackType,
    email,
    options: redirectTo ? { redirectTo } : undefined,
  });
  const secondLink = extractActionLink(secondAttempt.data);
  if (secondLink) {
    return { link: secondLink, errorMessage: null };
  }

  const combinedError = [firstAttempt.error?.message, secondAttempt.error?.message].filter(Boolean).join(" | ");
  return {
    link: null,
    errorMessage: combinedError || "Failed to generate reusable invite link.",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: "Missing Supabase environment variables." }, 500);
    }

    const authorization = req.headers.get("authorization") ?? req.headers.get("Authorization");
    if (!authorization) {
      return jsonResponse({ error: "Missing Authorization header." }, 401);
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user: callerUser },
      error: userError,
    } = await callerClient.auth.getUser();
    if (userError || !callerUser) {
      return jsonResponse({ error: userError?.message ?? "Invalid user token." }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const email = normalizeEmail((body as Record<string, unknown>).email);
    const role = normalizeRole((body as Record<string, unknown>).role);
    const companyId = asString((body as Record<string, unknown>).companyId);
    const companyName = asString((body as Record<string, unknown>).companyName);
    const redirectTo = asString((body as Record<string, unknown>).redirectTo);
    const expiresInDays = normalizeExpiresInDays((body as Record<string, unknown>).expiresInDays);

    if (!email) {
      return jsonResponse({ error: "Invite email is required." }, 400);
    }

    const { data: stateData, error: stateError } = await callerClient.rpc("get_my_onboarding_state");
    if (stateError) {
      return jsonResponse({ error: `Unable to verify caller permissions: ${stateError.message}` }, 400);
    }

    const state = Array.isArray(stateData)
      ? ((stateData[0] ?? null) as Record<string, unknown> | null)
      : ((stateData ?? null) as Record<string, unknown> | null);

    if (!isInviteManager(state)) {
      return jsonResponse({ error: "Forbidden: invite permissions required." }, 403);
    }

    const isPlatformAdmin = Boolean(state?.is_platform_admin);
    const callerCompanyId = asString(state?.company_id);

    const effectiveCompanyId = isPlatformAdmin ? companyId : callerCompanyId;
    const effectiveCompanyName = isPlatformAdmin ? companyName : null;

    if (isPlatformAdmin && !effectiveCompanyId && !effectiveCompanyName) {
      return jsonResponse({ error: "Provide companyId or companyName." }, 400);
    }

    if (!isPlatformAdmin && !effectiveCompanyId) {
      return jsonResponse({ error: "Your account is not linked to an active company workspace." }, 400);
    }

    const { data: invitationId, error: invitationError } = await callerClient.rpc("create_partner_invitation", {
      p_email: email,
      p_company_name: effectiveCompanyName,
      p_company_id: effectiveCompanyId,
      p_role: role,
      p_expires_in_days: expiresInDays,
    });

    if (invitationError) {
      return jsonResponse({ error: invitationError.message }, 400);
    }

    let authStatus: "invited" | "already_exists" | "manual_link" = "invited";
    let manualInviteLink: string | null = null;
    let authWarning: string | null = null;
    let deliveryStatus: "email_sent" | "already_exists" | "manual_link_ready" | "email_failed_link_failed" =
      "email_sent";
    let deliveryError: string | null = null;

    const { error: authInviteError } = await serviceClient.auth.admin.inviteUserByEmail(email, {
      redirectTo: redirectTo ?? undefined,
    });

    if (authInviteError) {
      const inferred = inferAuthStatus(authInviteError.message ?? "");
      if (inferred === "already_exists") {
        authStatus = "already_exists";
        deliveryStatus = "already_exists";
        deliveryError = authInviteError.message ?? null;
      } else {
        deliveryError = authInviteError.message ?? null;
        authWarning = authInviteError.message ?? "Invite email delivery failed.";
        authStatus = "manual_link";
        deliveryStatus = "manual_link_ready";
      }
    }

    const { link, errorMessage: linkErrorMessage } = await generateReusableInviteLink(
      serviceClient,
      email,
      redirectTo,
      authStatus === "already_exists",
    );

    if (!link) {
      if (deliveryStatus === "manual_link_ready") {
        deliveryStatus = "email_failed_link_failed";
      }

      deliveryError = [deliveryError, linkErrorMessage].filter(Boolean).join(" | ");

      const { error: persistFailureError } = await serviceClient
        .from("partner_invitations")
        .update({
          auth_delivery_status: deliveryStatus,
          auth_delivery_error: deliveryError,
          latest_invite_link: null,
          latest_invite_link_generated_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", invitationId);

      if (persistFailureError) {
        return jsonResponse(
          {
            error:
              `Auth invite failed and link generation failed. ` +
              `Also failed to persist invitation status: ${persistFailureError.message}`,
          },
          500,
        );
      }

      if (deliveryStatus === "email_failed_link_failed") {
        return jsonResponse(
          {
            error:
              `Auth invite failed: ${authInviteError?.message ?? "Unknown error"}. ` +
              `Fallback link failed: ${linkErrorMessage ?? "Unknown link error"}`,
          },
          500,
        );
      }
    }

    manualInviteLink = link;

    const { error: persistError } = await serviceClient
      .from("partner_invitations")
      .update({
        auth_delivery_status: deliveryStatus,
        auth_delivery_error: deliveryError,
        latest_invite_link: manualInviteLink,
        latest_invite_link_generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", invitationId);

    if (persistError) {
      return jsonResponse({ error: `Invite created but failed to persist invite link: ${persistError.message}` }, 500);
    }

    return jsonResponse({
      invitation_id: invitationId,
      auth_status: authStatus,
      manual_invite_link: manualInviteLink,
      auth_warning: authWarning,
      requested_by: callerUser.id,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
