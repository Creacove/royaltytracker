-- Harden redeem_workspace_partner_code against output-column name collisions.
-- Avoids ambiguous `company_id` reference inside ON CONFLICT target by using
-- explicit constraint name instead of column-list conflict target.

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
  FROM public.company_memberships AS m
  WHERE m.user_id = v_uid
    AND m.membership_status = 'active'
  ORDER BY m.joined_at DESC NULLS LAST, m.created_at DESC
  LIMIT 1;

  IF v_membership.id IS NULL THEN
    RAISE EXCEPTION 'No active company workspace found';
  END IF;

  v_is_platform_admin := coalesce(public.is_platform_admin(v_uid), false);
  IF NOT v_is_platform_admin AND v_membership.role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only owner/admin can redeem partner codes';
  END IF;

  v_hash_clean := encode(extensions.digest(v_clean_code, 'sha256'), 'hex');
  v_hash_raw := encode(extensions.digest(v_raw_code, 'sha256'), 'hex');

  IF left(v_clean_code, 3) = 'OSP' AND length(v_clean_code) > 3 THEN
    v_legacy_hyphen_code := 'OSP-' || substring(v_clean_code from 4);
  ELSE
    v_legacy_hyphen_code := v_raw_code;
  END IF;
  v_hash_legacy := encode(extensions.digest(v_legacy_hyphen_code, 'sha256'), 'hex');

  SELECT *
  INTO v_partner_code
  FROM public.workspace_partner_codes AS c
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
  FROM public.billing_plans AS bp
  WHERE bp.plan_code = 'team'
    AND bp.is_active = true
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
  ON CONFLICT ON CONSTRAINT workspace_subscriptions_company_id_key DO UPDATE
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
