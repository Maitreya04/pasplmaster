-- Self-service invite code generation for /get-started onboarding flow.
-- Allows unactivated staff to generate (or reuse) their verification code without admin action.

CREATE OR REPLACE FUNCTION public.generate_self_service_invite_code(p_user_id BIGINT)
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
  SELECT id, full_name, auth_id, invite_code, invite_code_expires_at
  INTO v_user
  FROM public.users
  WHERE id = p_user_id
    AND is_active = true
    AND role <> 'admin';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_user.auth_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_activated');
  END IF;

  IF v_user.invite_code IS NOT NULL
     AND v_user.invite_code_expires_at IS NOT NULL
     AND v_user.invite_code_expires_at >= now() THEN
    RETURN jsonb_build_object(
      'success', true,
      'user_id', v_user.id,
      'full_name', v_user.full_name,
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
    'invite_code', v_code,
    'expires_at', (now() + interval '30 days')::text,
    'reused', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_pending_onboarding_users()
RETURNS TABLE (
  id BIGINT,
  full_name TEXT,
  role TEXT,
  stock_location_code TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.full_name, u.role, u.stock_location_code
  FROM public.users u
  WHERE u.is_active = true
    AND u.auth_id IS NULL
    AND u.role <> 'admin'
  ORDER BY u.full_name;
$$;

GRANT EXECUTE ON FUNCTION public.generate_self_service_invite_code(BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_pending_onboarding_users() TO anon, authenticated, service_role;
