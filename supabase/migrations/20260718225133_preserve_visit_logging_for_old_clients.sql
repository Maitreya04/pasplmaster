-- Temporary rollout compatibility for installed/PWA clients that still send
-- the former location-shaped arguments. Coordinates are deliberately ignored.

CREATE FUNCTION public.start_workday(
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_actor_user_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT public.start_workday(p_actor_user_id);
$$;

CREATE FUNCTION public.start_customer_visit(
  p_customer_id BIGINT,
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
  p_accuracy_m DOUBLE PRECISION DEFAULT NULL,
  p_acknowledge_warn BOOLEAN DEFAULT FALSE,
  p_override_reason TEXT DEFAULT NULL,
  p_interaction_type TEXT DEFAULT 'field',
  p_actor_user_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT public.start_customer_visit(
    p_customer_id,
    p_interaction_type,
    p_actor_user_id
  );
$$;

COMMENT ON FUNCTION public.start_workday(DOUBLE PRECISION, DOUBLE PRECISION, BIGINT) IS
  'Rollout compatibility only. Location arguments are ignored and never stored.';
COMMENT ON FUNCTION public.start_customer_visit(BIGINT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN, TEXT, TEXT, BIGINT) IS
  'Rollout compatibility only. Location and geofence arguments are ignored and never stored.';

REVOKE ALL ON FUNCTION public.start_workday(DOUBLE PRECISION, DOUBLE PRECISION, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_customer_visit(BIGINT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN, TEXT, TEXT, BIGINT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.start_workday(DOUBLE PRECISION, DOUBLE PRECISION, BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_customer_visit(BIGINT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN, TEXT, TEXT, BIGINT) TO anon, authenticated, service_role;
