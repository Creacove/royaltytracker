-- Harden subscription and onboarding state resolution logic to prioritize high-privilege roles.
-- This ensures that if a user has multiple memberships (e.g. through invitations), the one with 'owner' or 'admin' status is used for permission checks.

CREATE OR REPLACE FUNCTION public.get_my_onboarding_state()
RETURNS TABLE (
  onboarding_complete BOOLEAN,
  has_active_membership BOOLEAN,
  has_pending_invitation BOOLEAN,
  pending_invitation_role TEXT,
  active_membership_role TEXT,
  is_platform_admin BOOLEAN,
  company_id UUID,
  company_name TEXT,
  website TEXT,
  country_code TEXT,
  default_currency TEXT,
  timezone TEXT,
  monthly_statement_volume TEXT,
  primary_cmo_count INTEGER,
  first_name TEXT,
  last_name TEXT,
  job_title TEXT,
  phone TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_profile public.app_users%ROWTYPE;
  v_membership public.company_memberships%ROWTYPE;
  v_company public.partner_companies%ROWTYPE;
  v_invite public.partner_invitations%ROWTYPE;
  v_is_platform_admin BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  PERFORM public.ensure_first_platform_admin();
  v_is_platform_admin := public.is_platform_admin(v_uid);

  IF v_email <> '' THEN
    INSERT INTO public.app_users (id, email, created_at, updated_at)
    VALUES (v_uid, v_email, now(), now())
    ON CONFLICT (id) DO UPDATE
      SET email = EXCLUDED.email,
          updated_at = now();
  END IF;

  SELECT *
  INTO v_profile
  FROM public.app_users
  WHERE id = v_uid;

  -- PRIORITIZE: Active memberships by role (Owner > Admin > Member)
  SELECT *
  INTO v_membership
  FROM public.company_memberships
  WHERE user_id = v_uid
    AND membership_status = 'active'
  ORDER BY 
    CASE role 
      WHEN 'owner' THEN 1 
      WHEN 'admin' THEN 2 
      WHEN 'member' THEN 3 
      ELSE 4 
    END ASC,
    joined_at DESC NULLS LAST, 
    created_at DESC
  LIMIT 1;

  IF v_membership.id IS NOT NULL THEN
    SELECT *
    INTO v_company
    FROM public.partner_companies
    WHERE id = v_membership.company_id;
  END IF;

  IF v_email <> '' THEN
    SELECT *
    INTO v_invite
    FROM public.partner_invitations
    WHERE lower(email) = v_email
      AND status = 'pending'
      AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_company.id IS NULL AND v_invite.company_id IS NOT NULL THEN
      SELECT *
      INTO v_company
      FROM public.partner_companies
      WHERE id = v_invite.company_id;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    (v_profile.onboarding_completed_at IS NOT NULL AND v_membership.id IS NOT NULL) AS onboarding_complete,
    (v_membership.id IS NOT NULL) AS has_active_membership,
    (v_invite.id IS NOT NULL) AS has_pending_invitation,
    v_invite.role,
    v_membership.role,
    v_is_platform_admin,
    v_company.id,
    v_company.company_name,
    v_company.website,
    v_company.country_code,
    v_company.default_currency,
    v_company.timezone,
    v_company.monthly_statement_volume,
    v_company.primary_cmo_count,
    v_profile.first_name,
    v_profile.last_name,
    v_profile.job_title,
    v_profile.phone;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_workspace_subscription_state()
RETURNS TABLE (
  company_id UUID,
  company_name TEXT,
  active_membership_role TEXT,
  is_platform_admin BOOLEAN,
  can_manage_billing BOOLEAN,
  subscription_status TEXT,
  effective_subscription_status TEXT,
  plan_code TEXT,
  plan_name TEXT,
  price_monthly_cents INTEGER,
  currency TEXT,
  seat_limit INTEGER,
  statements_limit INTEGER,
  normalized_rows_limit BIGINT,
  ai_requests_limit INTEGER,
  seats_used INTEGER,
  period_start_month DATE,
  statements_used INTEGER,
  normalized_rows_used BIGINT,
  ai_requests_used INTEGER,
  statements_usage_ratio NUMERIC,
  rows_usage_ratio NUMERIC,
  ai_usage_ratio NUMERIC,
  sponsor_expires_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  needs_activation BOOLEAN,
  soft_limit_reached BOOLEAN,
  hard_limit_reached BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_membership public.company_memberships%ROWTYPE;
  v_company public.partner_companies%ROWTYPE;
  v_subscription public.workspace_subscriptions%ROWTYPE;
  v_plan public.billing_plans%ROWTYPE;
  v_usage public.workspace_usage_monthly%ROWTYPE;
  v_is_platform_admin BOOLEAN := false;
  v_can_manage_billing BOOLEAN := false;
  v_effective_status TEXT := 'inactive';
  v_period_start_month DATE := date_trunc('month', now())::date;
  v_seats_used INTEGER := 0;
  v_statements_used INTEGER := 0;
  v_rows_used BIGINT := 0;
  v_ai_used INTEGER := 0;
  v_statement_ratio NUMERIC := 0;
  v_rows_ratio NUMERIC := 0;
  v_ai_ratio NUMERIC := 0;
  v_needs_activation BOOLEAN := true;
  v_soft_limit_reached BOOLEAN := false;
  v_hard_limit_reached BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  v_is_platform_admin := coalesce(public.is_platform_admin(v_uid), false);

  -- PRIORITIZE: Active memberships by role (Owner > Admin > Member)
  SELECT *
  INTO v_membership
  FROM public.company_memberships AS m
  WHERE m.user_id = v_uid
    AND m.membership_status = 'active'
  ORDER BY 
    CASE role 
      WHEN 'owner' THEN 1 
      WHEN 'admin' THEN 2 
      WHEN 'member' THEN 3 
      ELSE 4 
    END ASC,
    m.joined_at DESC NULLS LAST, 
    m.created_at DESC
  LIMIT 1;

  IF v_membership.id IS NULL THEN
    -- Even without workspace, if platform admin, return a default row
    IF v_is_platform_admin THEN
       RETURN QUERY SELECT
         null::UUID, null::TEXT, null::TEXT, true, true,
         'inactive'::TEXT, 'inactive'::TEXT, null::TEXT, null::TEXT, 0, 'USD',
         null::INTEGER, null::INTEGER, null::BIGINT, null::INTEGER, 0,
         v_period_start_month, 0, 0::BIGINT, 0, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC,
         null::TIMESTAMPTZ, null::TIMESTAMPTZ, true, false, false;
    END IF;
    RETURN;
  END IF;

  SELECT *
  INTO v_company
  FROM public.partner_companies AS c
  WHERE c.id = v_membership.company_id;

  IF v_company.id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_subscription
  FROM public.workspace_subscriptions AS ws
  WHERE ws.company_id = v_company.id
  LIMIT 1;

  IF v_subscription.plan_id IS NOT NULL THEN
    SELECT *
    INTO v_plan
    FROM public.billing_plans AS bp
    WHERE bp.id = v_subscription.plan_id
    LIMIT 1;
  END IF;

  IF v_subscription.id IS NOT NULL THEN
    v_effective_status := v_subscription.status;
    IF v_effective_status = 'active_sponsored'
      AND v_subscription.sponsor_expires_at IS NOT NULL
      AND v_subscription.sponsor_expires_at <= now() THEN
      v_effective_status := 'inactive';
    END IF;
  END IF;

  v_can_manage_billing := v_is_platform_admin OR v_membership.role IN ('owner', 'admin');

  SELECT count(*)::INTEGER
  INTO v_seats_used
  FROM public.company_memberships AS m
  WHERE m.company_id = v_company.id
    AND m.membership_status = 'active';

  SELECT *
  INTO v_usage
  FROM public.workspace_usage_monthly AS usage
  WHERE usage.company_id = v_company.id
    AND usage.period_start_month = v_period_start_month;

  v_statements_used := coalesce(v_usage.statement_count, 0);
  v_rows_used := coalesce(v_usage.normalized_rows_count, 0);
  v_ai_used := coalesce(v_usage.ai_request_count, 0);

  IF coalesce(v_plan.statements_limit, 0) > 0 THEN
    v_statement_ratio := v_statements_used::NUMERIC / NULLIF(v_plan.statements_limit::NUMERIC, 0);
  END IF;

  IF coalesce(v_plan.normalized_rows_limit, 0) > 0 THEN
    v_rows_ratio := v_rows_used::NUMERIC / NULLIF(v_plan.normalized_rows_limit::NUMERIC, 0);
  END IF;

  IF coalesce(v_plan.ai_requests_limit, 0) > 0 THEN
    v_ai_ratio := v_ai_used::NUMERIC / NULLIF(v_plan.ai_requests_limit::NUMERIC, 0);
  END IF;

  v_needs_activation := NOT (v_effective_status IN ('active_paid', 'active_sponsored'));

  v_soft_limit_reached :=
    v_statement_ratio >= 0.8
    OR v_rows_ratio >= 0.8
    OR v_ai_ratio >= 0.8;

  v_hard_limit_reached :=
    (coalesce(v_plan.statements_limit, 0) > 0 AND v_statements_used >= v_plan.statements_limit)
    OR (coalesce(v_plan.normalized_rows_limit, 0) > 0 AND v_rows_used >= v_plan.normalized_rows_limit)
    OR (coalesce(v_plan.ai_requests_limit, 0) > 0 AND v_ai_used >= v_plan.ai_requests_limit);

  RETURN QUERY
  SELECT
    v_company.id,
    v_company.company_name,
    v_membership.role,
    v_is_platform_admin,
    v_can_manage_billing,
    coalesce(v_subscription.status, 'inactive'),
    v_effective_status,
    v_plan.plan_code,
    v_plan.display_name,
    v_plan.price_monthly_cents,
    coalesce(v_plan.currency, 'USD'),
    v_plan.seat_limit,
    v_plan.statements_limit,
    v_plan.normalized_rows_limit,
    v_plan.ai_requests_limit,
    v_seats_used,
    v_period_start_month,
    v_statements_used,
    v_rows_used,
    v_ai_used,
    v_statement_ratio,
    v_rows_ratio,
    v_ai_ratio,
    v_subscription.sponsor_expires_at,
    v_subscription.current_period_end,
    v_needs_activation,
    v_soft_limit_reached,
    v_hard_limit_reached;
END;
$$;
