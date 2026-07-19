-- Future-proof user/auth and sales target governance.
-- This migration keeps legacy columns/functions compatible while introducing
-- stable user ids, dedicated verification records, financial years, and
-- server-verified admin RPCs.

-- ---------------------------------------------------------------------------
-- Security / verification audit tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_security_events (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  target_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'info'
    CHECK (risk_level IN ('info', 'warning', 'critical')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_security_events_target_created
  ON public.user_security_events(target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_security_events_actor_created
  ON public.user_security_events(actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.user_invites (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  invite_code TEXT NOT NULL UNIQUE,
  created_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_auth_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_invites_user_created
  ON public.user_invites(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_invites_active_code
  ON public.user_invites(invite_code)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.user_pin_resets (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reset_code TEXT NOT NULL UNIQUE,
  created_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_pin_resets_user_created
  ON public.user_pin_resets(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_pin_resets_active_code
  ON public.user_pin_resets(reset_code)
  WHERE consumed_at IS NULL;

ALTER TABLE public.user_security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_pin_resets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_all ON public.user_admin_events;
DROP POLICY IF EXISTS legacy_anon_all ON public.user_admin_events;
DROP POLICY IF EXISTS user_admin_events_admin_read ON public.user_admin_events;
CREATE POLICY user_admin_events_admin_read
  ON public.user_admin_events
  FOR SELECT
  TO authenticated
  USING (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS user_security_events_admin_read ON public.user_security_events;
CREATE POLICY user_security_events_admin_read
  ON public.user_security_events
  FOR SELECT
  TO authenticated
  USING (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS user_invites_admin_read ON public.user_invites;
CREATE POLICY user_invites_admin_read
  ON public.user_invites
  FOR SELECT
  TO authenticated
  USING (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS user_pin_resets_admin_read ON public.user_pin_resets;
CREATE POLICY user_pin_resets_admin_read
  ON public.user_pin_resets
  FOR SELECT
  TO authenticated
  USING (public.current_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- Server-verified admin helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_current_admin()
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id BIGINT;
BEGIN
  SELECT u.id
  INTO v_actor_user_id
  FROM public.users u
  WHERE u.auth_id = auth.uid()
    AND u.role = 'admin'
    AND u.is_active = true;

  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN v_actor_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.log_user_security_event(
  p_actor_user_id BIGINT,
  p_target_user_id BIGINT,
  p_event_type TEXT,
  p_risk_level TEXT DEFAULT 'info',
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_security_events (
    actor_user_id,
    target_user_id,
    event_type,
    risk_level,
    metadata
  )
  VALUES (
    p_actor_user_id,
    p_target_user_id,
    p_event_type,
    COALESCE(NULLIF(p_risk_level, ''), 'info'),
    COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_admin_actor(p_actor_user_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Compatibility wrapper: the caller's Supabase session is now the proof.
  -- p_actor_user_id is intentionally ignored for authorization.
  PERFORM public.assert_current_admin();
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
DECLARE
  v_actor_user_id BIGINT;
BEGIN
  v_actor_user_id := COALESCE(p_actor_user_id, public.current_user_id());

  INSERT INTO public.user_admin_events (target_user_id, actor_user_id, event_type, payload)
  VALUES (p_target_user_id, v_actor_user_id, p_event_type, COALESCE(p_payload, '{}'::jsonb));

  PERFORM public.log_user_security_event(
    v_actor_user_id,
    p_target_user_id,
    p_event_type,
    'info',
    COALESCE(p_payload, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.make_invite_code(p_full_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
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

-- ---------------------------------------------------------------------------
-- Dedicated invite / reset records, with legacy users.invite_code mirrored
-- only for backward compatibility during rollout.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_invite_code(
  p_user_id BIGINT,
  p_actor_user_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id BIGINT;
  v_user RECORD;
  v_code TEXT;
  v_attempts INTEGER := 0;
  v_invite_id BIGINT;
BEGIN
  v_actor_user_id := public.assert_current_admin();

  SELECT id, full_name, auth_id, role
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

  LOOP
    v_attempts := v_attempts + 1;
    v_code := public.make_invite_code(v_user.full_name);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.user_invites WHERE invite_code = v_code)
      AND NOT EXISTS (SELECT 1 FROM public.users WHERE invite_code = v_code);
    IF v_attempts >= 20 THEN
      RETURN jsonb_build_object('success', false, 'error', 'code_generation_failed');
    END IF;
  END LOOP;

  UPDATE public.user_invites
  SET consumed_at = COALESCE(consumed_at, now()),
      metadata = metadata || jsonb_build_object('superseded_by', v_code)
  WHERE user_id = p_user_id
    AND consumed_at IS NULL;

  INSERT INTO public.user_invites (user_id, invite_code, created_by_user_id, expires_at)
  VALUES (p_user_id, v_code, v_actor_user_id, now() + interval '30 days')
  RETURNING id INTO v_invite_id;

  UPDATE public.users
  SET invite_code = v_code,
      invite_code_expires_at = now() + interval '30 days'
  WHERE id = p_user_id;

  PERFORM public.log_user_security_event(
    v_actor_user_id,
    p_user_id,
    'invite_generated',
    'info',
    jsonb_build_object('invite_id', v_invite_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'full_name', v_user.full_name,
    'invite_code', v_code,
    'invite_id', v_invite_id,
    'expires_at', (now() + interval '30 days')::text
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
  v_code TEXT := upper(trim(coalesce(p_code, '')));
  v_invite RECORD;
  v_user RECORD;
BEGIN
  SELECT
    i.id AS invite_id,
    i.user_id,
    i.expires_at,
    i.consumed_at,
    u.full_name,
    u.role,
    u.stock_location_code,
    u.auth_id
  INTO v_invite
  FROM public.user_invites i
  JOIN public.users u ON u.id = i.user_id
  WHERE i.invite_code = v_code
    AND u.is_active = true
  ORDER BY i.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_invite.consumed_at IS NOT NULL THEN
      RETURN jsonb_build_object('valid', false, 'error', 'code_consumed');
    END IF;
    IF v_invite.auth_id IS NOT NULL THEN
      RETURN jsonb_build_object('valid', false, 'error', 'already_activated');
    END IF;
    IF v_invite.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'error', 'code_expired');
    END IF;

    RETURN jsonb_build_object(
      'valid', true,
      'invite_id', v_invite.invite_id,
      'user_id', v_invite.user_id,
      'full_name', v_invite.full_name,
      'role', v_invite.role,
      'branch', v_invite.stock_location_code
    );
  END IF;

  SELECT id, full_name, role, stock_location_code, invite_code_expires_at, auth_id
  INTO v_user
  FROM public.users
  WHERE invite_code = v_code
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
    'branch', v_user.stock_location_code,
    'legacy_code', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_invite_code(
  p_invite_id BIGINT,
  p_auth_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_invite_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.user_invites
  SET consumed_at = now(),
      consumed_auth_id = p_auth_id
  WHERE id = p_invite_id
    AND consumed_at IS NULL;
END;
$$;

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
  v_invite_id BIGINT;
  v_invite_expires_at TIMESTAMPTZ;
BEGIN
  SELECT id, full_name, auth_id, role
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

  SELECT id, invite_code, expires_at
  INTO v_invite_id, v_code, v_invite_expires_at
  FROM public.user_invites
  WHERE user_id = p_user_id
    AND consumed_at IS NULL
    AND expires_at >= now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_invite_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'user_id', v_user.id,
      'full_name', v_user.full_name,
      'invite_code', v_code,
      'invite_id', v_invite_id,
      'expires_at', v_invite_expires_at::text,
      'reused', true
    );
  END IF;

  LOOP
    v_attempts := v_attempts + 1;
    v_code := public.make_invite_code(v_user.full_name);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.user_invites WHERE invite_code = v_code)
      AND NOT EXISTS (SELECT 1 FROM public.users WHERE invite_code = v_code);
    IF v_attempts >= 20 THEN
      RETURN jsonb_build_object('success', false, 'error', 'code_generation_failed');
    END IF;
  END LOOP;

  INSERT INTO public.user_invites (user_id, invite_code, expires_at, metadata)
  VALUES (p_user_id, v_code, now() + interval '30 days', jsonb_build_object('source', 'self_service'))
  RETURNING id INTO v_invite_id;

  UPDATE public.users
  SET invite_code = v_code,
      invite_code_expires_at = now() + interval '30 days'
  WHERE id = p_user_id;

  PERFORM public.log_user_security_event(
    NULL,
    p_user_id,
    'invite_generated',
    'warning',
    jsonb_build_object('invite_id', v_invite_id, 'source', 'self_service')
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'full_name', v_user.full_name,
    'invite_code', v_code,
    'invite_id', v_invite_id,
    'expires_at', (now() + interval '30 days')::text,
    'reused', false
  );
END;
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
  v_reset_id BIGINT;
  v_reset_expires_at TIMESTAMPTZ;
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

  SELECT id, reset_code, expires_at
  INTO v_reset_id, v_code, v_reset_expires_at
  FROM public.user_pin_resets
  WHERE user_id = p_user_id
    AND consumed_at IS NULL
    AND expires_at >= now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_reset_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'user_id', p_user_id,
      'full_name', v_user.full_name,
      'phone_last4', right(v_user.phone, 4),
      'invite_code', v_code,
      'reset_id', v_reset_id,
      'expires_at', v_reset_expires_at::text,
      'reused', true
    );
  END IF;

  LOOP
    v_attempts := v_attempts + 1;
    v_code := public.make_invite_code(v_user.full_name);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.user_pin_resets WHERE reset_code = v_code)
      AND NOT EXISTS (SELECT 1 FROM public.users WHERE invite_code = v_code);
    IF v_attempts >= 20 THEN
      RETURN jsonb_build_object('success', false, 'error', 'code_generation_failed');
    END IF;
  END LOOP;

  INSERT INTO public.user_pin_resets (user_id, reset_code, expires_at, metadata)
  VALUES (p_user_id, v_code, now() + interval '30 minutes', jsonb_build_object('source', 'self_service'))
  RETURNING id INTO v_reset_id;

  UPDATE public.users
  SET invite_code = v_code,
      invite_code_expires_at = now() + interval '30 minutes'
  WHERE id = p_user_id;

  PERFORM public.log_user_security_event(
    NULL,
    p_user_id,
    'pin_reset_code_generated',
    'warning',
    jsonb_build_object('reset_id', v_reset_id, 'source', 'self_service')
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'full_name', v_user.full_name,
    'phone_last4', right(v_user.phone, 4),
    'invite_code', v_code,
    'reset_id', v_reset_id,
    'expires_at', (now() + interval '30 minutes')::text,
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
  v_code TEXT := upper(trim(coalesce(p_code, '')));
  v_reset RECORD;
  v_user RECORD;
BEGIN
  SELECT
    r.id AS reset_id,
    r.user_id,
    r.expires_at,
    r.consumed_at,
    u.full_name,
    u.role,
    u.stock_location_code,
    u.phone,
    u.auth_id
  INTO v_reset
  FROM public.user_pin_resets r
  JOIN public.users u ON u.id = r.user_id
  WHERE r.reset_code = v_code
    AND u.is_active = true
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_reset.consumed_at IS NOT NULL THEN
      RETURN jsonb_build_object('valid', false, 'error', 'code_consumed');
    END IF;
    IF v_reset.auth_id IS NULL THEN
      RETURN jsonb_build_object('valid', false, 'error', 'not_activated');
    END IF;
    IF v_reset.expires_at < now() THEN
      RETURN jsonb_build_object('valid', false, 'error', 'code_expired');
    END IF;
    IF v_reset.phone IS NULL OR length(trim(v_reset.phone)) <> 10 THEN
      RETURN jsonb_build_object('valid', false, 'error', 'phone_not_registered');
    END IF;

    RETURN jsonb_build_object(
      'valid', true,
      'reset_id', v_reset.reset_id,
      'user_id', v_reset.user_id,
      'full_name', v_reset.full_name,
      'role', v_reset.role,
      'branch', v_reset.stock_location_code,
      'phone', v_reset.phone,
      'auth_id', v_reset.auth_id
    );
  END IF;

  SELECT id, full_name, role, stock_location_code, phone, invite_code_expires_at, auth_id
  INTO v_user
  FROM public.users
  WHERE invite_code = v_code
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
    'auth_id', v_user.auth_id,
    'legacy_code', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_reset_code(p_reset_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_reset_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.user_pin_resets
  SET consumed_at = now()
  WHERE id = p_reset_id
    AND consumed_at IS NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Harden user-management RPCs. Signatures stay compatible with the frontend;
-- authorization now derives from auth.uid().
-- ---------------------------------------------------------------------------

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
  v_actor_user_id BIGINT;
  v_full_name TEXT;
  v_user_id BIGINT;
  v_invite_result JSONB;
BEGIN
  v_actor_user_id := public.assert_current_admin();
  v_full_name := trim(p_full_name);

  IF v_full_name IS NULL OR length(v_full_name) < 2 OR length(v_full_name) > 50 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_full_name');
  END IF;

  IF p_role NOT IN ('sales', 'billing', 'picking') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_role');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE code = p_branch AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_branch');
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE lower(full_name) = lower(v_full_name)) THEN
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
    v_actor_user_id
  )
  RETURNING id INTO v_user_id;

  PERFORM public.log_user_admin_event(
    v_user_id,
    v_actor_user_id,
    'user_created',
    jsonb_build_object(
      'full_name', v_full_name,
      'role', p_role,
      'branch', p_branch,
      'station_label', NULLIF(trim(p_station_label), '')
    )
  );

  IF p_generate_invite_code THEN
    v_invite_result := public.generate_invite_code(v_user_id, v_actor_user_id);
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

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id, 'full_name', v_full_name);
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
  v_actor_user_id BIGINT;
  v_user RECORD;
  v_full_name TEXT;
  v_changes JSONB := '{}'::jsonb;
BEGIN
  v_actor_user_id := public.assert_current_admin();

  SELECT id, full_name, role, stock_location_code, station_label, auth_id
  INTO v_user
  FROM public.users
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_user.role = 'admin' AND p_user_id <> v_actor_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'cannot_edit_admin');
  END IF;

  IF p_full_name IS NOT NULL THEN
    v_full_name := trim(p_full_name);
    IF v_full_name = '' OR length(v_full_name) < 2 OR length(v_full_name) > 50 THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_full_name');
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.users
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
    IF NOT EXISTS (SELECT 1 FROM public.branches WHERE code = p_branch AND is_active = true) THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_branch');
    END IF;
    v_changes := v_changes || jsonb_build_object('branch', p_branch);
  END IF;

  IF p_station_label IS NOT NULL THEN
    v_changes := v_changes || jsonb_build_object('station_label', NULLIF(trim(p_station_label), ''));
  END IF;

  IF v_changes = '{}'::jsonb THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_changes');
  END IF;

  UPDATE public.users
  SET
    full_name = COALESCE(v_changes->>'full_name', full_name),
    role = COALESCE(v_changes->>'role', role),
    stock_location_code = COALESCE(v_changes->>'branch', stock_location_code),
    station_label = CASE WHEN p_station_label IS NULL THEN station_label ELSE NULLIF(trim(p_station_label), '') END
  WHERE id = p_user_id;

  PERFORM public.log_user_admin_event(p_user_id, v_actor_user_id, 'user_updated', v_changes);

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
  v_actor_user_id BIGINT;
  v_user RECORD;
BEGIN
  v_actor_user_id := public.assert_current_admin();

  IF p_user_id = v_actor_user_id THEN
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
  SET is_active = false,
      invite_code = NULL,
      invite_code_expires_at = NULL
  WHERE id = p_user_id;

  UPDATE public.user_invites
  SET consumed_at = COALESCE(consumed_at, now()),
      metadata = metadata || jsonb_build_object('closed_reason', 'user_deactivated')
  WHERE user_id = p_user_id AND consumed_at IS NULL;

  UPDATE public.user_pin_resets
  SET consumed_at = COALESCE(consumed_at, now()),
      metadata = metadata || jsonb_build_object('closed_reason', 'user_deactivated')
  WHERE user_id = p_user_id AND consumed_at IS NULL;

  PERFORM public.log_user_admin_event(
    p_user_id,
    v_actor_user_id,
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
  v_actor_user_id BIGINT;
  v_user RECORD;
BEGIN
  v_actor_user_id := public.assert_current_admin();

  IF p_user_id = v_actor_user_id THEN
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
  SET auth_id = NULL,
      phone = NULL,
      activated_at = NULL,
      invite_code = NULL,
      invite_code_expires_at = NULL
  WHERE id = p_user_id;

  UPDATE public.user_invites
  SET consumed_at = COALESCE(consumed_at, now()),
      metadata = metadata || jsonb_build_object('closed_reason', 'access_revoked')
  WHERE user_id = p_user_id AND consumed_at IS NULL;

  UPDATE public.user_pin_resets
  SET consumed_at = COALESCE(consumed_at, now()),
      metadata = metadata || jsonb_build_object('closed_reason', 'access_revoked')
  WHERE user_id = p_user_id AND consumed_at IS NULL;

  PERFORM public.log_user_admin_event(
    p_user_id,
    v_actor_user_id,
    'access_revoked',
    jsonb_build_object(
      'full_name', v_user.full_name,
      'previous_phone', v_user.phone,
      'auth_id', v_user.auth_id
    )
  );

  RETURN jsonb_build_object('success', true, 'user_id', p_user_id, 'auth_id', v_user.auth_id);
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
  v_actor_user_id BIGINT;
  v_user RECORD;
BEGIN
  v_actor_user_id := public.assert_current_admin();

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
    v_actor_user_id,
    'user_reactivated',
    jsonb_build_object('full_name', v_user.full_name)
  );

  RETURN jsonb_build_object('success', true, 'user_id', p_user_id, 'full_name', v_user.full_name);
END;
$$;

DROP FUNCTION IF EXISTS public.list_user_activation_status();

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
  is_active BOOLEAN,
  current_fy_target_lakhs NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id BIGINT;
  v_fy_id BIGINT;
BEGIN
  v_actor_user_id := public.assert_current_admin();

  SELECT fy.id
  INTO v_fy_id
  FROM public.financial_years fy
  WHERE fy.is_active = true
  ORDER BY fy.starts_on DESC
  LIMIT 1;

  RETURN QUERY
  SELECT
    u.id,
    u.full_name,
    u.role,
    u.stock_location_code,
    u.station_label,
    u.phone,
    u.auth_id,
    u.activated_at,
    latest_invite.invite_code,
    latest_invite.expires_at,
    u.is_active,
    COALESCE(SUM(st.annual_target_lakhs), 0)::NUMERIC AS current_fy_target_lakhs
  FROM public.users u
  LEFT JOIN LATERAL (
    SELECT i.invite_code, i.expires_at
    FROM public.user_invites i
    WHERE i.user_id = u.id
      AND i.consumed_at IS NULL
      AND i.expires_at >= now()
    ORDER BY i.created_at DESC
    LIMIT 1
  ) latest_invite ON true
  LEFT JOIN public.sales_targets st
    ON st.salesperson_user_id = u.id
   AND st.financial_year_id = v_fy_id
  GROUP BY
    u.id,
    u.full_name,
    u.role,
    u.stock_location_code,
    u.station_label,
    u.phone,
    u.auth_id,
    u.activated_at,
    latest_invite.invite_code,
    latest_invite.expires_at,
    u.is_active
  ORDER BY u.is_active DESC, u.role, u.full_name;
END;
$$;

-- ---------------------------------------------------------------------------
-- Financial years and user-linked sales targets
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.financial_years (
  id BIGSERIAL PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  history_fyear_key TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  is_locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (starts_on <= ends_on)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_years_one_active
  ON public.financial_years(is_active)
  WHERE is_active = true;

INSERT INTO public.financial_years (label, starts_on, ends_on, history_fyear_key, is_active)
VALUES
  ('2025-26', DATE '2025-04-01', DATE '2026-03-31', '2025', false),
  ('2026-27', DATE '2026-04-01', DATE '2027-03-31', '2026', true)
ON CONFLICT (label) DO UPDATE
SET starts_on = EXCLUDED.starts_on,
    ends_on = EXCLUDED.ends_on,
    history_fyear_key = EXCLUDED.history_fyear_key,
    updated_at = now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.financial_years
    WHERE is_active = true
  ) THEN
    UPDATE public.financial_years
    SET is_active = true
    WHERE label = '2026-27';
  END IF;
END $$;

ALTER TABLE public.sales_targets
  ADD COLUMN IF NOT EXISTS salesperson_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS financial_year_id BIGINT REFERENCES public.financial_years(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'legacy_import',
  ADD COLUMN IF NOT EXISTS source_file_name TEXT,
  ADD COLUMN IF NOT EXISTS import_batch_id BIGINT,
  ADD COLUMN IF NOT EXISTS created_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL;

UPDATE public.sales_targets st
SET financial_year_id = fy.id
FROM public.financial_years fy
WHERE st.financial_year_id IS NULL
  AND fy.label = st.year;

UPDATE public.sales_targets st
SET salesperson_user_id = u.id
FROM public.users u
WHERE st.salesperson_user_id IS NULL
  AND u.role = 'sales'
  AND public.normalize_salesperson_key(u.full_name) = public.normalize_salesperson_key(st.salesperson_name);

WITH ranked_targets AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY salesperson_user_id, product_group, financial_year_id
      ORDER BY updated_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.sales_targets
  WHERE salesperson_user_id IS NOT NULL
    AND financial_year_id IS NOT NULL
)
DELETE FROM public.sales_targets st
USING ranked_targets ranked
WHERE st.id = ranked.id
  AND ranked.rn > 1;

CREATE INDEX IF NOT EXISTS idx_sales_targets_user_fy
  ON public.sales_targets(salesperson_user_id, financial_year_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_targets_user_group_fy_unique
  ON public.sales_targets(salesperson_user_id, product_group, financial_year_id)
  WHERE salesperson_user_id IS NOT NULL AND financial_year_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sales_target_import_batches (
  id BIGSERIAL PRIMARY KEY,
  financial_year_id BIGINT NOT NULL REFERENCES public.financial_years(id) ON DELETE RESTRICT,
  uploaded_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  file_name TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  unmatched_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'failed', 'blocked_unmatched')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_target_import_batches_fy_created
  ON public.sales_target_import_batches(financial_year_id, created_at DESC);

ALTER TABLE public.financial_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_target_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS financial_years_read ON public.financial_years;
CREATE POLICY financial_years_read
  ON public.financial_years
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS financial_years_admin_write ON public.financial_years;
CREATE POLICY financial_years_admin_write
  ON public.financial_years
  FOR ALL
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS sales_target_import_batches_admin_read ON public.sales_target_import_batches;
CREATE POLICY sales_target_import_batches_admin_read
  ON public.sales_target_import_batches
  FOR SELECT
  TO authenticated
  USING (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS authenticated_all ON public.sales_targets;
DROP POLICY IF EXISTS legacy_anon_all ON public.sales_targets;
DROP POLICY IF EXISTS sales_targets_admin_all ON public.sales_targets;
DROP POLICY IF EXISTS sales_targets_sales_own_select ON public.sales_targets;

CREATE POLICY sales_targets_admin_all
  ON public.sales_targets
  FOR ALL
  TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE POLICY sales_targets_sales_own_select
  ON public.sales_targets
  FOR SELECT
  TO authenticated
  USING (
    salesperson_user_id = public.current_user_id()
    OR public.current_user_role() IN ('admin', 'billing')
  );

CREATE OR REPLACE FUNCTION public.get_active_financial_year()
RETURNS TABLE (
  id BIGINT,
  label TEXT,
  starts_on DATE,
  ends_on DATE,
  history_fyear_key TEXT,
  is_locked BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, label, starts_on, ends_on, history_fyear_key, is_locked
  FROM public.financial_years
  WHERE is_active = true
  ORDER BY starts_on DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_active_financial_year(p_label TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id BIGINT;
  v_fy RECORD;
BEGIN
  v_actor_user_id := public.assert_current_admin();

  SELECT * INTO v_fy
  FROM public.financial_years
  WHERE label = p_label;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'financial_year_not_found');
  END IF;

  UPDATE public.financial_years SET is_active = false WHERE is_active = true;
  UPDATE public.financial_years SET is_active = true, updated_at = now() WHERE id = v_fy.id;

  PERFORM public.log_user_security_event(
    v_actor_user_id,
    NULL,
    'active_financial_year_changed',
    'info',
    jsonb_build_object('financial_year', p_label)
  );

  RETURN jsonb_build_object('success', true, 'financial_year_id', v_fy.id, 'label', p_label);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_sales_targets(
  p_financial_year_label TEXT,
  p_rows JSONB,
  p_file_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id BIGINT;
  v_fy RECORD;
  v_row JSONB;
  v_user RECORD;
  v_unmatched JSONB := '[]'::jsonb;
  v_count INTEGER := 0;
  v_batch_id BIGINT;
  v_segment_id BIGINT;
BEGIN
  v_actor_user_id := public.assert_current_admin();

  SELECT * INTO v_fy
  FROM public.financial_years
  WHERE label = p_financial_year_label;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'financial_year_not_found');
  END IF;

  IF v_fy.is_locked THEN
    RETURN jsonb_build_object('success', false, 'error', 'financial_year_locked');
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_rows');
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_count := v_count + 1;
    SELECT id, full_name INTO v_user
    FROM public.users
    WHERE role = 'sales'
      AND is_active = true
      AND public.normalize_salesperson_key(full_name) = public.normalize_salesperson_key(v_row->>'salesperson_name')
    LIMIT 1;

    IF v_user.id IS NULL THEN
      v_unmatched := v_unmatched || jsonb_build_object(
        'salesperson_name', v_row->>'salesperson_name',
        'product_group', v_row->>'product_group',
        'annual_target_lakhs', v_row->>'annual_target_lakhs'
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_unmatched) > 0 THEN
    INSERT INTO public.sales_target_import_batches (
      financial_year_id,
      uploaded_by_user_id,
      file_name,
      row_count,
      imported_count,
      unmatched_rows,
      status
    )
    VALUES (v_fy.id, v_actor_user_id, p_file_name, v_count, 0, v_unmatched, 'blocked_unmatched')
    RETURNING id INTO v_batch_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'unmatched_salespeople',
      'batch_id', v_batch_id,
      'unmatched_rows', v_unmatched
    );
  END IF;

  INSERT INTO public.sales_target_import_batches (
    financial_year_id,
    uploaded_by_user_id,
    file_name,
    row_count,
    imported_count,
    status
  )
  VALUES (v_fy.id, v_actor_user_id, p_file_name, v_count, v_count, 'completed')
  RETURNING id INTO v_batch_id;

  -- A workbook is the source of truth for every salesperson included in it.
  -- Remove copied/manual baseline rows first so omitted categories do not linger.
  DELETE FROM public.sales_targets st
  WHERE st.financial_year_id = v_fy.id
    AND st.salesperson_user_id IN (
      SELECT DISTINCT u.id
      FROM jsonb_array_elements(p_rows) AS row_data(value)
      JOIN public.users u
        ON u.role = 'sales'
       AND u.is_active = true
       AND public.normalize_salesperson_key(u.full_name) =
           public.normalize_salesperson_key(row_data.value->>'salesperson_name')
    );

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    SELECT id, full_name INTO v_user
    FROM public.users
    WHERE role = 'sales'
      AND is_active = true
      AND public.normalize_salesperson_key(full_name) = public.normalize_salesperson_key(v_row->>'salesperson_name')
    LIMIT 1;

    SELECT id INTO v_segment_id
    FROM public.sales_segments
    WHERE normalized_name = public.normalize_sales_dimension(v_row->>'product_group')
    LIMIT 1;

    IF v_segment_id IS NULL THEN
      INSERT INTO public.sales_segments(name)
      VALUES (trim(v_row->>'product_group'))
      ON CONFLICT (normalized_name) DO UPDATE SET updated_at = now()
      RETURNING id INTO v_segment_id;
    END IF;

    -- Busy stores several Lucas groups separately while the plan governs one
    -- combined Lucas target.
    IF public.normalize_sales_dimension(v_row->>'product_group') = 'lucas' THEN
      UPDATE public.sales_segment_members
      SET sales_segment_id = v_segment_id
      WHERE financial_year_id = v_fy.id
        AND normalized_source_group LIKE 'lucas%';
    END IF;

    INSERT INTO public.sales_targets (
      salesperson_name,
      salesperson_user_id,
      product_group,
      sales_segment_id,
      year,
      financial_year_id,
      annual_target_lakhs,
      category,
      source_type,
      source_file_name,
      import_batch_id,
      created_by_user_id,
      updated_by_user_id,
      updated_at
    )
    VALUES (
      v_user.full_name,
      v_user.id,
      trim(v_row->>'product_group'),
      v_segment_id,
      v_fy.label,
      v_fy.id,
      (v_row->>'annual_target_lakhs')::NUMERIC,
      NULLIF(trim(COALESCE(v_row->>'category', '')), ''),
      'import',
      p_file_name,
      v_batch_id,
      v_actor_user_id,
      v_actor_user_id,
      now()
    )
    ON CONFLICT (salesperson_user_id, product_group, financial_year_id)
    WHERE salesperson_user_id IS NOT NULL AND financial_year_id IS NOT NULL
    DO UPDATE SET
      salesperson_name = EXCLUDED.salesperson_name,
      sales_segment_id = EXCLUDED.sales_segment_id,
      year = EXCLUDED.year,
      annual_target_lakhs = EXCLUDED.annual_target_lakhs,
      category = EXCLUDED.category,
      source_type = EXCLUDED.source_type,
      source_file_name = EXCLUDED.source_file_name,
      import_batch_id = EXCLUDED.import_batch_id,
      updated_by_user_id = EXCLUDED.updated_by_user_id,
      updated_at = now();
  END LOOP;

  PERFORM public.log_user_security_event(
    v_actor_user_id,
    NULL,
    'sales_targets_imported',
    'info',
    jsonb_build_object('financial_year', v_fy.label, 'batch_id', v_batch_id, 'row_count', v_count)
  );

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'financial_year_id', v_fy.id,
    'financial_year', v_fy.label,
    'processed', v_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_sales_targets_for_user(
  p_user_id BIGINT,
  p_financial_year_label TEXT DEFAULT NULL
)
RETURNS TABLE (
  product_group TEXT,
  annual_target_lakhs NUMERIC,
  category TEXT,
  financial_year_label TEXT,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id BIGINT;
BEGIN
  v_actor_user_id := public.assert_current_admin();

  RETURN QUERY
  SELECT
    st.product_group,
    st.annual_target_lakhs,
    st.category,
    fy.label,
    st.updated_at
  FROM public.sales_targets st
  JOIN public.financial_years fy ON fy.id = st.financial_year_id
  WHERE st.salesperson_user_id = p_user_id
    AND (p_financial_year_label IS NULL OR fy.label = p_financial_year_label)
  ORDER BY fy.starts_on DESC, st.product_group;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_copy_sales_targets_previous_year(
  p_user_id BIGINT,
  p_from_financial_year_label TEXT,
  p_to_financial_year_label TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id BIGINT;
  v_from_fy RECORD;
  v_to_fy RECORD;
  v_count INTEGER := 0;
BEGIN
  v_actor_user_id := public.assert_current_admin();

  SELECT * INTO v_from_fy FROM public.financial_years WHERE label = p_from_financial_year_label;
  SELECT * INTO v_to_fy FROM public.financial_years WHERE label = p_to_financial_year_label;

  IF v_from_fy.id IS NULL OR v_to_fy.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'financial_year_not_found');
  END IF;
  IF v_to_fy.is_locked THEN
    RETURN jsonb_build_object('success', false, 'error', 'financial_year_locked');
  END IF;

  INSERT INTO public.sales_targets (
    salesperson_name,
    salesperson_user_id,
    product_group,
    year,
    financial_year_id,
    annual_target_lakhs,
    category,
    source_type,
    created_by_user_id,
    updated_by_user_id,
    updated_at
  )
  SELECT
    u.full_name,
    st.salesperson_user_id,
    st.product_group,
    v_to_fy.label,
    v_to_fy.id,
    st.annual_target_lakhs,
    st.category,
    'copy_previous_year',
    v_actor_user_id,
    v_actor_user_id,
    now()
  FROM public.sales_targets st
  JOIN public.users u ON u.id = st.salesperson_user_id
  WHERE st.salesperson_user_id = p_user_id
    AND st.financial_year_id = v_from_fy.id
  ON CONFLICT (salesperson_user_id, product_group, financial_year_id)
  WHERE salesperson_user_id IS NOT NULL AND financial_year_id IS NOT NULL
  DO UPDATE SET
    annual_target_lakhs = EXCLUDED.annual_target_lakhs,
    category = EXCLUDED.category,
    source_type = EXCLUDED.source_type,
    updated_by_user_id = EXCLUDED.updated_by_user_id,
    updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM public.log_user_security_event(
    v_actor_user_id,
    p_user_id,
    'sales_targets_copied_previous_year',
    'info',
    jsonb_build_object('from', p_from_financial_year_label, 'to', p_to_financial_year_label, 'row_count', v_count)
  );

  RETURN jsonb_build_object('success', true, 'copied', v_count);
END;
$$;

-- Least-privilege execute grants for new and hardened APIs.
REVOKE EXECUTE ON FUNCTION public.assert_current_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_user_security_event(BIGINT, BIGINT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_user_activation_status() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_create_user(BIGINT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_update_user(BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_deactivate_user(BIGINT, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_revoke_user_access(BIGINT, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_reactivate_user(BIGINT, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_invite_code(BIGINT, BIGINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_active_financial_year(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_upsert_sales_targets(TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_sales_targets_for_user(BIGINT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_copy_sales_targets_previous_year(BIGINT, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.assert_current_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_user_security_event(BIGINT, BIGINT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_user_activation_status() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_user(BIGINT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_user(BIGINT, BIGINT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_deactivate_user(BIGINT, BIGINT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_revoke_user_access(BIGINT, BIGINT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reactivate_user(BIGINT, BIGINT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_invite_code(BIGINT, BIGINT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_financial_year() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_active_financial_year(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_upsert_sales_targets(TEXT, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_sales_targets_for_user(BIGINT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_copy_sales_targets_previous_year(BIGINT, TEXT, TEXT) TO authenticated, service_role;

-- Public activation/reset validation remains callable through Edge Functions
-- and existing unauthenticated screens, but the records are now one-purpose.
GRANT EXECUTE ON FUNCTION public.validate_invite_code(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_invite_code(BIGINT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_self_service_reset_code(BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_reset_code(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_reset_code(BIGINT) TO service_role;
