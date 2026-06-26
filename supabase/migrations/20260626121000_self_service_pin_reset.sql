-- Self-service PIN reset for activated staff (forgot PIN flow).

CREATE OR REPLACE FUNCTION public.list_users_for_pin_reset()
RETURNS TABLE (
  id BIGINT,
  full_name TEXT,
  role TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.full_name, u.role
  FROM public.users u
  WHERE u.is_active = true
    AND u.auth_id IS NOT NULL
    AND u.role <> 'admin'
  ORDER BY u.full_name;
$$;

CREATE OR REPLACE FUNCTION public.generate_self_service_reset_code(p_user_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_code TEXT;
  v_attempts INTEGER := 0;
BEGIN
  SELECT id, full_name, auth_id, phone, invite_code, invite_code_expires_at
  INTO v_user
  FROM public.users
  WHERE id = p_user_id
    AND is_active = true
    AND role <> 'admin';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_user.auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_activated');
  END IF;

  IF v_user.phone IS NULL OR length(trim(v_user.phone)) <> 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'phone_not_registered');
  END IF;

  IF v_user.invite_code IS NOT NULL
     AND v_user.invite_code_expires_at IS NOT NULL
     AND v_user.invite_code_expires_at >= now() THEN
    RETURN jsonb_build_object(
      'success', true,
      'user_id', v_user.id,
      'full_name', v_user.full_name,
      'phone_last4', right(v_user.phone, 4),
      'invite_code', v_user.invite_code,
      'expires_at', v_user.invite_code_expires_at::text,
      'reused', true
    );
  END IF;

  LOOP
    v_attempts := v_attempts + 1;
    v_code := public.make_invite_code(v_user.full_name);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE invite_code = v_code);
    IF v_attempts >= 20 THEN
      RETURN jsonb_build_object('success', false, 'error', 'code_generation_failed');
    END IF;
  END LOOP;

  UPDATE public.users
  SET invite_code = v_code,
      invite_code_expires_at = now() + interval '30 days'
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'full_name', v_user.full_name,
    'phone_last4', right(v_user.phone, 4),
    'invite_code', v_code,
    'expires_at', (now() + interval '30 days')::text,
    'reused', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_reset_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
BEGIN
  SELECT id, full_name, role, stock_location_code, phone, invite_code_expires_at, auth_id
  INTO v_user
  FROM public.users
  WHERE invite_code = upper(trim(p_code))
    AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'invalid_code');
  END IF;

  IF v_user.auth_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'not_activated');
  END IF;

  IF v_user.invite_code_expires_at IS NULL OR v_user.invite_code_expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'code_expired');
  END IF;

  IF v_user.phone IS NULL OR length(trim(v_user.phone)) <> 10 THEN
    RETURN jsonb_build_object('valid', false, 'error', 'phone_not_registered');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'user_id', v_user.id,
    'full_name', v_user.full_name,
    'role', v_user.role,
    'branch', v_user.stock_location_code,
    'phone', v_user.phone,
    'auth_id', v_user.auth_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_users_for_pin_reset() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_self_service_reset_code(BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_reset_code(TEXT) TO anon, authenticated, service_role;
