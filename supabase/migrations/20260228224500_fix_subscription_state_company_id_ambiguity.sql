-- Fix ambiguous column references in get_my_workspace_subscription_state.
-- The function RETURNS TABLE includes output columns named company_id and period_start_month,
-- so unqualified SQL references can become ambiguous at runtime.

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
  ORDER BY m.joined_at DESC NULLS LAST, m.created_at DESC
  LIMIT 1;

  IF v_membership.id IS NULL THEN
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

GRANT EXECUTE ON FUNCTION public.get_my_workspace_subscription_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_workspace_subscription_state() TO service_role;
