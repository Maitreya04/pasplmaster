-- Invite-code onboarding RPCs for staff phone+PIN activation.

CREATE OR REPLACE FUNCTION public.make_invite_code(p_full_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_prefix TEXT;
  v_digits TEXT;
BEGIN
  v_prefix := upper(left(regexp_replace(coalesce(p_full_name, ''), '[^a-zA-Z]', '', 'g'), 4));
  IF v_prefix = '' THEN
    v_prefix := 'USER';
  END IF;
  v_digits := lpad((floor(random() * 10000))::text, 4, '0');
  RETURN v_prefix || '-' || v_digits;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_invite_code(
  p_user_id BIGINT,
  p_actor_user_id BIGINT
)
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
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_actor_user_id AND role = 'admin' AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  SELECT id, full_name, auth_id INTO v_user
  FROM public.users
  WHERE id = p_user_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_user.auth_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_activated');
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
    'expires_at', (now() + interval '30 days')::text
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_all_invite_codes(p_actor_user_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_code TEXT;
  v_count INTEGER := 0;
  v_results JSONB := '[]'::jsonb;
  v_attempts INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_actor_user_id AND role = 'admin' AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthorized');
  END IF;

  FOR v_user IN
    SELECT id, full_name, role, stock_location_code
    FROM public.users
    WHERE is_active = true
      AND auth_id IS NULL
      AND role <> 'admin'
    ORDER BY role, full_name
  LOOP
    v_attempts := 0;
    LOOP
      v_attempts := v_attempts + 1;
      v_code := public.make_invite_code(v_user.full_name);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.users WHERE invite_code = v_code);
      IF v_attempts >= 20 THEN
        RAISE EXCEPTION 'invite_code_generation_failed for user %', v_user.id;
      END IF;
    END LOOP;

    UPDATE public.users
    SET invite_code = v_code,
        invite_code_expires_at = now() + interval '30 days'
    WHERE id = v_user.id;

    v_results := v_results || jsonb_build_object(
      'user_id', v_user.id,
      'full_name', v_user.full_name,
      'role', v_user.role,
      'branch', v_user.stock_location_code,
      'invite_code', v_code
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'count', v_count,
    'users', v_results
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_invite_code(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
BEGIN
  SELECT id, full_name, role, stock_location_code, invite_code_expires_at, auth_id
  INTO v_user
  FROM public.users
  WHERE invite_code = upper(trim(p_code))
    AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'invalid_code');
  END IF;

  IF v_user.auth_id IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'already_activated');
  END IF;

  IF v_user.invite_code_expires_at IS NULL OR v_user.invite_code_expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'code_expired');
  END IF;

  RETURN jsonb_build_object(
    'valid', true,
    'user_id', v_user.id,
    'full_name', v_user.full_name,
    'role', v_user.role,
    'branch', v_user.stock_location_code
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_user_activation_status()
RETURNS TABLE (
  id BIGINT,
  full_name TEXT,
  role TEXT,
  stock_location_code TEXT,
  phone TEXT,
  auth_id UUID,
  activated_at TIMESTAMPTZ,
  invite_code TEXT,
  invite_code_expires_at TIMESTAMPTZ,
  is_active BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    u.id,
    u.full_name,
    u.role,
    u.stock_location_code,
    u.phone,
    u.auth_id,
    u.activated_at,
    u.invite_code,
    u.invite_code_expires_at,
    u.is_active
  FROM public.users u
  WHERE u.is_active = true
  ORDER BY u.role, u.full_name;
$$;

GRANT EXECUTE ON FUNCTION public.generate_invite_code(BIGINT, BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_all_invite_codes(BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_invite_code(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_user_activation_status() TO anon, authenticated, service_role;
