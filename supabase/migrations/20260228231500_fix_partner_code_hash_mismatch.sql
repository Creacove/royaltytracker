-- Fix partner code hash mismatch between generation and redemption.
-- Historically, generation hashed "OSP-XXXXXXXXXXXX" while redemption hashed
-- normalized "OSPXXXXXXXXXXXX". This made fresh codes fail validation.
--
-- This migration:
-- 1) stores normalized hash at generation time
-- 2) redeems using multiple hash candidates for backward compatibility

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
SET search_path = public, extensions
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

  UPDATE public.workspace_partner_codes AS codes
  SET status = 'revoked',
      updated_at = now()
  WHERE codes.company_id = v_target_company_id
    AND codes.status = 'active';

  FOR i IN 1..8 LOOP
    v_plain_code := 'OSP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    -- Canonical hash ignores punctuation so input with/without hyphen works.
    v_hash := encode(
      extensions.digest(upper(regexp_replace(v_plain_code, '[^A-Za-z0-9]', '', 'g')), 'sha256'),
      'hex'
    );

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
GRANT EXECUTE ON FUNCTION public.create_workspace_partner_code(UUID, INTEGER, TIMESTAMPTZ) TO service_role;

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
SET search_path = public, extensions
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_membership public.company_memberships%ROWTYPE;
  v_is_platform_admin BOOLEAN := false;
  v_raw_code TEXT;
  v_clean_code TEXT;
  v_legacy_hyphen_code TEXT;
  v_hash_clean TEXT;
  v_hash_raw TEXT;
  v_hash_legacy TEXT;
  v_partner_code public.workspace_partner_codes%ROWTYPE;
  v_team_plan public.billing_plans%ROWTYPE;
  v_sponsor_expires_at TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_raw_code := upper(trim(coalesce(p_code, '')));
  v_clean_code := upper(regexp_replace(v_raw_code, '[^A-Za-z0-9]', '', 'g'));

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

  -- Current canonical hash.
  v_hash_clean := encode(extensions.digest(v_clean_code, 'sha256'), 'hex');
  -- Raw uppercase input hash (for pre-fix behavior when pasted exactly).
  v_hash_raw := encode(extensions.digest(v_raw_code, 'sha256'), 'hex');
  -- Legacy display-style hash reconstruction for old generated codes.
  IF left(v_clean_code, 3) = 'OSP' AND length(v_clean_code) > 3 THEN
    v_legacy_hyphen_code := 'OSP-' || substring(v_clean_code from 4);
  ELSE
    v_legacy_hyphen_code := v_raw_code;
  END IF;
  v_hash_legacy := encode(extensions.digest(v_legacy_hyphen_code, 'sha256'), 'hex');

  SELECT *
  INTO v_partner_code
  FROM public.workspace_partner_codes c
  WHERE c.company_id = v_membership.company_id
    AND c.code_hash IN (v_hash_clean, v_hash_raw, v_hash_legacy)
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
GRANT EXECUTE ON FUNCTION public.redeem_workspace_partner_code(TEXT) TO service_role;
