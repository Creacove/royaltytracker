DO $$
DECLARE
  v_target_email TEXT := lower('shitobenzy+5@gmail.com');
  v_target_user_id UUID;
  v_granted_by UUID;
BEGIN
  SELECT id
  INTO v_target_user_id
  FROM auth.users
  WHERE lower(coalesce(email, '')) = v_target_email
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Cannot grant platform admin. Auth user for % was not found.', v_target_email;
  END IF;

  SELECT user_id
  INTO v_granted_by
  FROM public.platform_admins
  ORDER BY created_at ASC
  LIMIT 1;

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
    v_target_email,
    coalesce(v_granted_by, v_target_user_id),
    'Manual grant for partner onboarding operations',
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE
    SET email = EXCLUDED.email,
        granted_by = EXCLUDED.granted_by,
        notes = EXCLUDED.notes,
        updated_at = now();
END;
$$;
