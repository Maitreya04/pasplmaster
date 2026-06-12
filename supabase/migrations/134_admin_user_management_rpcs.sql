-- Admin user management RPCs: create, update, deactivate, revoke, reactivate.

CREATE TABLE IF NOT EXISTS public.user_admin_events (
  id BIGSERIAL PRIMARY KEY,
  target_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  actor_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_admin_events_target_created
  ON public.user_admin_events(target_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.assert_admin_actor(p_actor_user_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = p_actor_user_id
      AND role = 'admin'
      AND is_active = true
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_user_admin_event(
  p_target_user_id BIGINT,
  p_actor_user_id BIGINT,
  p_event_type TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_admin_events (target_user_id, actor_user_id, event_type, payload)
  VALUES (p_target_user_id, p_actor_user_id, p_event_type, COALESCE(p_payload, '{}'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_user(
  p_actor_user_id BIGINT,
  p_full_name TEXT,
  p_role TEXT,
  p_branch TEXT,
  p_station_label TEXT DEFAULT NULL,
  p_generate_invite_code BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_user_id BIGINT;
  v_code TEXT;
  v_attempts INTEGER := 0;
  v_invite_result JSONB;
BEGIN
  PERFORM public.assert_admin_actor(p_actor_user_id);

  v_full_name := trim(p_full_name);

  IF v_full_name IS NULL OR length(v_full_name) < 2 OR length(v_full_name) > 50 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_full_name');
  END IF;

  IF p_role NOT IN ('sales', 'billing', 'picking') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches
    WHERE code = p_branch AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_branch');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.users WHERE lower(full_name) = lower(v_full_name)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'duplicate_full_name');
  END IF;

  INSERT INTO public.users (
    full_name,
    role,
    stock_location_code,
    station_label,
    is_active,
    created_by_user_id
  )
  VALUES (
    v_full_name,
    p_role,
    p_branch,
    NULLIF(trim(p_station_label), ''),
    true,
    p_actor_user_id
  )
  RETURNING id INTO v_user_id;

  PERFORM public.log_user_admin_event(
    v_user_id,
    p_actor_user_id,
    'user_created',
    jsonb_build_object(
      'full_name', v_full_name,
      'role', p_role,
      'branch', p_branch,
      'station_label', NULLIF(trim(p_station_label), '')
    )
  );

  IF p_generate_invite_code THEN
    v_invite_result := public.generate_invite_code(v_user_id, p_actor_user_id);
    IF coalesce(v_invite_result->>'success', 'false') <> 'true' THEN
      RETURN jsonb_build_object(
        'success', true,
        'user_id', v_user_id,
        'full_name', v_full_name,
        'invite_error', v_invite_result->>'error'
      );
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'user_id', v_user_id,
      'full_name', v_full_name,
      'invite_code', v_invite_result->>'invite_code'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'full_name', v_full_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_user(
  p_actor_user_id BIGINT,
  p_user_id BIGINT,
  p_full_name TEXT DEFAULT NULL,
  p_role TEXT DEFAULT NULL,
  p_branch TEXT DEFAULT NULL,
  p_station_label TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
  v_full_name TEXT;
  v_changes JSONB := '{}'::jsonb;
BEGIN
  PERFORM public.assert_admin_actor(p_actor_user_id);

  SELECT id, full_name, role, stock_location_code, station_label, auth_id
  INTO v_user
  FROM public.users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_user.role = 'admin' AND p_user_id <> p_actor_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'cannot_edit_admin');
  END IF;

  IF p_full_name IS NOT NULL THEN
    v_full_name := trim(p_full_name);
    IF v_full_name = '' OR length(v_full_name) < 2 OR length(v_full_name) > 50 THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_full_name');
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.users
      WHERE lower(full_name) = lower(v_full_name)
        AND id <> p_user_id
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'duplicate_full_name');
    END IF;

    v_changes := v_changes || jsonb_build_object('full_name', v_full_name);
  END IF;

  IF p_role IS NOT NULL THEN
    IF p_role NOT IN ('sales', 'billing', 'picking') THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_role');
    END IF;
    IF v_user.role = 'admin' THEN
      RETURN jsonb_build_object('success', false, 'error', 'cannot_edit_admin');
    END IF;
    v_changes := v_changes || jsonb_build_object('role', p_role);
  END IF;

  IF p_branch IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.branches
      WHERE code = p_branch AND is_active = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_branch');
    END IF;
    v_changes := v_changes || jsonb_build_object('branch', p_branch);
  END IF;

  IF p_station_label IS NOT NULL THEN
    v_changes := v_changes || jsonb_build_object(
      'station_label',
      NULLIF(trim(p_station_label), '')
    );
  END IF;

  IF v_changes = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_changes');
  END IF;

  UPDATE public.users
  SET
    full_name = COALESCE(v_changes->>'full_name', full_name),
    role = COALESCE(v_changes->>'role', role),
    stock_location_code = COALESCE(v_changes->>'branch', stock_location_code),
    station_label = CASE
      WHEN p_station_label IS NULL THEN station_label
      ELSE NULLIF(trim(p_station_label), '')
    END
  WHERE id = p_user_id;

  PERFORM public.log_user_admin_event(
    p_user_id,
    p_actor_user_id,
    'user_updated',
    v_changes
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'requires_auth_sync', v_user.auth_id IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_deactivate_user(
  p_actor_user_id BIGINT,
  p_user_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
BEGIN
  PERFORM public.assert_admin_actor(p_actor_user_id);

  IF p_user_id = p_actor_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'cannot_deactivate_self');
  END IF;

  SELECT id, full_name, role, auth_id, is_active
  INTO v_user
  FROM public.users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_user.role = 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'cannot_deactivate_admin');
  END IF;

  IF NOT v_user.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_deactivated');
  END IF;

  UPDATE public.users
  SET
    is_active = false,
    invite_code = NULL,
    invite_code_expires_at = NULL
  WHERE id = p_user_id;

  PERFORM public.log_user_admin_event(
    p_user_id,
    p_actor_user_id,
    'user_deactivated',
    jsonb_build_object('full_name', v_user.full_name, 'auth_id', v_user.auth_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'requires_auth_cleanup', v_user.auth_id IS NOT NULL,
    'auth_id', v_user.auth_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_user_access(
  p_actor_user_id BIGINT,
  p_user_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
BEGIN
  PERFORM public.assert_admin_actor(p_actor_user_id);

  IF p_user_id = p_actor_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'cannot_revoke_self');
  END IF;

  SELECT id, full_name, role, auth_id, phone
  INTO v_user
  FROM public.users
  WHERE id = p_user_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_user.role = 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'cannot_revoke_admin');
  END IF;

  IF v_user.auth_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_activated');
  END IF;

  UPDATE public.users
  SET
    auth_id = NULL,
    phone = NULL,
    activated_at = NULL,
    invite_code = NULL,
    invite_code_expires_at = NULL
  WHERE id = p_user_id;

  PERFORM public.log_user_admin_event(
    p_user_id,
    p_actor_user_id,
    'access_revoked',
    jsonb_build_object(
      'full_name', v_user.full_name,
      'previous_phone', v_user.phone,
      'auth_id', v_user.auth_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'auth_id', v_user.auth_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reactivate_user(
  p_actor_user_id BIGINT,
  p_user_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user RECORD;
BEGIN
  PERFORM public.assert_admin_actor(p_actor_user_id);

  SELECT id, full_name, role, is_active
  INTO v_user
  FROM public.users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_user.role = 'admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'cannot_reactivate_admin');
  END IF;

  IF v_user.is_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_active');
  END IF;

  UPDATE public.users
  SET is_active = true
  WHERE id = p_user_id;

  PERFORM public.log_user_admin_event(
    p_user_id,
    p_actor_user_id,
    'user_reactivated',
    jsonb_build_object('full_name', v_user.full_name)
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'full_name', v_user.full_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_user_activation_status()
RETURNS TABLE (
  id BIGINT,
  full_name TEXT,
  role TEXT,
  stock_location_code TEXT,
  station_label TEXT,
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
    u.station_label,
    u.phone,
    u.auth_id,
    u.activated_at,
    u.invite_code,
    u.invite_code_expires_at,
    u.is_active
  FROM public.users u
  ORDER BY u.is_active DESC, u.role, u.full_name;
$$;

GRANT EXECUTE ON FUNCTION public.assert_admin_actor(BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_user_admin_event(BIGINT, BIGINT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_user(BIGINT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_user(BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_deactivate_user(BIGINT, BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revoke_user_access(BIGINT, BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reactivate_user(BIGINT, BIGINT) TO anon, authenticated, service_role;
