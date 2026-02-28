-- Fix ambiguous company_id reference in create_workspace_partner_code.
-- The RETURNS TABLE column name `company_id` can conflict with unqualified SQL references.

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

  UPDATE public.workspace_partner_codes AS codes
  SET status = 'revoked',
      updated_at = now()
  WHERE codes.company_id = v_target_company_id
    AND codes.status = 'active';

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
