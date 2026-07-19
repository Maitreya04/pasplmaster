-- Treat sales visits as business activity logs, not location proofs.
-- This migration permanently erases previously collected coordinates and
-- removes the database APIs and storage that could collect them again.

DROP FUNCTION IF EXISTS public.start_customer_visit(
  BIGINT,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  BOOLEAN,
  TEXT,
  TEXT,
  BIGINT
);
DROP FUNCTION IF EXISTS public.start_workday(DOUBLE PRECISION, DOUBLE PRECISION, BIGINT);
DROP FUNCTION IF EXISTS public.evaluate_visit_geofence(BIGINT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION);
DROP FUNCTION IF EXISTS public.check_nearby_geofenced_customers(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, BIGINT);
DROP FUNCTION IF EXISTS public.get_salesperson_visit_route(BIGINT, DATE);
DROP TRIGGER IF EXISTS trg_recompute_geofence ON public.location_signals;
DROP FUNCTION IF EXISTS public.recompute_customer_geofence();
DROP FUNCTION IF EXISTS public.haversine_distance_m(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION);

-- Replace read APIs before removing their legacy geo columns.
CREATE OR REPLACE FUNCTION public.get_today_workday(p_actor_user_id BIGINT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id BIGINT;
  v_row public.workday_logs%ROWTYPE;
BEGIN
  v_user_id := public.resolve_sales_actor(p_actor_user_id);

  SELECT *
  INTO v_row
  FROM public.workday_logs
  WHERE salesman_user_id = v_user_id
    AND date = CURRENT_DATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('active', false);
  END IF;

  RETURN jsonb_build_object(
    'active', v_row.ended_at IS NULL,
    'id', v_row.id,
    'date', v_row.date,
    'started_at', v_row.started_at,
    'ended_at', v_row.ended_at,
    'visits_count', v_row.visits_count,
    'orders_total', v_row.orders_total
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_customer_visit(p_actor_user_id BIGINT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id BIGINT;
  v_visit RECORD;
BEGIN
  v_user_id := public.resolve_sales_actor(p_actor_user_id);

  SELECT
    cv.id,
    cv.customer_id,
    cv.started_at,
    c.name AS customer_name,
    c.city AS customer_city
  INTO v_visit
  FROM public.customer_visits cv
  JOIN public.customers c ON c.id = cv.customer_id
  WHERE cv.salesman_user_id = v_user_id
    AND cv.ended_at IS NULL
  ORDER BY cv.started_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('active', false);
  END IF;

  RETURN jsonb_build_object(
    'active', true,
    'visit', jsonb_build_object(
      'id', v_visit.id,
      'customer_id', v_visit.customer_id,
      'customer_name', v_visit.customer_name,
      'customer_city', v_visit.customer_city,
      'started_at', v_visit.started_at
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_field_activity_dashboard(p_date DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workdays JSONB;
  v_visits JSONB;
BEGIN
  IF public.current_user_role() <> 'admin' AND NOT public.is_legacy_anon_session() THEN
    RAISE EXCEPTION 'admin_required';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::JSONB)
  INTO v_workdays
  FROM (
    SELECT
      u.id AS salesman_user_id,
      u.full_name AS salesman_name,
      w.started_at,
      w.ended_at,
      w.visits_count,
      w.orders_total,
      (
        SELECT cv.started_at
        FROM public.customer_visits cv
        WHERE cv.salesman_user_id = u.id
          AND cv.started_at::DATE = p_date
        ORDER BY cv.started_at DESC
        LIMIT 1
      ) AS last_visit_at
    FROM public.users u
    LEFT JOIN public.workday_logs w
      ON w.salesman_user_id = u.id
     AND w.date = p_date
    WHERE u.role = 'sales'
      AND u.is_active = true
    ORDER BY u.full_name
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::JSONB)
  INTO v_visits
  FROM (
    SELECT
      cv.id,
      cv.started_at,
      cv.ended_at,
      cv.duration_minutes,
      cv.outcome,
      cv.notes,
      cv.interaction_type,
      u.full_name AS salesman_name,
      c.name AS customer_name,
      c.city AS customer_city
    FROM public.customer_visits cv
    JOIN public.users u ON u.id = cv.salesman_user_id
    JOIN public.customers c ON c.id = cv.customer_id
    WHERE cv.started_at::DATE = p_date
    ORDER BY cv.started_at DESC
  ) t;

  RETURN jsonb_build_object(
    'date', p_date,
    'workdays', v_workdays,
    'visits', v_visits
  );
END;
$$;

-- Erase collected geolocation data before removing its storage.
UPDATE public.customer_visits
SET gps_lat = NULL,
    gps_lng = NULL,
    gps_accuracy_m = NULL,
    distance_from_fence_m = NULL,
    fence_phase_at_visit = NULL,
    gps_accuracy_exceeded_fence = FALSE,
    required_override = FALSE
WHERE gps_lat IS NOT NULL
   OR gps_lng IS NOT NULL
   OR gps_accuracy_m IS NOT NULL
   OR distance_from_fence_m IS NOT NULL
   OR fence_phase_at_visit IS NOT NULL
   OR gps_accuracy_exceeded_fence
   OR required_override;

UPDATE public.workday_logs
SET start_gps_lat = NULL,
    start_gps_lng = NULL
WHERE start_gps_lat IS NOT NULL
   OR start_gps_lng IS NOT NULL;

TRUNCATE TABLE public.visit_overrides, public.location_signals, public.customer_locations;

DROP TABLE public.visit_overrides;
DROP TABLE public.location_signals;
DROP TABLE public.customer_locations;

ALTER TABLE public.customer_visits
  DROP COLUMN gps_lat,
  DROP COLUMN gps_lng,
  DROP COLUMN gps_accuracy_m,
  DROP COLUMN distance_from_fence_m,
  DROP COLUMN fence_phase_at_visit,
  DROP COLUMN gps_accuracy_exceeded_fence,
  DROP COLUMN required_override;

ALTER TABLE public.workday_logs
  DROP COLUMN start_gps_lat,
  DROP COLUMN start_gps_lng;

CREATE FUNCTION public.start_workday(p_actor_user_id BIGINT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id BIGINT;
  v_branch TEXT;
  v_row public.workday_logs%ROWTYPE;
BEGIN
  v_user_id := public.resolve_sales_actor(p_actor_user_id);
  SELECT stock_location_code INTO v_branch FROM public.users WHERE id = v_user_id;

  INSERT INTO public.workday_logs (
    salesman_user_id,
    date,
    started_at,
    branch
  ) VALUES (
    v_user_id,
    CURRENT_DATE,
    NOW(),
    v_branch
  )
  ON CONFLICT (salesman_user_id, date) DO UPDATE SET
    started_at = COALESCE(public.workday_logs.started_at, NOW()),
    ended_at = NULL,
    branch = EXCLUDED.branch
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'success', true,
    'workday', jsonb_build_object(
      'id', v_row.id,
      'started_at', v_row.started_at,
      'visits_count', v_row.visits_count
    )
  );
END;
$$;

CREATE FUNCTION public.start_customer_visit(
  p_customer_id BIGINT,
  p_interaction_type TEXT DEFAULT 'field',
  p_actor_user_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id BIGINT;
  v_branch TEXT;
  v_visit_id UUID;
  v_existing UUID;
  v_interaction_type TEXT := COALESCE(p_interaction_type, 'field');
BEGIN
  v_user_id := public.resolve_sales_actor(p_actor_user_id);

  IF v_interaction_type NOT IN ('field', 'phone', 'walkin') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_interaction_type');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_customer_id AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'customer_not_found');
  END IF;

  SELECT id INTO v_existing
  FROM public.customer_visits
  WHERE salesman_user_id = v_user_id
    AND ended_at IS NULL
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'visit_already_active', 'visit_id', v_existing);
  END IF;

  PERFORM public.start_workday(v_user_id);
  SELECT stock_location_code INTO v_branch FROM public.users WHERE id = v_user_id;

  INSERT INTO public.customer_visits (
    customer_id,
    salesman_user_id,
    started_at,
    interaction_type,
    branch
  ) VALUES (
    p_customer_id,
    v_user_id,
    NOW(),
    v_interaction_type,
    v_branch
  )
  RETURNING id INTO v_visit_id;

  RETURN jsonb_build_object(
    'success', true,
    'visit_id', v_visit_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_today_workday(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_active_customer_visit(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_field_activity_dashboard(DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_workday(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_customer_visit(BIGINT, TEXT, BIGINT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_today_workday(BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_customer_visit(BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_field_activity_dashboard(DATE) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_workday(BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_customer_visit(BIGINT, TEXT, BIGINT) TO anon, authenticated, service_role;
