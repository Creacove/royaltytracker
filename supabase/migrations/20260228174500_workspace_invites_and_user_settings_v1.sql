-- Workspace invite link persistence + user settings support.

ALTER TABLE public.partner_invitations
ADD COLUMN IF NOT EXISTS latest_invite_link TEXT,
ADD COLUMN IF NOT EXISTS latest_invite_link_generated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS auth_delivery_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS auth_delivery_error TEXT;

UPDATE public.partner_invitations
SET auth_delivery_status = 'pending'
WHERE auth_delivery_status IS NULL;

ALTER TABLE public.partner_invitations
DROP CONSTRAINT IF EXISTS partner_invitations_auth_delivery_status_check;

ALTER TABLE public.partner_invitations
ADD CONSTRAINT partner_invitations_auth_delivery_status_check
CHECK (
  auth_delivery_status IN (
    'pending',
    'email_sent',
    'already_exists',
    'manual_link_ready',
    'email_failed_link_failed'
  )
);

ALTER TABLE public.partner_invitations
ALTER COLUMN auth_delivery_status SET DEFAULT 'pending';

ALTER TABLE public.partner_invitations
ALTER COLUMN auth_delivery_status SET NOT NULL;

DROP POLICY IF EXISTS "Users can insert their own app user profile" ON public.app_users;
CREATE POLICY "Users can insert their own app user profile"
ON public.app_users FOR INSERT
WITH CHECK (auth.uid() = id);

DROP FUNCTION IF EXISTS public.list_visible_partner_invitations(INTEGER);
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
  accepted_at TIMESTAMPTZ,
  latest_invite_link TEXT,
  latest_invite_link_generated_at TIMESTAMPTZ,
  auth_delivery_status TEXT,
  auth_delivery_error TEXT
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
      i.accepted_at,
      i.latest_invite_link,
      i.latest_invite_link_generated_at,
      i.auth_delivery_status,
      i.auth_delivery_error
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
    i.accepted_at,
    i.latest_invite_link,
    i.latest_invite_link_generated_at,
    i.auth_delivery_status,
    i.auth_delivery_error
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

DROP FUNCTION IF EXISTS public.list_my_company_invitations(INTEGER);
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
  accepted_at TIMESTAMPTZ,
  latest_invite_link TEXT,
  latest_invite_link_generated_at TIMESTAMPTZ,
  auth_delivery_status TEXT,
  auth_delivery_error TEXT
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
    i.accepted_at,
    i.latest_invite_link,
    i.latest_invite_link_generated_at,
    i.auth_delivery_status,
    i.auth_delivery_error
  FROM public.partner_invitations i
  LEFT JOIN public.partner_companies c
    ON c.id = i.company_id
  WHERE i.company_id = v_company_id
  ORDER BY i.created_at DESC
  LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_my_company_invitations(INTEGER) TO authenticated;
