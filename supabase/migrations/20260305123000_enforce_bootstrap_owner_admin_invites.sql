-- Ensure the first invite into an empty workspace is always owner/admin.
-- This prevents a deadlock where the first user cannot manage billing or invites.

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
GRANT EXECUTE ON FUNCTION public.create_partner_invitation(TEXT, TEXT, UUID, TEXT, INTEGER) TO service_role;
