-- Visit-tracking RPCs referenced customers.city, but Busy-synced customers use station.
-- Mirror app helper getCustomerCity(): prefer city when present, else station.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS city TEXT;

CREATE OR REPLACE FUNCTION public.customer_display_city(p_station TEXT, p_city TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(NULLIF(TRIM(p_city), ''), NULLIF(TRIM(p_station), ''));
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
    cv.*,
    c.name AS customer_name,
    public.customer_display_city(c.station, c.city) AS customer_city
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
      'started_at', v_visit.started_at,
      'gps_lat', v_visit.gps_lat,
      'gps_lng', v_visit.gps_lng
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_nearby_geofenced_customers(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_radius_m INTEGER DEFAULT 200,
  p_actor_user_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id BIGINT;
  v_rows JSONB;
BEGIN
  v_user_id := public.resolve_sales_actor(p_actor_user_id);

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::JSONB)
  INTO v_rows
  FROM (
    SELECT
      c.id AS customer_id,
      c.name AS customer_name,
      public.customer_display_city(c.station, c.city) AS customer_city,
      ROUND(public.haversine_distance_m(p_lat, p_lng, cl.median_lat, cl.median_lng)) AS distance_m
    FROM public.customer_locations cl
    JOIN public.customers c ON c.id = cl.customer_id
    WHERE cl.fence_phase = 'active'
      AND cl.median_lat IS NOT NULL
      AND cl.median_lng IS NOT NULL
      AND public.haversine_distance_m(p_lat, p_lng, cl.median_lat, cl.median_lng) <= p_radius_m
      AND NOT EXISTS (
        SELECT 1 FROM public.customer_visits cv
        WHERE cv.salesman_user_id = v_user_id
          AND cv.customer_id = c.id
          AND cv.ended_at IS NULL
      )
    ORDER BY distance_m ASC
    LIMIT 5
  ) t;

  RETURN jsonb_build_object('customers', v_rows);
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
  v_overrides JSONB;
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
      w.start_gps_lat,
      w.start_gps_lng,
      (
        SELECT cv.gps_lat
        FROM public.customer_visits cv
        WHERE cv.salesman_user_id = u.id
          AND cv.started_at::DATE = p_date
          AND cv.gps_lat IS NOT NULL
        ORDER BY cv.started_at DESC
        LIMIT 1
      ) AS last_visit_lat,
      (
        SELECT cv.gps_lng
        FROM public.customer_visits cv
        WHERE cv.salesman_user_id = u.id
          AND cv.started_at::DATE = p_date
          AND cv.gps_lng IS NOT NULL
        ORDER BY cv.started_at DESC
        LIMIT 1
      ) AS last_visit_lng,
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
      cv.gps_lat,
      cv.gps_lng,
      cv.distance_from_fence_m,
      cv.required_override,
      u.full_name AS salesman_name,
      c.name AS customer_name,
      public.customer_display_city(c.station, c.city) AS customer_city
    FROM public.customer_visits cv
    JOIN public.users u ON u.id = cv.salesman_user_id
    JOIN public.customers c ON c.id = cv.customer_id
    WHERE cv.started_at::DATE = p_date
    ORDER BY cv.started_at DESC
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::JSONB)
  INTO v_overrides
  FROM (
    SELECT
      vo.override_reason,
      vo.distance_at_override_m,
      vo.created_at,
      u.full_name AS salesman_name,
      c.name AS customer_name
    FROM public.visit_overrides vo
    JOIN public.customer_visits cv ON cv.id = vo.visit_id
    JOIN public.users u ON u.id = cv.salesman_user_id
    JOIN public.customers c ON c.id = cv.customer_id
    WHERE vo.created_at::DATE = p_date
    ORDER BY vo.created_at DESC
  ) t;

  RETURN jsonb_build_object(
    'date', p_date,
    'workdays', v_workdays,
    'visits', v_visits,
    'overrides', v_overrides
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_customer_geofence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_median_lat DOUBLE PRECISION;
  v_median_lng DOUBLE PRECISION;
  v_std_dev DOUBLE PRECISION;
  v_phase TEXT;
  v_branch TEXT;
BEGIN
  SELECT u.stock_location_code
  INTO v_branch
  FROM public.users u
  WHERE u.id = NEW.salesman_user_id;

  SELECT COUNT(*),
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lat),
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lng)
  INTO v_count, v_median_lat, v_median_lng
  FROM public.location_signals
  WHERE customer_id = NEW.customer_id
    AND NOT is_outlier;

  IF v_count > 0 THEN
    SELECT SQRT(
      AVG(
        POWER(public.haversine_distance_m(v_median_lat, v_median_lng, lat, lng), 2)
      )
    )
    INTO v_std_dev
    FROM public.location_signals
    WHERE customer_id = NEW.customer_id
      AND NOT is_outlier;
  END IF;

  v_phase := CASE
    WHEN COALESCE(v_count, 0) < 3 THEN 'none'
    WHEN COALESCE(v_count, 0) < 10 THEN 'learning'
    WHEN COALESCE(v_std_dev, 9999) < 300 THEN 'active'
    ELSE 'learning'
  END;

  INSERT INTO public.customer_locations (
    customer_id,
    median_lat,
    median_lng,
    visit_count,
    cluster_std_dev_m,
    fence_phase,
    last_recomputed_at,
    branch,
    updated_at
  ) VALUES (
    NEW.customer_id,
    v_median_lat,
    v_median_lng,
    COALESCE(v_count, 0),
    v_std_dev,
    v_phase,
    NOW(),
    v_branch,
    NOW()
  )
  ON CONFLICT (customer_id) DO UPDATE SET
    median_lat = EXCLUDED.median_lat,
    median_lng = EXCLUDED.median_lng,
    visit_count = EXCLUDED.visit_count,
    cluster_std_dev_m = EXCLUDED.cluster_std_dev_m,
    fence_phase = CASE
      WHEN public.customer_locations.reset_pending THEN 'none'
      ELSE EXCLUDED.fence_phase
    END,
    last_recomputed_at = NOW(),
    branch = EXCLUDED.branch,
    updated_at = NOW(),
    reset_pending = CASE
      WHEN public.customer_locations.reset_pending AND EXCLUDED.visit_count >= 3 THEN FALSE
      ELSE public.customer_locations.reset_pending
    END;

  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.customer_display_city(TEXT, TEXT) TO anon, authenticated, service_role;
