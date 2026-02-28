-- Partner invite-only onboarding foundation.

CREATE TABLE IF NOT EXISTS public.partner_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  legal_name TEXT,
  website TEXT,
  country_code TEXT,
  default_currency TEXT NOT NULL DEFAULT 'USD',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  monthly_statement_volume TEXT,
  primary_cmo_count INTEGER,
  onboarding_stage TEXT NOT NULL DEFAULT 'not_started'
    CHECK (onboarding_stage IN ('not_started', 'in_progress', 'completed')),
  onboarding_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  job_title TEXT,
  phone TEXT,
  onboarding_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.company_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.partner_companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  membership_status TEXT NOT NULL DEFAULT 'invited'
    CHECK (membership_status IN ('invited', 'active', 'suspended')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_email TEXT,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.partner_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.partner_companies(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_memberships_user_status
  ON public.company_memberships (user_id, membership_status);

CREATE INDEX IF NOT EXISTS idx_company_memberships_company_status
  ON public.company_memberships (company_id, membership_status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_invitations_pending_email
  ON public.partner_invitations ((lower(email)))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_partner_invitations_company_status
  ON public.partner_invitations (company_id, status);

DROP TRIGGER IF EXISTS update_partner_companies_updated_at ON public.partner_companies;
CREATE TRIGGER update_partner_companies_updated_at
BEFORE UPDATE ON public.partner_companies
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_app_users_updated_at ON public.app_users;
CREATE TRIGGER update_app_users_updated_at
BEFORE UPDATE ON public.app_users
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_company_memberships_updated_at ON public.company_memberships;
CREATE TRIGGER update_company_memberships_updated_at
BEFORE UPDATE ON public.company_memberships
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_partner_invitations_updated_at ON public.partner_invitations;
CREATE TRIGGER update_partner_invitations_updated_at
BEFORE UPDATE ON public.partner_invitations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.upsert_app_user_from_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.app_users (id, email, created_at, updated_at)
  VALUES (NEW.id, lower(coalesce(NEW.email, '')), now(), now())
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_upsert_app_user ON auth.users;
CREATE TRIGGER on_auth_user_created_upsert_app_user
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.upsert_app_user_from_auth();

INSERT INTO public.app_users (id, email, created_at, updated_at)
SELECT id, lower(coalesce(email, '')), now(), now()
FROM auth.users
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      updated_at = now();

ALTER TABLE public.partner_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own app user profile" ON public.app_users;
CREATE POLICY "Users can view their own app user profile"
ON public.app_users FOR SELECT
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own app user profile" ON public.app_users;
CREATE POLICY "Users can update their own app user profile"
ON public.app_users FOR UPDATE
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can view their own memberships" ON public.company_memberships;
CREATE POLICY "Users can view their own memberships"
ON public.company_memberships FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Members can view their companies" ON public.partner_companies;
CREATE POLICY "Members can view their companies"
ON public.partner_companies FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.company_memberships m
    WHERE m.company_id = partner_companies.id
      AND m.user_id = auth.uid()
      AND m.membership_status = 'active'
  )
);

DROP POLICY IF EXISTS "Invited users can view pending invitations" ON public.partner_invitations;
CREATE POLICY "Invited users can view pending invitations"
ON public.partner_invitations FOR SELECT
USING (
  status = 'pending'
  AND lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

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
BEGIN
  IF v_clean_email = '' THEN
    RAISE EXCEPTION 'Invitation email is required';
  END IF;

  IF v_clean_role NOT IN ('owner', 'admin', 'member', 'viewer') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  IF p_expires_in_days < 1 OR p_expires_in_days > 60 THEN
    RAISE EXCEPTION 'p_expires_in_days must be between 1 and 60';
  END IF;

  IF v_uid IS NOT NULL AND v_company_id IS NOT NULL THEN
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

  IF v_company_id IS NULL THEN
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

    IF v_uid IS NOT NULL THEN
      INSERT INTO public.company_memberships (
        company_id,
        user_id,
        role,
        membership_status,
        invited_by,
        invited_email,
        invited_at,
        joined_at,
        created_at,
        updated_at
      )
      VALUES (
        v_company_id,
        v_uid,
        'owner',
        'active',
        v_uid,
        v_clean_email,
        now(),
        now(),
        now(),
        now()
      )
      ON CONFLICT (company_id, user_id) DO UPDATE
        SET role = 'owner',
            membership_status = 'active',
            joined_at = coalesce(public.company_memberships.joined_at, now()),
            updated_at = now();
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

CREATE OR REPLACE FUNCTION public.get_my_onboarding_state()
RETURNS TABLE (
  onboarding_complete BOOLEAN,
  has_active_membership BOOLEAN,
  has_pending_invitation BOOLEAN,
  pending_invitation_role TEXT,
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
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

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

CREATE OR REPLACE FUNCTION public.complete_partner_onboarding(
  p_first_name TEXT,
  p_last_name TEXT,
  p_job_title TEXT,
  p_phone TEXT DEFAULT NULL,
  p_company_name TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_country_code TEXT DEFAULT NULL,
  p_default_currency TEXT DEFAULT 'USD',
  p_timezone TEXT DEFAULT 'UTC',
  p_monthly_statement_volume TEXT DEFAULT NULL,
  p_primary_cmo_count INTEGER DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_first_name TEXT := nullif(trim(coalesce(p_first_name, '')), '');
  v_last_name TEXT := nullif(trim(coalesce(p_last_name, '')), '');
  v_job_title TEXT := nullif(trim(coalesce(p_job_title, '')), '');
  v_phone TEXT := nullif(trim(coalesce(p_phone, '')), '');
  v_company_name TEXT := nullif(trim(coalesce(p_company_name, '')), '');
  v_website TEXT := nullif(trim(coalesce(p_website, '')), '');
  v_country_code TEXT := nullif(upper(trim(coalesce(p_country_code, ''))), '');
  v_default_currency TEXT := upper(left(coalesce(nullif(trim(coalesce(p_default_currency, '')), ''), 'USD'), 3));
  v_timezone TEXT := coalesce(nullif(trim(coalesce(p_timezone, '')), ''), 'UTC');
  v_monthly_statement_volume TEXT := nullif(trim(coalesce(p_monthly_statement_volume, '')), '');
  v_membership public.company_memberships%ROWTYPE;
  v_invite public.partner_invitations%ROWTYPE;
  v_company_id UUID;
  v_effective_role TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF v_email = '' THEN
    RAISE EXCEPTION 'Authenticated user email is missing';
  END IF;

  IF v_first_name IS NULL OR v_last_name IS NULL OR v_job_title IS NULL THEN
    RAISE EXCEPTION 'First name, last name, and job title are required';
  END IF;

  IF p_primary_cmo_count IS NOT NULL AND p_primary_cmo_count < 0 THEN
    RAISE EXCEPTION 'p_primary_cmo_count must be >= 0';
  END IF;

  INSERT INTO public.app_users (
    id,
    email,
    first_name,
    last_name,
    job_title,
    phone,
    onboarding_completed_at,
    created_at,
    updated_at
  )
  VALUES (
    v_uid,
    v_email,
    v_first_name,
    v_last_name,
    v_job_title,
    v_phone,
    now(),
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        job_title = EXCLUDED.job_title,
        phone = EXCLUDED.phone,
        onboarding_completed_at = now(),
        updated_at = now();

  SELECT *
  INTO v_membership
  FROM public.company_memberships
  WHERE user_id = v_uid
    AND membership_status = 'active'
  ORDER BY joined_at DESC NULLS LAST, created_at DESC
  LIMIT 1;

  IF v_membership.id IS NOT NULL THEN
    v_company_id := v_membership.company_id;
    v_effective_role := v_membership.role;
  ELSE
    SELECT *
    INTO v_invite
    FROM public.partner_invitations
    WHERE lower(email) = v_email
      AND status = 'pending'
      AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_invite.id IS NOT NULL THEN
      v_company_id := v_invite.company_id;
      v_effective_role := v_invite.role;

      IF v_company_id IS NULL THEN
        IF v_company_name IS NULL THEN
          RAISE EXCEPTION 'Company name is required';
        END IF;

        INSERT INTO public.partner_companies (
          company_name,
          website,
          country_code,
          default_currency,
          timezone,
          monthly_statement_volume,
          primary_cmo_count,
          onboarding_stage,
          onboarding_completed_at,
          created_at,
          updated_at
        )
        VALUES (
          v_company_name,
          v_website,
          v_country_code,
          v_default_currency,
          v_timezone,
          v_monthly_statement_volume,
          p_primary_cmo_count,
          'completed',
          now(),
          now(),
          now()
        )
        RETURNING id INTO v_company_id;

        UPDATE public.partner_invitations
        SET company_id = v_company_id,
            updated_at = now()
        WHERE id = v_invite.id;
      END IF;

      INSERT INTO public.company_memberships (
        company_id,
        user_id,
        role,
        membership_status,
        invited_by,
        invited_email,
        invited_at,
        joined_at,
        created_at,
        updated_at
      )
      VALUES (
        v_company_id,
        v_uid,
        coalesce(v_effective_role, 'member'),
        'active',
        v_invite.invited_by,
        v_invite.email,
        coalesce(v_invite.created_at, now()),
        now(),
        now(),
        now()
      )
      ON CONFLICT (company_id, user_id) DO UPDATE
        SET role = EXCLUDED.role,
            membership_status = 'active',
            joined_at = coalesce(public.company_memberships.joined_at, now()),
            updated_at = now();

      UPDATE public.partner_invitations
      SET status = 'accepted',
          accepted_by = v_uid,
          accepted_at = now(),
          updated_at = now()
      WHERE id = v_invite.id;
    ELSE
      IF v_company_name IS NULL THEN
        RAISE EXCEPTION 'No active invitation found. Company name is required for first-time setup.';
      END IF;

      INSERT INTO public.partner_companies (
        company_name,
        website,
        country_code,
        default_currency,
        timezone,
        monthly_statement_volume,
        primary_cmo_count,
        onboarding_stage,
        onboarding_completed_at,
        created_at,
        updated_at
      )
      VALUES (
        v_company_name,
        v_website,
        v_country_code,
        v_default_currency,
        v_timezone,
        v_monthly_statement_volume,
        p_primary_cmo_count,
        'completed',
        now(),
        now(),
        now()
      )
      RETURNING id INTO v_company_id;

      v_effective_role := 'owner';

      INSERT INTO public.company_memberships (
        company_id,
        user_id,
        role,
        membership_status,
        invited_by,
        invited_email,
        invited_at,
        joined_at,
        created_at,
        updated_at
      )
      VALUES (
        v_company_id,
        v_uid,
        'owner',
        'active',
        v_uid,
        v_email,
        now(),
        now(),
        now(),
        now()
      )
      ON CONFLICT (company_id, user_id) DO UPDATE
        SET role = 'owner',
            membership_status = 'active',
            joined_at = coalesce(public.company_memberships.joined_at, now()),
            updated_at = now();
    END IF;
  END IF;

  IF v_effective_role IN ('owner', 'admin') THEN
    UPDATE public.partner_companies
    SET company_name = coalesce(v_company_name, company_name),
        website = coalesce(v_website, website),
        country_code = coalesce(v_country_code, country_code),
        default_currency = v_default_currency,
        timezone = v_timezone,
        monthly_statement_volume = coalesce(v_monthly_statement_volume, monthly_statement_volume),
        primary_cmo_count = coalesce(p_primary_cmo_count, primary_cmo_count),
        onboarding_stage = 'completed',
        onboarding_completed_at = coalesce(onboarding_completed_at, now()),
        updated_at = now()
    WHERE id = v_company_id;
  ELSE
    UPDATE public.partner_companies
    SET onboarding_stage = 'completed',
        onboarding_completed_at = coalesce(onboarding_completed_at, now()),
        updated_at = now()
    WHERE id = v_company_id;
  END IF;

  RETURN v_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_partner_onboarding(
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INTEGER
) TO authenticated;
