-- Paid-first billing/paywall foundation for MVP launch.
-- Adds plan catalog, workspace subscriptions, usage metering, partner codes,
-- Stripe event idempotency, and invite entitlement enforcement.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.billing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code TEXT NOT NULL UNIQUE
    CHECK (plan_code IN ('solo', 'team')),
  display_name TEXT NOT NULL,
  description TEXT,
  price_monthly_cents INTEGER NOT NULL CHECK (price_monthly_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  seat_limit INTEGER NOT NULL CHECK (seat_limit > 0),
  statements_limit INTEGER NOT NULL CHECK (statements_limit > 0),
  normalized_rows_limit BIGINT NOT NULL CHECK (normalized_rows_limit > 0),
  ai_requests_limit INTEGER NOT NULL CHECK (ai_requests_limit > 0),
  stripe_price_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workspace_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL UNIQUE REFERENCES public.partner_companies(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.billing_plans(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'inactive'
    CHECK (status IN ('inactive', 'active_paid', 'active_sponsored', 'past_due', 'canceled')),
  provider TEXT NOT NULL DEFAULT 'manual'
    CHECK (provider IN ('stripe', 'manual', 'partner_code')),
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  sponsor_expires_at TIMESTAMPTZ,
  last_activated_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_subscriptions_provider_subscription
  ON public.workspace_subscriptions(provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_subscriptions_provider_customer
  ON public.workspace_subscriptions(provider_customer_id)
  WHERE provider_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.workspace_usage_monthly (
  company_id UUID NOT NULL REFERENCES public.partner_companies(id) ON DELETE CASCADE,
  period_start_month DATE NOT NULL,
  statement_count INTEGER NOT NULL DEFAULT 0 CHECK (statement_count >= 0),
  normalized_rows_count BIGINT NOT NULL DEFAULT 0 CHECK (normalized_rows_count >= 0),
  ai_request_count INTEGER NOT NULL DEFAULT 0 CHECK (ai_request_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, period_start_month)
);

CREATE TABLE IF NOT EXISTS public.workspace_partner_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.partner_companies(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL UNIQUE,
  code_hint TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'redeemed', 'expired', 'revoked')),
  sponsor_months INTEGER NOT NULL DEFAULT 3 CHECK (sponsor_months BETWEEN 1 AND 12),
  expires_at TIMESTAMPTZ,
  redeemed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  redeemed_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_partner_codes_one_active_per_company
  ON public.workspace_partner_codes(company_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.billing_events (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'processed'
    CHECK (status IN ('processed', 'ignored', 'failed')),
  error_message TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

ALTER TABLE public.cmo_reports
ADD COLUMN IF NOT EXISTS billing_usage_statement_metered_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS billing_usage_rows_metered BIGINT NOT NULL DEFAULT 0;

INSERT INTO public.billing_plans (
  plan_code,
  display_name,
  description,
  price_monthly_cents,
  currency,
  seat_limit,
  statements_limit,
  normalized_rows_limit,
  ai_requests_limit,
  stripe_price_id,
  is_active
)
VALUES
  (
    'solo',
    'Solo',
    'Single-user workspace with foundational processing and AI capacity.',
    4900,
    'USD',
    1,
    8,
    75000,
    30,
    NULL,
    true
  ),
  (
    'team',
    'Team',
    'Up to 4 members with expanded statement, row, and AI capacity.',
    14900,
    'USD',
    4,
    30,
    300000,
    150,
    NULL,
    true
  )
ON CONFLICT (plan_code) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      description = EXCLUDED.description,
      price_monthly_cents = EXCLUDED.price_monthly_cents,
      currency = EXCLUDED.currency,
      seat_limit = EXCLUDED.seat_limit,
      statements_limit = EXCLUDED.statements_limit,
      normalized_rows_limit = EXCLUDED.normalized_rows_limit,
      ai_requests_limit = EXCLUDED.ai_requests_limit,
      stripe_price_id = coalesce(EXCLUDED.stripe_price_id, billing_plans.stripe_price_id),
      is_active = EXCLUDED.is_active,
      updated_at = now();

DROP TRIGGER IF EXISTS update_billing_plans_updated_at ON public.billing_plans;
CREATE TRIGGER update_billing_plans_updated_at
BEFORE UPDATE ON public.billing_plans
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_workspace_subscriptions_updated_at ON public.workspace_subscriptions;
CREATE TRIGGER update_workspace_subscriptions_updated_at
BEFORE UPDATE ON public.workspace_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_workspace_usage_monthly_updated_at ON public.workspace_usage_monthly;
CREATE TRIGGER update_workspace_usage_monthly_updated_at
BEFORE UPDATE ON public.workspace_usage_monthly
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_workspace_partner_codes_updated_at ON public.workspace_partner_codes;
CREATE TRIGGER update_workspace_partner_codes_updated_at
BEFORE UPDATE ON public.workspace_partner_codes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_usage_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_partner_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view active billing plans" ON public.billing_plans;
CREATE POLICY "Authenticated users can view active billing plans"
ON public.billing_plans FOR SELECT
USING (is_active = true);

DROP POLICY IF EXISTS "Members can view workspace subscriptions" ON public.workspace_subscriptions;
CREATE POLICY "Members can view workspace subscriptions"
ON public.workspace_subscriptions FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.company_memberships m
    WHERE m.company_id = workspace_subscriptions.company_id
      AND m.user_id = auth.uid()
      AND m.membership_status = 'active'
  )
  OR public.is_platform_admin(auth.uid())
);

DROP POLICY IF EXISTS "Members can view monthly workspace usage" ON public.workspace_usage_monthly;
CREATE POLICY "Members can view monthly workspace usage"
ON public.workspace_usage_monthly FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.company_memberships m
    WHERE m.company_id = workspace_usage_monthly.company_id
      AND m.user_id = auth.uid()
      AND m.membership_status = 'active'
  )
  OR public.is_platform_admin(auth.uid())
);

DROP POLICY IF EXISTS "Owners admins can view workspace partner codes" ON public.workspace_partner_codes;
CREATE POLICY "Owners admins can view workspace partner codes"
ON public.workspace_partner_codes FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.company_memberships m
    WHERE m.company_id = workspace_partner_codes.company_id
      AND m.user_id = auth.uid()
      AND m.membership_status = 'active'
      AND m.role IN ('owner', 'admin')
  )
  OR public.is_platform_admin(auth.uid())
);

