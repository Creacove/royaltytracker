-- Platform admins should never be blocked by workspace plan limits.
-- This migration gives platform admins unlimited invite and AI/billing-limit bypass.

CREATE OR REPLACE FUNCTION public.create_partner_invitation(
  p_email TEXT,
  p_company_name TEXT DEFAULT NULL,
  p_company_id UUID DEFAULT NULL,
  p_role TEXT DEFAULT 'member',
  p_expires_in_days INTEGER DEFAULT 14
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_clean_email TEXT := lower(trim(coalesce(p_email, '')));
  v_clean_role TEXT := lower(trim(coalesce(p_role, 'member')));
  v_company_id UUID := p_company_id;
  v_company_name TEXT := nullif(trim(coalesce(p_company_name, '')), '');
  v_invitation_id UUID;
  v_is_platform_admin BOOLEAN;
  v_subscription_status TEXT;
  v_sponsor_expires_at TIMESTAMPTZ;
  v_seat_limit INTEGER;
  v_seats_used INTEGER := 0;
  v_is_company_bootstrap BOOLEAN := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM public.ensure_first_platform_admin();
  v_is_platform_admin := public.is_platform_admin(v_uid);

  IF v_clean_email = '' THEN
    RAISE EXCEPTION 'Invitation email is required';
  END IF;

  IF v_clean_role NOT IN ('owner', 'admin', 'member', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  IF p_expires_in_days < 1 OR p_expires_in_days > 60 THEN
    RAISE EXCEPTION 'p_expires_in_days must be between 1 and 60';
  END IF;

  IF v_company_id IS NOT NULL THEN
    IF NOT v_is_platform_admin THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.company_memberships m
        WHERE m.company_id = v_company_id
          AND m.user_id = v_uid
          AND m.membership_status = 'active'
          AND m.role IN ('owner', 'admin')
      ) THEN
        RAISE EXCEPTION 'Only owners/admins can invite users for this company';
      END IF;
    END IF;
  ELSE
    IF v_is_platform_admin THEN
      IF v_company_name IS NULL THEN
        RAISE EXCEPTION 'p_company_name is required when p_company_id is null';
      END IF;

      INSERT INTO public.partner_companies (
        company_name,
        onboarding_stage,
        created_at,
        updated_at
      )
      VALUES (
        v_company_name,
        'not_started',
        now(),
        now()
      )
      RETURNING id INTO v_company_id;
    ELSE
      SELECT m.company_id
      INTO v_company_id
      FROM public.company_memberships m
      WHERE m.user_id = v_uid
        AND m.membership_status = 'active'
        AND m.role IN ('owner', 'admin')
      ORDER BY m.joined_at DESC NULLS LAST, m.created_at DESC
      LIMIT 1;

      IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'Only platform admins can create a new company invitation';
      END IF;
    END IF;
  END IF;

  SELECT count(*)::INTEGER
  INTO v_seats_used
  FROM public.company_memberships m
  WHERE m.company_id = v_company_id
    AND m.membership_status = 'active';

  v_is_company_bootstrap := v_is_platform_admin AND v_seats_used = 0;

  IF v_is_company_bootstrap AND v_clean_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'First invite for a new or empty workspace must use owner/admin role';
  END IF;

  -- Platform admins bypass workspace subscription and seat limits.
  IF NOT v_is_platform_admin THEN
    SELECT
      ws.status,
      ws.sponsor_expires_at,
      bp.seat_limit
    INTO
      v_subscription_status,
      v_sponsor_expires_at,
      v_seat_limit
    FROM public.workspace_subscriptions ws
    LEFT JOIN public.billing_plans bp
      ON bp.id = ws.plan_id
    WHERE ws.company_id = v_company_id
    LIMIT 1;

    IF NOT (
      v_subscription_status = 'active_paid'
      OR (
        v_subscription_status = 'active_sponsored'
        AND (v_sponsor_expires_at IS NULL OR v_sponsor_expires_at > now())
      )
    ) THEN
      IF NOT v_is_company_bootstrap THEN
        RAISE EXCEPTION 'Active workspace subscription is required before sending invites';
      END IF;
    END IF;

    IF v_seat_limit IS NOT NULL AND v_seat_limit > 0 THEN
      IF v_seats_used >= v_seat_limit THEN
        RAISE EXCEPTION 'Seat limit reached for current plan. Upgrade to invite more members.';
      END IF;
    END IF;
  END IF;

  SELECT id
  INTO v_invitation_id
  FROM public.partner_invitations
  WHERE lower(email) = v_clean_email
    AND status = 'pending'
  LIMIT 1
  FOR UPDATE;

  IF v_invitation_id IS NULL THEN
    INSERT INTO public.partner_invitations (
      company_id,
      email,
      role,
      invited_by,
      status,
      expires_at,
      created_at,
      updated_at
    )
    VALUES (
      v_company_id,
      v_clean_email,
      v_clean_role,
      v_uid,
      'pending',
      now() + make_interval(days => p_expires_in_days),
      now(),
      now()
    )
    RETURNING id INTO v_invitation_id;
  ELSE
    UPDATE public.partner_invitations
    SET company_id = v_company_id,
        role = v_clean_role,
        invited_by = coalesce(v_uid, invited_by),
        expires_at = now() + make_interval(days => p_expires_in_days),
        updated_at = now()
    WHERE id = v_invitation_id;
  END IF;

  RETURN v_invitation_id;
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
    IF v_is_platform_admin THEN
      RETURN QUERY SELECT
        null::UUID, null::TEXT, null::TEXT, true, true,
        'inactive'::TEXT, 'inactive'::TEXT, null::TEXT, null::TEXT, 0, 'USD',
        null::INTEGER, null::INTEGER, null::BIGINT, null::INTEGER, 0,
        v_period_start_month, 0, 0::BIGINT, 0, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC,
        null::TIMESTAMPTZ, null::TIMESTAMPTZ, false, false, false;
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

  -- Platform admins are never blocked by activation or usage limits.
  IF v_is_platform_admin THEN
    v_needs_activation := false;
    v_statement_ratio := 0;
    v_rows_ratio := 0;
    v_ai_ratio := 0;
    v_soft_limit_reached := false;
    v_hard_limit_reached := false;
  END IF;

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
    CASE WHEN v_is_platform_admin THEN null::INTEGER ELSE v_plan.seat_limit END,
    CASE WHEN v_is_platform_admin THEN null::INTEGER ELSE v_plan.statements_limit END,
    CASE WHEN v_is_platform_admin THEN null::BIGINT ELSE v_plan.normalized_rows_limit END,
    CASE WHEN v_is_platform_admin THEN null::INTEGER ELSE v_plan.ai_requests_limit END,
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

GRANT EXECUTE ON FUNCTION public.create_partner_invitation(TEXT, TEXT, UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_partner_invitation(TEXT, TEXT, UUID, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_workspace_subscription_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_workspace_subscription_state() TO service_role;
