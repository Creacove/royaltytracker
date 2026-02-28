-- Platform admin controls and admin invite management surface.

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS update_platform_admins_updated_at ON public.platform_admins;
CREATE TRIGGER update_platform_admins_updated_at
BEFORE UPDATE ON public.platform_admins
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.is_platform_admin(p_uid UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins
    WHERE user_id = p_uid
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_first_platform_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_platform_admin(v_uid) THEN
    RETURN true;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.platform_admins) THEN
    INSERT INTO public.platform_admins (
      user_id,
      email,
      granted_by,
      notes,
      created_at,
      updated_at
    )
    VALUES (
      v_uid,
      coalesce(nullif(v_email, ''), v_uid::text || '@local.invalid'),
      v_uid,
      'Auto-bootstrap first platform admin',
      now(),
      now()
    )
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN public.is_platform_admin(v_uid);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_first_platform_admin() TO authenticated;

INSERT INTO public.platform_admins (
  user_id,
  email,
  granted_by,
  notes,
  created_at,
  updated_at
)
SELECT
  u.id,
  lower(u.email),
  u.id,
  'Bootstrap existing first auth user',
  now(),
  now()
FROM auth.users u
WHERE lower(coalesce(u.email, '')) <> ''
ORDER BY u.created_at ASC NULLS LAST, u.id
LIMIT 1
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own platform admin row" ON public.platform_admins;
CREATE POLICY "Users can view own platform admin row"
ON public.platform_admins FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Platform admins can view all admin rows" ON public.platform_admins;
CREATE POLICY "Platform admins can view all admin rows"
ON public.platform_admins FOR SELECT
USING (public.is_platform_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.grant_platform_admin_by_email(
  p_email TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT := lower(trim(coalesce(p_email, '')));
  v_target_user_id UUID;
BEGIN
  IF v_uid IS NULL OR NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'Only platform admins can grant admin access';
  END IF;

  IF v_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  SELECT id
  INTO v_target_user_id
  FROM auth.users
  WHERE lower(coalesce(email, '')) = v_email
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'No auth user exists for email %', v_email;
  END IF;

  INSERT INTO public.platform_admins (
    user_id,
    email,
    granted_by,
    notes,
    created_at,
    updated_at
  )
  VALUES (
    v_target_user_id,
    v_email,
    v_uid,
    p_notes,
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email,
        granted_by = EXCLUDED.granted_by,
        notes = EXCLUDED.notes,
        updated_at = now();

  RETURN v_target_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_platform_admin_by_email(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_invitable_companies()
RETURNS TABLE (
  company_id UUID,
  company_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  PERFORM public.ensure_first_platform_admin();

  IF public.is_platform_admin(v_uid) THEN
    RETURN QUERY
    SELECT c.id, c.company_name
    FROM public.partner_companies c
    ORDER BY c.company_name ASC;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT c.id, c.company_name
  FROM public.partner_companies c
  INNER JOIN public.company_memberships m
    ON m.company_id = c.id
  WHERE m.user_id = v_uid
    AND m.membership_status = 'active'
    AND m.role IN ('owner', 'admin')
  ORDER BY c.company_name ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_invitable_companies() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_visible_partner_invitations(
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  invitation_id UUID,
  email TEXT,
  role TEXT,
  status TEXT,
  company_id UUID,
  company_name TEXT,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_limit INTEGER := GREATEST(1, LEAST(coalesce(p_limit, 50), 200));
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  PERFORM public.ensure_first_platform_admin();

  IF public.is_platform_admin(v_uid) THEN
    RETURN QUERY
    SELECT
      i.id,
      i.email,
      i.role,
      i.status,
      i.company_id,
      c.company_name,
      i.created_at,
      i.expires_at,
      i.accepted_at
    FROM public.partner_invitations i
    LEFT JOIN public.partner_companies c
      ON c.id = i.company_id
    ORDER BY i.created_at DESC
    LIMIT v_limit;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.email,
    i.role,
    i.status,
    i.company_id,
    c.company_name,
    i.created_at,
    i.expires_at,
    i.accepted_at
  FROM public.partner_invitations i
  INNER JOIN public.partner_companies c
    ON c.id = i.company_id
  INNER JOIN public.company_memberships m
    ON m.company_id = i.company_id
  WHERE m.user_id = v_uid
    AND m.membership_status = 'active'
    AND m.role IN ('owner', 'admin')
  ORDER BY i.created_at DESC
  LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_visible_partner_invitations(INTEGER) TO authenticated;

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

DROP FUNCTION IF EXISTS public.get_my_onboarding_state();

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

  SELECT *
  INTO v_membership
  FROM public.company_memberships
  WHERE user_id = v_uid
    AND membership_status = 'active'
  ORDER BY joined_at DESC NULLS LAST, created_at DESC
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

GRANT EXECUTE ON FUNCTION public.get_my_onboarding_state() TO authenticated;
