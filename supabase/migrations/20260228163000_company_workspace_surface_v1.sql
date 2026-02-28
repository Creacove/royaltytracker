-- Company workspace surface for directory + company profile management.

CREATE OR REPLACE FUNCTION public.list_my_company_members()
RETURNS TABLE (
  member_user_id UUID,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  job_title TEXT,
  phone TEXT,
  role TEXT,
  membership_status TEXT,
  joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_company_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT m.company_id
  INTO v_company_id
  FROM public.company_memberships m
  WHERE m.user_id = v_uid
    AND m.membership_status = 'active'
  ORDER BY m.joined_at DESC NULLS LAST, m.created_at DESC
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    m.user_id,
    coalesce(au.email, lower(coalesce(u.email, ''))) AS email,
    au.first_name,
    au.last_name,
    au.job_title,
    au.phone,
    m.role,
    m.membership_status,
    m.joined_at
  FROM public.company_memberships m
  LEFT JOIN public.app_users au
    ON au.id = m.user_id
  LEFT JOIN auth.users u
    ON u.id = m.user_id
  WHERE m.company_id = v_company_id
  ORDER BY
    CASE m.role
      WHEN 'owner' THEN 1
      WHEN 'admin' THEN 2
      WHEN 'member' THEN 3
      ELSE 4
    END,
    coalesce(au.last_name, ''),
    coalesce(au.first_name, ''),
    coalesce(au.email, lower(coalesce(u.email, '')));
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_my_company_members() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_my_company_invitations(
  p_limit INTEGER DEFAULT 100
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
  v_company_id UUID;
  v_membership_role TEXT;
  v_limit INTEGER := GREATEST(1, LEAST(coalesce(p_limit, 100), 300));
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT m.company_id, m.role
  INTO v_company_id, v_membership_role
  FROM public.company_memberships m
  WHERE m.user_id = v_uid
    AND m.membership_status = 'active'
  ORDER BY m.joined_at DESC NULLS LAST, m.created_at DESC
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RETURN;
  END IF;

  IF v_membership_role NOT IN ('owner', 'admin') AND NOT public.is_platform_admin(v_uid) THEN
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
  LEFT JOIN public.partner_companies c
    ON c.id = i.company_id
  WHERE i.company_id = v_company_id
  ORDER BY i.created_at DESC
  LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_my_company_invitations(INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_my_company_profile(
  p_company_name TEXT DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_country_code TEXT DEFAULT NULL,
  p_default_currency TEXT DEFAULT NULL,
  p_timezone TEXT DEFAULT NULL,
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
  v_company_id UUID;
  v_membership_role TEXT;
  v_company_name TEXT := nullif(trim(coalesce(p_company_name, '')), '');
  v_website TEXT := nullif(trim(coalesce(p_website, '')), '');
  v_country_code TEXT := nullif(upper(trim(coalesce(p_country_code, ''))), '');
  v_default_currency TEXT := upper(left(coalesce(nullif(trim(coalesce(p_default_currency, '')), ''), 'USD'), 3));
  v_timezone TEXT := coalesce(nullif(trim(coalesce(p_timezone, '')), ''), 'UTC');
  v_monthly_statement_volume TEXT := nullif(trim(coalesce(p_monthly_statement_volume, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT m.company_id, m.role
  INTO v_company_id, v_membership_role
  FROM public.company_memberships m
  WHERE m.user_id = v_uid
    AND m.membership_status = 'active'
  ORDER BY m.joined_at DESC NULLS LAST, m.created_at DESC
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No active company workspace found';
  END IF;

  IF v_membership_role NOT IN ('owner', 'admin') AND NOT public.is_platform_admin(v_uid) THEN
    RAISE EXCEPTION 'Only owner/admin can update company profile';
  END IF;

  IF p_primary_cmo_count IS NOT NULL AND p_primary_cmo_count < 0 THEN
    RAISE EXCEPTION 'p_primary_cmo_count must be >= 0';
  END IF;

  UPDATE public.partner_companies
  SET company_name = coalesce(v_company_name, company_name),
      website = coalesce(v_website, website),
      country_code = coalesce(v_country_code, country_code),
      default_currency = coalesce(v_default_currency, default_currency),
      timezone = coalesce(v_timezone, timezone),
      monthly_statement_volume = coalesce(v_monthly_statement_volume, monthly_statement_volume),
      primary_cmo_count = coalesce(p_primary_cmo_count, primary_cmo_count),
      updated_at = now()
  WHERE id = v_company_id;

  RETURN v_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_my_company_profile(
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INTEGER
) TO authenticated;
