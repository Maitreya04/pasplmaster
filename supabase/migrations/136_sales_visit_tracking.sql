-- Sales visit logging, learned geofences, workday attendance, and field activity analytics.

-- ─── Tables ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.customer_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  median_lat DOUBLE PRECISION,
  median_lng DOUBLE PRECISION,
  fence_radius_m INTEGER NOT NULL DEFAULT 200,
  visit_count INTEGER NOT NULL DEFAULT 0,
  fence_phase TEXT NOT NULL DEFAULT 'none'
    CHECK (fence_phase IN ('none', 'learning', 'active')),
  cluster_std_dev_m DOUBLE PRECISION,
  last_recomputed_at TIMESTAMPTZ,
  reset_pending BOOLEAN NOT NULL DEFAULT FALSE,
  branch TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id)
);

CREATE TABLE IF NOT EXISTS public.location_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  salesman_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  accuracy_m DOUBLE PRECISION,
  is_outlier BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_location_signals_customer_created
  ON public.location_signals (customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.customer_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  salesman_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  gps_lat DOUBLE PRECISION,
  gps_lng DOUBLE PRECISION,
  gps_accuracy_m DOUBLE PRECISION,
  distance_from_fence_m DOUBLE PRECISION,
  fence_phase_at_visit TEXT,
  gps_accuracy_exceeded_fence BOOLEAN NOT NULL DEFAULT FALSE,
  required_override BOOLEAN NOT NULL DEFAULT FALSE,
  outcome TEXT CHECK (outcome IN ('order_placed', 'payment_collected', 'follow_up', 'no_purchase')),
  notes TEXT,
  orders_placed INTEGER NOT NULL DEFAULT 0,
  payment_collected_amount NUMERIC NOT NULL DEFAULT 0,
  ledger_shared BOOLEAN NOT NULL DEFAULT FALSE,
  interaction_type TEXT NOT NULL DEFAULT 'field'
    CHECK (interaction_type IN ('field', 'phone', 'walkin')),
  branch TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_visits_salesman_started
  ON public.customer_visits (salesman_user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_visits_customer_started
  ON public.customer_visits (customer_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_visits_open
  ON public.customer_visits (salesman_user_id)
  WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS public.visit_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.customer_visits(id) ON DELETE CASCADE,
  override_reason TEXT NOT NULL CHECK (override_reason IN (
    'customer_moved',
    'gps_not_working',
    'different_branch_godown',
    'customer_met_me_here'
  )),
  distance_at_override_m DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.workday_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salesman_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  start_gps_lat DOUBLE PRECISION,
  start_gps_lng DOUBLE PRECISION,
  visits_count INTEGER NOT NULL DEFAULT 0,
  orders_total NUMERIC NOT NULL DEFAULT 0,
  branch TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (salesman_user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_workday_logs_date
  ON public.workday_logs (date DESC);

-- ─── Helpers ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.haversine_distance_m(
  p_lat1 DOUBLE PRECISION,
  p_lng1 DOUBLE PRECISION,
  p_lat2 DOUBLE PRECISION,
  p_lng2 DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_lat1 IS NULL OR p_lng1 IS NULL OR p_lat2 IS NULL OR p_lng2 IS NULL THEN NULL
    ELSE (
      6371000 * 2 * ASIN(
        SQRT(
          POWER(SIN(RADIANS(p_lat2 - p_lat1) / 2), 2)
          + COS(RADIANS(p_lat1)) * COS(RADIANS(p_lat2))
            * POWER(SIN(RADIANS(p_lng2 - p_lng1) / 2), 2)
        )
      )
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_sales_actor(p_actor_user_id BIGINT DEFAULT NULL)
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id BIGINT;
BEGIN
  v_user_id := COALESCE(public.current_user_id(), p_actor_user_id);

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = v_user_id
      AND is_active = true
      AND role = 'sales'
  ) THEN
    RAISE EXCEPTION 'sales_role_required';
  END IF;

  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_admin_or_sales_self(p_user_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_user_role() = 'admin' THEN
    RETURN;
  END IF;

  IF public.current_user_id() = p_user_id THEN
    RETURN;
  END IF;

  IF public.is_legacy_anon_session() THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'forbidden';
END;
$$;

-- ─── Geofence recompute trigger ─────────────────────────────────────────────

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
  SELECT c.city
  INTO v_branch
  FROM public.customers c
  WHERE c.id = NEW.customer_id;

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

DROP TRIGGER IF EXISTS trg_recompute_geofence ON public.location_signals;
CREATE TRIGGER trg_recompute_geofence
AFTER INSERT ON public.location_signals
FOR EACH ROW
EXECUTE FUNCTION public.recompute_customer_geofence();

-- ─── RPC: workday ───────────────────────────────────────────────────────────

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
    'orders_total', v_row.orders_total,
    'start_gps_lat', v_row.start_gps_lat,
    'start_gps_lng', v_row.start_gps_lng
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.start_workday(
  p_lat DOUBLE PRECISION DEFAULT NULL,
  p_lng DOUBLE PRECISION DEFAULT NULL,
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
  v_row public.workday_logs%ROWTYPE;
BEGIN
  v_user_id := public.resolve_sales_actor(p_actor_user_id);
  SELECT stock_location_code INTO v_branch FROM public.users WHERE id = v_user_id;

  INSERT INTO public.workday_logs (
    salesman_user_id,
    date,
    started_at,
    start_gps_lat,
    start_gps_lng,
    branch
  ) VALUES (
    v_user_id,
    CURRENT_DATE,
    NOW(),
    p_lat,
    p_lng,
    v_branch
  )
  ON CONFLICT (salesman_user_id, date) DO UPDATE SET
    started_at = COALESCE(public.workday_logs.started_at, NOW()),
    ended_at = NULL,
    start_gps_lat = COALESCE(public.workday_logs.start_gps_lat, EXCLUDED.start_gps_lat),
    start_gps_lng = COALESCE(public.workday_logs.start_gps_lng, EXCLUDED.start_gps_lng),
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

CREATE OR REPLACE FUNCTION public.end_workday(p_actor_user_id BIGINT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id BIGINT;
  v_row public.workday_logs%ROWTYPE;
BEGIN
  v_user_id := public.resolve_sales_actor(p_actor_user_id);

  UPDATE public.workday_logs
  SET ended_at = NOW()
  WHERE salesman_user_id = v_user_id
    AND date = CURRENT_DATE
    AND ended_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_active_workday');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'workday', jsonb_build_object(
      'visits_count', v_row.visits_count,
      'orders_total', v_row.orders_total,
      'ended_at', v_row.ended_at
    )
  );
END;
$$;

-- ─── RPC: geofence evaluation ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.evaluate_visit_geofence(
  p_customer_id BIGINT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_accuracy_m DOUBLE PRECISION DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loc public.customer_locations%ROWTYPE;
  v_distance DOUBLE PRECISION;
  v_zone TEXT;
  v_enforce BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_loc
  FROM public.customer_locations
  WHERE customer_id = p_customer_id;

  IF NOT FOUND OR v_loc.fence_phase <> 'active' OR v_loc.median_lat IS NULL OR v_loc.median_lng IS NULL THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'zone', 'none',
      'distance_m', NULL,
      'fence_phase', COALESCE(v_loc.fence_phase, 'none'),
      'gps_accuracy_exceeded_fence', FALSE,
      'requires_override', FALSE,
      'requires_warn_ack', FALSE
    );
  END IF;

  v_distance := public.haversine_distance_m(p_lat, p_lng, v_loc.median_lat, v_loc.median_lng);
  v_enforce := TRUE;

  IF p_accuracy_m IS NOT NULL AND p_accuracy_m > v_loc.fence_radius_m THEN
    RETURN jsonb_build_object(
      'allowed', true,
      'zone', 'accuracy_suspended',
      'distance_m', v_distance,
      'fence_phase', v_loc.fence_phase,
      'gps_accuracy_exceeded_fence', TRUE,
      'requires_override', FALSE,
      'requires_warn_ack', FALSE
    );
  END IF;

  IF v_distance <= v_loc.fence_radius_m THEN
    v_zone := 'soft';
  ELSIF v_distance <= 500 THEN
    v_zone := 'warn';
  ELSE
    v_zone := 'hard';
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_zone IN ('soft', 'accuracy_suspended'),
    'zone', v_zone,
    'distance_m', ROUND(v_distance),
    'fence_phase', v_loc.fence_phase,
    'gps_accuracy_exceeded_fence', FALSE,
    'requires_override', v_zone = 'hard',
    'requires_warn_ack', v_zone = 'warn',
    'enforce', v_enforce
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
    cv.*,
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
      'started_at', v_visit.started_at,
      'gps_lat', v_visit.gps_lat,
      'gps_lng', v_visit.gps_lng
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.start_customer_visit(
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id BIGINT;
  v_branch TEXT;
  v_eval JSONB;
  v_zone TEXT;
  v_distance DOUBLE PRECISION;
  v_fence_phase TEXT;
  v_gps_accuracy_exceeded BOOLEAN := FALSE;
  v_required_override BOOLEAN := FALSE;
  v_visit_id UUID;
  v_existing UUID;
BEGIN
  v_user_id := public.resolve_sales_actor(p_actor_user_id);

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

  PERFORM public.start_workday(p_lat, p_lng, v_user_id);
  SELECT stock_location_code INTO v_branch FROM public.users WHERE id = v_user_id;

  IF p_lat IS NOT NULL AND p_lng IS NOT NULL AND COALESCE(p_interaction_type, 'field') = 'field' THEN
    v_eval := public.evaluate_visit_geofence(p_customer_id, p_lat, p_lng, p_accuracy_m);
    v_zone := v_eval->>'zone';
    v_distance := NULLIF(v_eval->>'distance_m', '')::DOUBLE PRECISION;
    v_fence_phase := v_eval->>'fence_phase';
    v_gps_accuracy_exceeded := COALESCE((v_eval->>'gps_accuracy_exceeded_fence')::BOOLEAN, FALSE);

    IF (v_eval->>'requires_warn_ack')::BOOLEAN AND NOT p_acknowledge_warn THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'warn_ack_required',
        'evaluation', v_eval
      );
    END IF;

    IF (v_eval->>'requires_override')::BOOLEAN THEN
      IF p_override_reason IS NULL OR p_override_reason NOT IN (
        'customer_moved', 'gps_not_working', 'different_branch_godown', 'customer_met_me_here'
      ) THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', 'override_required',
          'evaluation', v_eval
        );
      END IF;
      v_required_override := TRUE;
    END IF;
  ELSE
    v_fence_phase := 'none';
  END IF;

  INSERT INTO public.customer_visits (
    customer_id,
    salesman_user_id,
    started_at,
    gps_lat,
    gps_lng,
    gps_accuracy_m,
    distance_from_fence_m,
    fence_phase_at_visit,
    gps_accuracy_exceeded_fence,
    required_override,
    interaction_type,
    branch
  ) VALUES (
    p_customer_id,
    v_user_id,
    NOW(),
    p_lat,
    p_lng,
    p_accuracy_m,
    v_distance,
    v_fence_phase,
    v_gps_accuracy_exceeded,
    v_required_override,
    COALESCE(p_interaction_type, 'field'),
    v_branch
  )
  RETURNING id INTO v_visit_id;

  IF p_lat IS NOT NULL AND p_lng IS NOT NULL AND COALESCE(p_interaction_type, 'field') = 'field' THEN
    INSERT INTO public.location_signals (
      customer_id,
      salesman_user_id,
      lat,
      lng,
      accuracy_m
    ) VALUES (
      p_customer_id,
      v_user_id,
      p_lat,
      p_lng,
      p_accuracy_m
    );
  END IF;

  IF v_required_override THEN
    INSERT INTO public.visit_overrides (visit_id, override_reason, distance_at_override_m)
    VALUES (v_visit_id, p_override_reason, v_distance);

    IF p_override_reason = 'customer_moved' THEN
      UPDATE public.customer_locations
      SET reset_pending = TRUE,
          fence_phase = 'none',
          median_lat = NULL,
          median_lng = NULL,
          visit_count = 0,
          updated_at = NOW()
      WHERE customer_id = p_customer_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'visit_id', v_visit_id,
    'evaluation', v_eval
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.end_customer_visit(
  p_visit_id UUID,
  p_outcome TEXT,
  p_notes TEXT DEFAULT NULL,
  p_orders_placed INTEGER DEFAULT 0,
  p_payment_collected_amount NUMERIC DEFAULT 0,
  p_ledger_shared BOOLEAN DEFAULT FALSE,
  p_actor_user_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id BIGINT;
  v_visit public.customer_visits%ROWTYPE;
  v_duration INTEGER;
BEGIN
  v_user_id := public.resolve_sales_actor(p_actor_user_id);

  IF p_outcome NOT IN ('order_placed', 'payment_collected', 'follow_up', 'no_purchase') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_outcome');
  END IF;

  SELECT * INTO v_visit
  FROM public.customer_visits
  WHERE id = p_visit_id
    AND salesman_user_id = v_user_id
    AND ended_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'visit_not_found');
  END IF;

  v_duration := GREATEST(1, EXTRACT(EPOCH FROM (NOW() - v_visit.started_at))::INTEGER / 60);

  UPDATE public.customer_visits
  SET ended_at = NOW(),
      duration_minutes = v_duration,
      outcome = p_outcome,
      notes = NULLIF(BTRIM(p_notes), ''),
      orders_placed = COALESCE(p_orders_placed, 0),
      payment_collected_amount = COALESCE(p_payment_collected_amount, 0),
      ledger_shared = COALESCE(p_ledger_shared, FALSE)
  WHERE id = p_visit_id
  RETURNING * INTO v_visit;

  UPDATE public.workday_logs
  SET visits_count = visits_count + 1,
      orders_total = orders_total + COALESCE(p_payment_collected_amount, 0)
  WHERE salesman_user_id = v_user_id
    AND date = CURRENT_DATE;

  RETURN jsonb_build_object(
    'success', true,
    'visit', jsonb_build_object(
      'id', v_visit.id,
      'duration_minutes', v_visit.duration_minutes,
      'outcome', v_visit.outcome
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_last_visit(p_customer_id BIGINT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'last_visit_at', cv.ended_at,
    'last_visit_started_at', cv.started_at,
    'outcome', cv.outcome
  )
  FROM public.customer_visits cv
  WHERE cv.customer_id = p_customer_id
    AND cv.ended_at IS NOT NULL
  ORDER BY cv.ended_at DESC
  LIMIT 1;
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
      c.city AS customer_city,
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
      c.city AS customer_city
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

CREATE OR REPLACE FUNCTION public.get_salesperson_visit_route(
  p_salesman_user_id BIGINT,
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_points JSONB;
BEGIN
  IF public.current_user_role() <> 'admin'
     AND public.current_user_id() <> p_salesman_user_id
     AND NOT public.is_legacy_anon_session() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::JSONB)
  INTO v_points
  FROM (
    SELECT
      cv.id,
      cv.started_at,
      cv.gps_lat AS lat,
      cv.gps_lng AS lng,
      c.name AS customer_name
    FROM public.customer_visits cv
    JOIN public.customers c ON c.id = cv.customer_id
    WHERE cv.salesman_user_id = p_salesman_user_id
      AND cv.started_at::DATE = p_date
      AND cv.gps_lat IS NOT NULL
      AND cv.gps_lng IS NOT NULL
    ORDER BY cv.started_at ASC
  ) t;

  RETURN jsonb_build_object('points', v_points);
END;
$$;

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.customer_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workday_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS customer_locations_read ON public.customer_locations;
CREATE POLICY customer_locations_read ON public.customer_locations
  FOR SELECT TO authenticated, anon
  USING (
    public.current_user_role() = 'admin'
    OR public.is_legacy_anon_session()
  );

DROP POLICY IF EXISTS location_signals_sales_insert ON public.location_signals;
CREATE POLICY location_signals_sales_insert ON public.location_signals
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR salesman_user_id = public.current_user_id()
    OR public.is_legacy_anon_session()
  );

DROP POLICY IF EXISTS location_signals_read ON public.location_signals;
CREATE POLICY location_signals_read ON public.location_signals
  FOR SELECT TO authenticated, anon
  USING (
    public.current_user_role() = 'admin'
    OR salesman_user_id = public.current_user_id()
    OR public.is_legacy_anon_session()
  );

DROP POLICY IF EXISTS customer_visits_sales ON public.customer_visits;
CREATE POLICY customer_visits_sales ON public.customer_visits
  FOR ALL TO authenticated, anon
  USING (
    public.current_user_role() = 'admin'
    OR salesman_user_id = public.current_user_id()
    OR public.is_legacy_anon_session()
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR salesman_user_id = public.current_user_id()
    OR public.is_legacy_anon_session()
  );

DROP POLICY IF EXISTS visit_overrides_read ON public.visit_overrides;
CREATE POLICY visit_overrides_read ON public.visit_overrides
  FOR SELECT TO authenticated, anon
  USING (
    public.current_user_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM public.customer_visits cv
      WHERE cv.id = visit_id
        AND cv.salesman_user_id = public.current_user_id()
    )
    OR public.is_legacy_anon_session()
  );

DROP POLICY IF EXISTS visit_overrides_insert ON public.visit_overrides;
CREATE POLICY visit_overrides_insert ON public.visit_overrides
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR public.is_legacy_anon_session()
  );

DROP POLICY IF EXISTS workday_logs_sales ON public.workday_logs;
CREATE POLICY workday_logs_sales ON public.workday_logs
  FOR ALL TO authenticated, anon
  USING (
    public.current_user_role() = 'admin'
    OR salesman_user_id = public.current_user_id()
    OR public.is_legacy_anon_session()
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR salesman_user_id = public.current_user_id()
    OR public.is_legacy_anon_session()
  );

GRANT EXECUTE ON FUNCTION public.haversine_distance_m(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_sales_actor(BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_admin_or_sales_self(BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_today_workday(BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_workday(DOUBLE PRECISION, DOUBLE PRECISION, BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.end_workday(BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_visit_geofence(BIGINT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_customer_visit(BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_customer_visit(BIGINT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, BOOLEAN, TEXT, TEXT, BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.end_customer_visit(UUID, TEXT, TEXT, INTEGER, NUMERIC, BOOLEAN, BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_customer_last_visit(BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_nearby_geofenced_customers(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_field_activity_dashboard(DATE) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_salesperson_visit_route(BIGINT, DATE) TO anon, authenticated, service_role;
