-- Register a browser push subscription without weakening table RLS.
-- A Web Push endpoint survives app-user sign-out, so a shared device may need
-- to transfer its existing endpoint to the next authenticated user. The
-- transfer is allowed only when the unguessable local device id also matches.

CREATE OR REPLACE FUNCTION public.sync_push_subscription(
  p_device_id TEXT,
  p_endpoint TEXT,
  p_p256dh TEXT,
  p_auth TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_existing public.push_subscriptions%ROWTYPE;
BEGIN
  SELECT *
  INTO v_user
  FROM public.users
  WHERE auth_id = auth.uid()
    AND is_active = true;

  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'An active authenticated app user is required'
      USING ERRCODE = '42501';
  END IF;

  IF v_user.role NOT IN ('sales', 'billing', 'picking') THEN
    RAISE EXCEPTION 'Push notifications are not available for this role'
      USING ERRCODE = '42501';
  END IF;

  IF NULLIF(btrim(p_device_id), '') IS NULL
     OR NULLIF(btrim(p_endpoint), '') IS NULL
     OR NULLIF(btrim(p_p256dh), '') IS NULL
     OR NULLIF(btrim(p_auth), '') IS NULL THEN
    RAISE EXCEPTION 'Push subscription fields must not be empty'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.push_subscriptions
  WHERE endpoint = p_endpoint
  FOR UPDATE;

  IF v_existing.id IS NOT NULL
     AND v_existing.user_id IS DISTINCT FROM v_user.id
     AND v_existing.device_id IS DISTINCT FROM p_device_id THEN
    RAISE EXCEPTION 'Push endpoint is registered to another device'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.push_subscriptions (
    user_id, user_name, role, device_id, endpoint, p256dh, auth, enabled, last_seen_at
  )
  VALUES (
    v_user.id, v_user.full_name, v_user.role, p_device_id, p_endpoint,
    p_p256dh, p_auth, true, now()
  )
  ON CONFLICT (endpoint) DO UPDATE
  SET user_id = EXCLUDED.user_id,
      user_name = EXCLUDED.user_name,
      role = EXCLUDED.role,
      device_id = EXCLUDED.device_id,
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      enabled = true,
      last_seen_at = now()
  -- Avoid an UPDATE (and updated_at churn) for every focus/visibility event.
  WHERE public.push_subscriptions.user_id IS DISTINCT FROM EXCLUDED.user_id
     OR public.push_subscriptions.user_name IS DISTINCT FROM EXCLUDED.user_name
     OR public.push_subscriptions.role IS DISTINCT FROM EXCLUDED.role
     OR public.push_subscriptions.device_id IS DISTINCT FROM EXCLUDED.device_id
     OR public.push_subscriptions.p256dh IS DISTINCT FROM EXCLUDED.p256dh
     OR public.push_subscriptions.auth IS DISTINCT FROM EXCLUDED.auth
     OR public.push_subscriptions.enabled IS DISTINCT FROM true
     OR public.push_subscriptions.last_seen_at < now() - interval '15 minutes';
END;
$$;

REVOKE ALL ON FUNCTION public.sync_push_subscription(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_push_subscription(TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.sync_push_subscription(TEXT, TEXT, TEXT, TEXT) IS
  'Registers or refreshes the authenticated user push endpoint; transfers it only on the same device.';
