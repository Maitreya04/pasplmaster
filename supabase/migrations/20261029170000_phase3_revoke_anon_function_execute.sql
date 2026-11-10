-- Phase 3: redesign self-service codes (never return to anon) + revoke anon EXECUTE.
-- Whitelist only pre-login RPCs. Never revoke service_role. Manual apply only.

DROP FUNCTION IF EXISTS public.generate_self_service_reset_code(BIGINT);

CREATE OR REPLACE FUNCTION public.generate_self_service_reset_code(p_user_id BIGINT, p_phone TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user RECORD; v_code TEXT; v_attempts INT := 0; v_reset_id BIGINT; v_expires TIMESTAMPTZ;
  v_phone TEXT := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10);
BEGIN
  SELECT id, full_name, auth_id, phone INTO v_user FROM public.users
  WHERE id = p_user_id AND is_active AND role <> 'admin';
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'user_not_found'); END IF;
  IF v_user.auth_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_activated'); END IF;
  IF v_user.phone IS NULL OR length(trim(v_user.phone)) <> 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'phone_not_registered');
  END IF;
  IF v_phone IS DISTINCT FROM trim(v_user.phone) THEN
    RETURN jsonb_build_object('success', false, 'error', 'phone_mismatch');
  END IF;

  SELECT id, reset_code, expires_at INTO v_reset_id, v_code, v_expires
  FROM public.user_pin_resets
  WHERE user_id = p_user_id AND consumed_at IS NULL AND expires_at >= now()
  ORDER BY created_at DESC LIMIT 1;

  IF v_reset_id IS NULL THEN
    LOOP
      v_attempts := v_attempts + 1;
      v_code := public.make_invite_code(v_user.full_name);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.user_pin_resets WHERE reset_code = v_code)
        AND NOT EXISTS (SELECT 1 FROM public.users WHERE invite_code = v_code);
      IF v_attempts >= 20 THEN RETURN jsonb_build_object('success', false, 'error', 'code_generation_failed'); END IF;
    END LOOP;
    INSERT INTO public.user_pin_resets (user_id, reset_code, expires_at, metadata)
    VALUES (p_user_id, v_code, now() + interval '30 minutes', jsonb_build_object('source', 'self_service'))
    RETURNING id, expires_at INTO v_reset_id, v_expires;
    UPDATE public.users SET invite_code = v_code, invite_code_expires_at = v_expires WHERE id = p_user_id;
    PERFORM public.log_user_security_event(NULL, p_user_id, 'pin_reset_code_generated', 'warning',
      jsonb_build_object('reset_id', v_reset_id, 'source', 'self_service'));
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'user_id', p_user_id, 'full_name', v_user.full_name,
    'phone_last4', right(v_user.phone, 4), 'reset_id', v_reset_id,
    'expires_at', v_expires::text, 'code_delivery', 'ask_manager', 'reused', v_attempts = 0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_self_service_invite_code(p_user_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user RECORD; v_code TEXT; v_attempts INT := 0; v_invite_id BIGINT; v_expires TIMESTAMPTZ;
BEGIN
  SELECT id, full_name, auth_id INTO v_user FROM public.users
  WHERE id = p_user_id AND is_active AND role <> 'admin';
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'user_not_found'); END IF;
  IF v_user.auth_id IS NOT NULL THEN RETURN jsonb_build_object('success', false, 'error', 'already_activated'); END IF;

  SELECT id, invite_code, expires_at INTO v_invite_id, v_code, v_expires
  FROM public.user_invites
  WHERE user_id = p_user_id AND consumed_at IS NULL AND expires_at >= now()
  ORDER BY created_at DESC LIMIT 1;

  IF v_invite_id IS NULL THEN
    LOOP
      v_attempts := v_attempts + 1;
      v_code := public.make_invite_code(v_user.full_name);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.user_invites WHERE invite_code = v_code)
        AND NOT EXISTS (SELECT 1 FROM public.users WHERE invite_code = v_code);
      IF v_attempts >= 20 THEN RETURN jsonb_build_object('success', false, 'error', 'code_generation_failed'); END IF;
    END LOOP;
    INSERT INTO public.user_invites (user_id, invite_code, expires_at, metadata)
    VALUES (p_user_id, v_code, now() + interval '30 days', jsonb_build_object('source', 'self_service'))
    RETURNING id, expires_at INTO v_invite_id, v_expires;
    UPDATE public.users SET invite_code = v_code, invite_code_expires_at = v_expires WHERE id = p_user_id;
    PERFORM public.log_user_security_event(NULL, p_user_id, 'invite_generated', 'warning',
      jsonb_build_object('invite_id', v_invite_id, 'source', 'self_service'));
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'user_id', p_user_id, 'full_name', v_user.full_name,
    'invite_id', v_invite_id, 'expires_at', v_expires::text,
    'code_delivery', 'ask_manager', 'reused', v_attempts = 0
  );
END;
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %I.%I(%s) FROM anon, PUBLIC', r.nspname, r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.%I(%s) TO authenticated, service_role', r.nspname, r.proname, r.args);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.list_users_for_pin_reset() TO anon;
GRANT EXECUTE ON FUNCTION public.generate_self_service_reset_code(BIGINT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.list_pending_onboarding_users() TO anon;
GRANT EXECUTE ON FUNCTION public.generate_self_service_invite_code(BIGINT) TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, PUBLIC;