DROP POLICY IF EXISTS "Only platform admins can view billing events" ON public.billing_events;
CREATE POLICY "Only platform admins can view billing events"
ON public.billing_events FOR SELECT
USING (public.is_platform_admin(auth.uid()));

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
  FROM public.company_memberships
  WHERE user_id = v_uid
    AND membership_status = 'active'
  ORDER BY joined_at DESC NULLS LAST, created_at DESC
  LIMIT 1;

  IF v_membership.id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_company
  FROM public.partner_companies
  WHERE id = v_membership.company_id;

  IF v_company.id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_subscription
  FROM public.workspace_subscriptions
  WHERE company_id = v_company.id
  LIMIT 1;

  IF v_subscription.plan_id IS NOT NULL THEN
    SELECT *
    INTO v_plan
    FROM public.billing_plans
    WHERE id = v_subscription.plan_id
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
  FROM public.company_memberships m
  WHERE m.company_id = v_company.id
    AND m.membership_status = 'active';

  SELECT *
  INTO v_usage
  FROM public.workspace_usage_monthly
  WHERE company_id = v_company.id
    AND period_start_month = v_period_start_month;

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

CREATE OR REPLACE FUNCTION public.upsert_workspace_subscription_from_billing(
  p_company_id UUID,
  p_plan_code TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'inactive',
  p_provider TEXT DEFAULT 'stripe',
  p_provider_customer_id TEXT DEFAULT NULL,
  p_provider_subscription_id TEXT DEFAULT NULL,
  p_current_period_start TIMESTAMPTZ DEFAULT NULL,
  p_current_period_end TIMESTAMPTZ DEFAULT NULL,
  p_sponsor_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id UUID := NULL;
  v_subscription_id UUID;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id is required';
  END IF;

  IF p_status NOT IN ('inactive', 'active_paid', 'active_sponsored', 'past_due', 'canceled') THEN
    RAISE EXCEPTION 'Invalid subscription status: %', p_status;
  END IF;

  IF p_provider NOT IN ('stripe', 'manual', 'partner_code') THEN
    RAISE EXCEPTION 'Invalid provider: %', p_provider;
  END IF;

  IF p_plan_code IS NOT NULL THEN
    SELECT id
    INTO v_plan_id
    FROM public.billing_plans
    WHERE plan_code = lower(trim(p_plan_code))
    LIMIT 1;

    IF v_plan_id IS NULL THEN
      RAISE EXCEPTION 'Unknown plan code: %', p_plan_code;
    END IF;
  END IF;

  INSERT INTO public.workspace_subscriptions (
    company_id,
    plan_id,
    status,
    provider,
    provider_customer_id,
    provider_subscription_id,
    current_period_start,
    current_period_end,
    sponsor_expires_at,
    last_activated_at,
    canceled_at,
    metadata,
    updated_at
  )
  VALUES (
    p_company_id,
    v_plan_id,
    p_status,
    p_provider,
    p_provider_customer_id,
    p_provider_subscription_id,
    p_current_period_start,
    p_current_period_end,
    CASE WHEN p_status = 'active_sponsored' THEN p_sponsor_expires_at ELSE NULL END,
    CASE WHEN p_status IN ('active_paid', 'active_sponsored') THEN now() ELSE NULL END,
    CASE WHEN p_status IN ('canceled', 'inactive') THEN now() ELSE NULL END,
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  ON CONFLICT (company_id) DO UPDATE
    SET plan_id = coalesce(EXCLUDED.plan_id, workspace_subscriptions.plan_id),
        status = EXCLUDED.status,
        provider = coalesce(EXCLUDED.provider, workspace_subscriptions.provider),
        provider_customer_id = coalesce(EXCLUDED.provider_customer_id, workspace_subscriptions.provider_customer_id),
        provider_subscription_id = coalesce(EXCLUDED.provider_subscription_id, workspace_subscriptions.provider_subscription_id),
        current_period_start = coalesce(EXCLUDED.current_period_start, workspace_subscriptions.current_period_start),
        current_period_end = coalesce(EXCLUDED.current_period_end, workspace_subscriptions.current_period_end),
        sponsor_expires_at = CASE
          WHEN EXCLUDED.status = 'active_sponsored'
            THEN coalesce(EXCLUDED.sponsor_expires_at, workspace_subscriptions.sponsor_expires_at)
          ELSE NULL
        END,
        last_activated_at = CASE
          WHEN EXCLUDED.status IN ('active_paid', 'active_sponsored') THEN now()
          ELSE workspace_subscriptions.last_activated_at
        END,
        canceled_at = CASE
          WHEN EXCLUDED.status IN ('canceled', 'inactive') THEN coalesce(workspace_subscriptions.canceled_at, now())
          ELSE NULL
        END,
        metadata = coalesce(workspace_subscriptions.metadata, '{}'::jsonb) || coalesce(EXCLUDED.metadata, '{}'::jsonb),
        updated_at = now()
  RETURNING id INTO v_subscription_id;

  RETURN v_subscription_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_workspace_subscription_from_billing(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  JSONB
) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_workspace_partner_code(
  p_company_id UUID DEFAULT NULL,
  p_sponsor_months INTEGER DEFAULT 3,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  company_id UUID,
  partner_code TEXT,
  sponsor_months INTEGER,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_is_platform_admin BOOLEAN := false;
  v_target_company_id UUID := p_company_id;
  v_membership public.company_memberships%ROWTYPE;
  v_plain_code TEXT;
  v_hash TEXT;
  v_new_id UUID;
  i INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_sponsor_months < 1 OR p_sponsor_months > 12 THEN
    RAISE EXCEPTION 'p_sponsor_months must be between 1 and 12';
  END IF;

  v_is_platform_admin := coalesce(public.is_platform_admin(v_uid), false);

  IF v_target_company_id IS NULL THEN
    SELECT *
    INTO v_membership
    FROM public.company_memberships m
    WHERE m.user_id = v_uid
      AND m.membership_status = 'active'
    ORDER BY m.joined_at DESC NULLS LAST, m.created_at DESC
    LIMIT 1;

    IF v_membership.id IS NULL THEN
      RAISE EXCEPTION 'No active company workspace found';
    END IF;

    v_target_company_id := v_membership.company_id;
  END IF;

  IF NOT v_is_platform_admin THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.company_memberships m
      WHERE m.company_id = v_target_company_id
        AND m.user_id = v_uid
        AND m.membership_status = 'active'
        AND m.role IN ('owner', 'admin')
    ) THEN
      RAISE EXCEPTION 'Only owner/admin can create partner codes for this workspace';
    END IF;
  END IF;

  UPDATE public.workspace_partner_codes
  SET status = 'revoked',
      updated_at = now()
  WHERE company_id = v_target_company_id
    AND status = 'active';

  FOR i IN 1..8 LOOP
    v_plain_code := 'OSP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    v_hash := encode(digest(v_plain_code, 'sha256'), 'hex');
    BEGIN
      INSERT INTO public.workspace_partner_codes (
        company_id,
        code_hash,
        code_hint,
        status,
        sponsor_months,
        expires_at,
        created_by,
        created_at,
        updated_at
      )
      VALUES (
        v_target_company_id,
        v_hash,
        right(v_plain_code, 4),
        'active',
        p_sponsor_months,
        p_expires_at,
        v_uid,
        now(),
        now()
      )
      RETURNING id INTO v_new_id;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        v_new_id := NULL;
    END;
  END LOOP;

  IF v_new_id IS NULL THEN
    RAISE EXCEPTION 'Unable to generate unique partner code. Retry.';
  END IF;

  RETURN QUERY
  SELECT
    v_target_company_id,
    v_plain_code,
    p_sponsor_months,
    p_expires_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_workspace_partner_code(UUID, INTEGER, TIMESTAMPTZ) TO authenticated;

CREATE OR REPLACE FUNCTION public.redeem_workspace_partner_code(
  p_code TEXT
)
RETURNS TABLE (
  company_id UUID,
  subscription_status TEXT,
  plan_code TEXT,
  sponsor_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_membership public.company_memberships%ROWTYPE;
  v_is_platform_admin BOOLEAN := false;
  v_clean_code TEXT;
  v_code_hash TEXT;
  v_partner_code public.workspace_partner_codes%ROWTYPE;
  v_team_plan public.billing_plans%ROWTYPE;
  v_sponsor_expires_at TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_clean_code := upper(regexp_replace(trim(coalesce(p_code, '')), '[^A-Za-z0-9]', '', 'g'));
  IF v_clean_code = '' THEN
    RAISE EXCEPTION 'Partner code is required';
  END IF;

  SELECT *
  INTO v_membership
  FROM public.company_memberships
  WHERE user_id = v_uid
    AND membership_status = 'active'
  ORDER BY joined_at DESC NULLS LAST, created_at DESC
  LIMIT 1;

  IF v_membership.id IS NULL THEN
    RAISE EXCEPTION 'No active company workspace found';
  END IF;

  v_is_platform_admin := coalesce(public.is_platform_admin(v_uid), false);
  IF NOT v_is_platform_admin AND v_membership.role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owner/admin can redeem partner codes';
  END IF;

  v_code_hash := encode(digest(v_clean_code, 'sha256'), 'hex');

  SELECT *
  INTO v_partner_code
  FROM public.workspace_partner_codes c
  WHERE c.company_id = v_membership.company_id
    AND c.code_hash = v_code_hash
    AND c.status = 'active'
    AND (c.expires_at IS NULL OR c.expires_at > now())
  ORDER BY c.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_partner_code.id IS NULL THEN
    RAISE EXCEPTION 'Invalid, expired, or already redeemed partner code';
  END IF;

  SELECT *
  INTO v_team_plan
  FROM public.billing_plans
  WHERE plan_code = 'team'
    AND is_active = true
  LIMIT 1;

  IF v_team_plan.id IS NULL THEN
    RAISE EXCEPTION 'Team plan is not configured';
  END IF;

  v_sponsor_expires_at := now() + make_interval(months => coalesce(v_partner_code.sponsor_months, 3));

  INSERT INTO public.workspace_subscriptions (
    company_id,
    plan_id,
    status,
    provider,
    provider_customer_id,
    provider_subscription_id,
    current_period_start,
    current_period_end,
    sponsor_expires_at,
    last_activated_at,
    canceled_at,
    metadata,
    created_by,
    updated_at
  )
  VALUES (
    v_membership.company_id,
    v_team_plan.id,
    'active_sponsored',
    'partner_code',
    NULL,
    NULL,
    now(),
    v_sponsor_expires_at,
    v_sponsor_expires_at,
    now(),
    NULL,
    jsonb_build_object(
      'partner_code_id', v_partner_code.id,
      'redeemed_by', v_uid
    ),
    v_uid,
    now()
  )
  ON CONFLICT (company_id) DO UPDATE
    SET plan_id = EXCLUDED.plan_id,
        status = EXCLUDED.status,
        provider = EXCLUDED.provider,
        provider_subscription_id = NULL,
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        sponsor_expires_at = EXCLUDED.sponsor_expires_at,
        last_activated_at = now(),
        canceled_at = NULL,
        metadata = coalesce(workspace_subscriptions.metadata, '{}'::jsonb) || coalesce(EXCLUDED.metadata, '{}'::jsonb),
        updated_at = now();

  UPDATE public.workspace_partner_codes
  SET status = 'redeemed',
      redeemed_by = v_uid,
      redeemed_at = now(),
      updated_at = now()
  WHERE id = v_partner_code.id;

  RETURN QUERY
  SELECT
    v_membership.company_id,
    'active_sponsored'::TEXT,
    v_team_plan.plan_code,
    v_sponsor_expires_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_workspace_partner_code(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.increment_workspace_ai_usage(
  p_user_id UUID,
  p_amount INTEGER DEFAULT 1
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_amount INTEGER := GREATEST(1, coalesce(p_amount, 1));
  v_period_start DATE := date_trunc('month', now())::date;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT m.company_id
  INTO v_company_id
  FROM public.company_memberships m
  WHERE m.user_id = p_user_id
    AND m.membership_status = 'active'
  ORDER BY m.joined_at DESC NULLS LAST, m.created_at DESC
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.workspace_usage_monthly (
    company_id,
    period_start_month,
    ai_request_count,
    created_at,
    updated_at
  )
  VALUES (
    v_company_id,
    v_period_start,
    v_amount,
    now(),
    now()
  )
  ON CONFLICT (company_id, period_start_month) DO UPDATE
    SET ai_request_count = workspace_usage_monthly.ai_request_count + EXCLUDED.ai_request_count,
        updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_workspace_ai_usage(UUID, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_workspace_usage_from_report(
  p_report_id UUID
)
RETURNS TABLE (
  company_id UUID,
  statement_increment INTEGER,
  rows_increment BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.cmo_reports%ROWTYPE;
  v_company_id UUID;
  v_statement_increment INTEGER := 0;
  v_rows_increment BIGINT := 0;
  v_current_rows BIGINT := 0;
  v_period_start DATE := date_trunc('month', now())::date;
BEGIN
  IF p_report_id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
  INTO v_report
  FROM public.cmo_reports
  WHERE id = p_report_id
  LIMIT 1
  FOR UPDATE;

  IF v_report.id IS NULL THEN
    RETURN;
  END IF;

  IF v_report.status NOT IN ('completed_passed', 'completed_with_warnings', 'needs_review') THEN
    RETURN;
  END IF;

  SELECT m.company_id
  INTO v_company_id
  FROM public.company_memberships m
  WHERE m.user_id = v_report.user_id
    AND m.membership_status = 'active'
  ORDER BY m.joined_at DESC NULLS LAST, m.created_at DESC
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  IF v_report.billing_usage_statement_metered_at IS NULL THEN
    v_statement_increment := 1;
  END IF;

  v_current_rows := coalesce(v_report.transaction_count, 0);
  v_rows_increment := GREATEST(v_current_rows - coalesce(v_report.billing_usage_rows_metered, 0), 0);

  IF v_statement_increment > 0 OR v_rows_increment > 0 THEN
    INSERT INTO public.workspace_usage_monthly (
      company_id,
      period_start_month,
      statement_count,
      normalized_rows_count,
      created_at,
      updated_at
    )
    VALUES (
      v_company_id,
      v_period_start,
      v_statement_increment,
      v_rows_increment,
      now(),
      now()
    )
    ON CONFLICT (company_id, period_start_month) DO UPDATE
      SET statement_count = workspace_usage_monthly.statement_count + EXCLUDED.statement_count,
          normalized_rows_count = workspace_usage_monthly.normalized_rows_count + EXCLUDED.normalized_rows_count,
          updated_at = now();
  END IF;

  UPDATE public.cmo_reports
  SET billing_usage_statement_metered_at = coalesce(billing_usage_statement_metered_at, now()),
      billing_usage_rows_metered = GREATEST(coalesce(billing_usage_rows_metered, 0), v_current_rows),
      updated_at = now()
  WHERE id = v_report.id;

  RETURN QUERY
  SELECT
    v_company_id,
    v_statement_increment,
    v_rows_increment;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_workspace_usage_from_report(UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.create_partner_invitation(TEXT, TEXT, UUID, TEXT, INTEGER);
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

GRANT EXECUTE ON FUNCTION public.create_partner_invitation(TEXT, TEXT, UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_workspace_subscription_state() TO service_role;
GRANT EXECUTE ON FUNCTION public.upsert_workspace_subscription_from_billing(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  JSONB
) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_workspace_partner_code(UUID, INTEGER, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.redeem_workspace_partner_code(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_workspace_ai_usage(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_workspace_usage_from_report(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_partner_invitation(TEXT, TEXT, UUID, TEXT, INTEGER) TO service_role;
