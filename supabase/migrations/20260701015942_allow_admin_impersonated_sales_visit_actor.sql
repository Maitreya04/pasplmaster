-- Allow admin impersonation to use the selected sales user for visit/workday RPCs.
-- Regular authenticated users remain pinned to their own JWT-linked user id.

CREATE OR REPLACE FUNCTION public.resolve_sales_actor(p_actor_user_id BIGINT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_user_id BIGINT := public.current_user_id();
  v_current_role TEXT := public.current_user_role();
  v_is_legacy_session BOOLEAN := public.is_legacy_anon_session();
  v_user_id BIGINT;
BEGIN
  IF v_current_role = 'admin' OR v_is_legacy_session THEN
    v_user_id := COALESCE(p_actor_user_id, v_current_user_id);
  ELSE
    v_user_id := v_current_user_id;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = v_user_id
      AND is_active = true
      AND role = 'sales'
  ) THEN
    RAISE EXCEPTION 'sales_role_required';
  END IF;

  RETURN v_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_sales_actor(BIGINT) TO anon, authenticated, service_role;
