-- Busy-backed sales pace dashboard.
-- Raw ERP tables remain untouched; all app reads use compact daily aggregates.

CREATE OR REPLACE FUNCTION public.normalize_sales_dimension(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT lower(regexp_replace(trim(coalesce(p_value, '')), '[^a-zA-Z0-9]+', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.busy_sales_date(p_value TEXT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_value IS NULL OR trim(p_value) = '' THEN
    RETURN NULL;
  END IF;
  RETURN to_date(trim(p_value), 'DD-MM-YYYY');
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.busy_sales_number(p_value TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
DECLARE
  v_clean TEXT;
BEGIN
  v_clean := regexp_replace(coalesce(p_value, ''), '[^0-9.-]', '', 'g');
  IF v_clean = '' OR v_clean IN ('-', '.', '-.') THEN
    RETURN 0;
  END IF;
  RETURN v_clean::numeric;
EXCEPTION WHEN OTHERS THEN
  RETURN 0;
END;
$$;

CREATE TABLE IF NOT EXISTS public.sales_segments (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT GENERATED ALWAYS AS (public.normalize_sales_dimension(name)) STORED,
  is_unmapped BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (normalized_name)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_segments_one_unmapped
  ON public.sales_segments(is_unmapped) WHERE is_unmapped = true;

CREATE TABLE IF NOT EXISTS public.sales_segment_members (
  id BIGSERIAL PRIMARY KEY,
  financial_year_id BIGINT NOT NULL REFERENCES public.financial_years(id) ON DELETE CASCADE,
  sales_segment_id BIGINT NOT NULL REFERENCES public.sales_segments(id) ON DELETE CASCADE,
  source_product_group TEXT NOT NULL,
  normalized_source_group TEXT GENERATED ALWAYS AS (
    public.normalize_sales_dimension(source_product_group)
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (financial_year_id, normalized_source_group)
);

CREATE INDEX IF NOT EXISTS idx_sales_segment_members_segment
  ON public.sales_segment_members(financial_year_id, sales_segment_id);

CREATE TABLE IF NOT EXISTS public.salesperson_source_aliases (
  id BIGSERIAL PRIMARY KEY,
  salesperson_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  normalized_source_name TEXT GENERATED ALWAYS AS (
    public.normalize_sales_dimension(source_name)
  ) STORED,
  created_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (normalized_source_name)
);

CREATE INDEX IF NOT EXISTS idx_salesperson_source_aliases_user
  ON public.salesperson_source_aliases(salesperson_user_id);

CREATE TABLE IF NOT EXISTS public.financial_year_calendar (
  calendar_date DATE PRIMARY KEY,
  financial_year_id BIGINT NOT NULL REFERENCES public.financial_years(id) ON DELETE CASCADE,
  is_working_day BOOLEAN NOT NULL,
  reason TEXT,
  updated_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_year_calendar_fy_working
  ON public.financial_year_calendar(financial_year_id, calendar_date)
  WHERE is_working_day = true;

CREATE TABLE IF NOT EXISTS public.sales_achievement_daily (
  sales_date DATE NOT NULL,
  financial_year_id BIGINT NOT NULL REFERENCES public.financial_years(id) ON DELETE CASCADE,
  salesperson_user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sales_segment_id BIGINT NOT NULL REFERENCES public.sales_segments(id) ON DELETE RESTRICT,
  taxable_sales NUMERIC(18,2) NOT NULL DEFAULT 0,
  return_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_achievement NUMERIC(18,2) NOT NULL DEFAULT 0,
  invoice_count INTEGER NOT NULL DEFAULT 0,
  sales_line_count INTEGER NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sales_date, salesperson_user_id, sales_segment_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_achievement_daily_user_fy_date
  ON public.sales_achievement_daily(salesperson_user_id, financial_year_id, sales_date);

CREATE INDEX IF NOT EXISTS idx_sales_achievement_daily_user_segment_date
  ON public.sales_achievement_daily(salesperson_user_id, sales_segment_id, sales_date);

CREATE TABLE IF NOT EXISTS public.sales_achievement_refresh_runs (
  id BIGSERIAL PRIMARY KEY,
  refresh_kind TEXT NOT NULL CHECK (refresh_kind IN ('recent', 'financial_year', 'mapping', 'backfill')),
  range_start DATE NOT NULL,
  range_end DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  source_rows INTEGER NOT NULL DEFAULT 0,
  aggregate_rows INTEGER NOT NULL DEFAULT 0,
  source_max_voucher_date DATE,
  unmatched_salesperson_rows INTEGER NOT NULL DEFAULT 0,
  unmatched_salesperson_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  unmatched_category_rows INTEGER NOT NULL DEFAULT 0,
  unmatched_category_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sales_achievement_refresh_runs_started
  ON public.sales_achievement_refresh_runs(started_at DESC);

ALTER TABLE public.sales_targets
  ADD COLUMN IF NOT EXISTS sales_segment_id BIGINT REFERENCES public.sales_segments(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_sales_targets_user_fy_segment
  ON public.sales_targets(salesperson_user_id, financial_year_id, sales_segment_id);

ALTER TABLE public.sales_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_segment_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salesperson_source_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_year_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_achievement_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_achievement_refresh_runs ENABLE ROW LEVEL SECURITY;

-- Seed governed segments from existing targets and Busy categories. Existing
-- target labels win; Busy-only groups remain visible in Top contributors.
INSERT INTO public.sales_segments(name)
SELECT DISTINCT trim(product_group)
FROM public.sales_targets
WHERE nullif(trim(product_group), '') IS NOT NULL
ON CONFLICT (normalized_name) DO NOTHING;

INSERT INTO public.sales_segments(name)
SELECT DISTINCT trim("ItemmainGrp")
FROM public.sales
WHERE nullif(trim("ItemmainGrp"), '') IS NOT NULL
ON CONFLICT (normalized_name) DO NOTHING;

INSERT INTO public.sales_segments(name, is_unmapped)
VALUES ('Unmapped', true)
ON CONFLICT (normalized_name) DO UPDATE SET is_unmapped = true;

-- Preserve the legacy U4 rollup used by the current dashboard importer.
UPDATE public.sales_segments
SET is_active = false
WHERE normalized_name LIKE 'u4%'
  AND normalized_name <> public.normalize_sales_dimension('U4 WHEELER');

INSERT INTO public.sales_segment_members(financial_year_id, sales_segment_id, source_product_group)
SELECT
  fy.id,
  CASE
    WHEN upper(trim(g.source_group)) LIKE 'U4 %'
      THEN (SELECT id FROM public.sales_segments WHERE normalized_name = public.normalize_sales_dimension('U4 WHEELER'))
    ELSE s.id
  END,
  g.source_group
FROM public.financial_years fy
CROSS JOIN (
  SELECT DISTINCT trim("ItemmainGrp") AS source_group
  FROM public.sales
  WHERE nullif(trim("ItemmainGrp"), '') IS NOT NULL
) g
JOIN public.sales_segments s
  ON s.normalized_name = public.normalize_sales_dimension(g.source_group)
ON CONFLICT (financial_year_id, normalized_source_group) DO NOTHING;

-- Exact normalized user matches are safe to seed. Ambiguous names remain in
-- refresh diagnostics until an admin creates an alias.
INSERT INTO public.salesperson_source_aliases(salesperson_user_id, source_name)
SELECT DISTINCT u.id, trim(s."Salesman")
FROM public.sales s
JOIN public.users u
  ON u.role = 'sales'
 AND public.normalize_sales_dimension(u.full_name) = public.normalize_sales_dimension(s."Salesman")
WHERE nullif(trim(s."Salesman"), '') IS NOT NULL
ON CONFLICT (normalized_source_name) DO NOTHING;

UPDATE public.sales_targets st
SET sales_segment_id = ss.id
FROM public.sales_segments ss
WHERE st.sales_segment_id IS NULL
  AND ss.normalized_name = public.normalize_sales_dimension(st.product_group);

-- Build April-March calendars. Sunday is off by default; admins can override
-- individual dates later without changing target math.
INSERT INTO public.financial_year_calendar(
  calendar_date,
  financial_year_id,
  is_working_day,
  reason
)
SELECT
  d::date,
  fy.id,
  extract(isodow FROM d) <> 7,
  CASE WHEN extract(isodow FROM d) = 7 THEN 'Sunday' END
FROM public.financial_years fy
CROSS JOIN LATERAL generate_series(fy.starts_on, fy.ends_on, interval '1 day') d
ON CONFLICT (calendar_date) DO NOTHING;

-- Copy stable, mapped targets into an empty active FY so the dashboard has an
-- explicit planning baseline. Admins can revise before locking the year.
INSERT INTO public.sales_targets(
  salesperson_name,
  salesperson_user_id,
  product_group,
  sales_segment_id,
  year,
  financial_year_id,
  annual_target_lakhs,
  category,
  source_type,
  created_by_user_id,
  updated_by_user_id
)
SELECT
  st.salesperson_name,
  st.salesperson_user_id,
  st.product_group,
  st.sales_segment_id,
  active_fy.label,
  active_fy.id,
  st.annual_target_lakhs,
  st.category,
  'copied',
  st.created_by_user_id,
  st.updated_by_user_id
FROM public.financial_years active_fy
JOIN LATERAL (
  SELECT fy.id
  FROM public.financial_years fy
  WHERE fy.ends_on < active_fy.starts_on
  ORDER BY fy.ends_on DESC
  LIMIT 1
) previous_fy ON true
JOIN public.sales_targets st ON st.financial_year_id = previous_fy.id
WHERE active_fy.is_active = true
  AND st.salesperson_user_id IS NOT NULL
  AND st.sales_segment_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.sales_targets existing
    WHERE existing.financial_year_id = active_fy.id
  )
ON CONFLICT (salesperson_name, product_group, year) DO NOTHING;

CREATE OR REPLACE FUNCTION public.refresh_sales_achievement_daily(
  p_start_date DATE,
  p_end_date DATE,
  p_refresh_kind TEXT DEFAULT 'recent'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id BIGINT;
  v_source_rows INTEGER := 0;
  v_aggregate_rows INTEGER := 0;
  v_source_max DATE;
  v_unmatched_salesperson_rows INTEGER := 0;
  v_unmatched_salesperson_value NUMERIC := 0;
  v_unmatched_category_rows INTEGER := 0;
  v_unmatched_category_value NUMERIC := 0;
  v_unmapped_segment_id BIGINT;
  v_previous_source_rows INTEGER := 0;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid_refresh_range';
  END IF;

  IF p_refresh_kind NOT IN ('recent', 'financial_year', 'mapping', 'backfill') THEN
    RAISE EXCEPTION 'invalid_refresh_kind';
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('refresh_sales_achievement_daily')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'refresh_already_running');
  END IF;

  SELECT id INTO v_unmapped_segment_id
  FROM public.sales_segments WHERE is_unmapped = true LIMIT 1;

  INSERT INTO public.sales_achievement_refresh_runs(refresh_kind, range_start, range_end, status)
  VALUES (p_refresh_kind, p_start_date, p_end_date, 'running')
  RETURNING id INTO v_run_id;

  SELECT
    count(*),
    max(public.busy_sales_date(s."VchDate")),
    count(*) FILTER (WHERE a.salesperson_user_id IS NULL),
    coalesce(sum(abs(public.busy_sales_number(s."Taxableamt")))
      FILTER (WHERE a.salesperson_user_id IS NULL), 0),
    count(*) FILTER (WHERE m.sales_segment_id IS NULL),
    coalesce(sum(abs(public.busy_sales_number(s."Taxableamt")))
      FILTER (WHERE m.sales_segment_id IS NULL), 0)
  INTO
    v_source_rows,
    v_source_max,
    v_unmatched_salesperson_rows,
    v_unmatched_salesperson_value,
    v_unmatched_category_rows,
    v_unmatched_category_value
  FROM public.sales s
  JOIN public.financial_years fy ON fy.history_fyear_key = trim(s."FYear")
  LEFT JOIN public.salesperson_source_aliases a
    ON a.normalized_source_name = public.normalize_sales_dimension(s."Salesman")
  LEFT JOIN public.sales_segment_members m
    ON m.financial_year_id = fy.id
   AND m.normalized_source_group = public.normalize_sales_dimension(s."ItemmainGrp")
  WHERE public.busy_sales_date(s."VchDate") BETWEEN p_start_date AND p_end_date;

  SELECT coalesce(max(source_rows), 0)
  INTO v_previous_source_rows
  FROM public.sales_achievement_refresh_runs
  WHERE status = 'completed'
    AND range_start = p_start_date
    AND range_end = p_end_date
    AND id <> v_run_id;

  IF v_previous_source_rows > 0 AND v_source_rows < v_previous_source_rows * 0.8 THEN
    UPDATE public.sales_achievement_refresh_runs
    SET status = 'failed',
        source_rows = v_source_rows,
        source_max_voucher_date = v_source_max,
        error_message = 'source_volume_guard',
        completed_at = now()
    WHERE id = v_run_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'source_volume_guard',
      'source_rows', v_source_rows,
      'expected_minimum_rows', floor(v_previous_source_rows * 0.8)
    );
  END IF;

  DELETE FROM public.sales_achievement_daily
  WHERE sales_date BETWEEN p_start_date AND p_end_date;

  INSERT INTO public.sales_achievement_daily(
    sales_date,
    financial_year_id,
    salesperson_user_id,
    sales_segment_id,
    taxable_sales,
    return_value,
    net_achievement,
    invoice_count,
    sales_line_count,
    refreshed_at
  )
  SELECT
    public.busy_sales_date(s."VchDate"),
    fy.id,
    a.salesperson_user_id,
    coalesce(m.sales_segment_id, v_unmapped_segment_id),
    sum(greatest(public.busy_sales_number(s."Taxableamt"), 0)),
    sum(abs(least(public.busy_sales_number(s."Taxableamt"), 0))),
    sum(public.busy_sales_number(s."Taxableamt")),
    count(DISTINCT concat_ws('|', s."FYear", s."VchCode")),
    count(*),
    now()
  FROM public.sales s
  JOIN public.financial_years fy ON fy.history_fyear_key = trim(s."FYear")
  JOIN public.salesperson_source_aliases a
    ON a.normalized_source_name = public.normalize_sales_dimension(s."Salesman")
  LEFT JOIN public.sales_segment_members m
    ON m.financial_year_id = fy.id
   AND m.normalized_source_group = public.normalize_sales_dimension(s."ItemmainGrp")
  WHERE public.busy_sales_date(s."VchDate") BETWEEN p_start_date AND p_end_date
  GROUP BY
    public.busy_sales_date(s."VchDate"),
    fy.id,
    a.salesperson_user_id,
    coalesce(m.sales_segment_id, v_unmapped_segment_id);

  GET DIAGNOSTICS v_aggregate_rows = ROW_COUNT;

  UPDATE public.sales_achievement_refresh_runs
  SET status = 'completed',
      source_rows = v_source_rows,
      aggregate_rows = v_aggregate_rows,
      source_max_voucher_date = v_source_max,
      unmatched_salesperson_rows = v_unmatched_salesperson_rows,
      unmatched_salesperson_value = v_unmatched_salesperson_value,
      unmatched_category_rows = v_unmatched_category_rows,
      unmatched_category_value = v_unmatched_category_value,
      completed_at = now()
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id,
    'source_rows', v_source_rows,
    'aggregate_rows', v_aggregate_rows,
    'source_max_voucher_date', v_source_max,
    'unmatched_salesperson_rows', v_unmatched_salesperson_rows,
    'unmatched_category_rows', v_unmatched_category_rows
  );
EXCEPTION WHEN OTHERS THEN
  IF v_run_id IS NOT NULL THEN
    UPDATE public.sales_achievement_refresh_runs
    SET status = 'failed', error_message = SQLERRM, completed_at = now()
    WHERE id = v_run_id;
  END IF;
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_recent_sales_achievement()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.refresh_sales_achievement_daily(
    ((now() AT TIME ZONE 'Asia/Kolkata')::date - 1),
    (now() AT TIME ZONE 'Asia/Kolkata')::date,
    'recent'
  );
$$;

CREATE OR REPLACE FUNCTION public.refresh_active_fy_sales_achievement()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fy RECORD;
BEGIN
  SELECT * INTO v_fy FROM public.financial_years WHERE is_active = true LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'active_financial_year_missing');
  END IF;
  RETURN public.refresh_sales_achievement_daily(v_fy.starts_on, v_fy.ends_on, 'financial_year');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_sales_pace(
  p_as_of_date DATE DEFAULT NULL,
  p_salesperson_user_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id BIGINT;
  v_actor_role TEXT;
  v_user_id BIGINT;
  v_as_of DATE := COALESCE(p_as_of_date, (now() AT TIME ZONE 'Asia/Kolkata')::date);
  v_fy RECORD;
  v_total_workdays INTEGER := 0;
  v_elapsed_fy_workdays INTEGER := 0;
  v_elapsed_month_workdays INTEGER := 0;
  v_remaining_workdays INTEGER := 0;
  v_today_workday INTEGER := 0;
  v_annual_target NUMERIC := 0;
  v_today_actual NUMERIC := 0;
  v_month_actual NUMERIC := 0;
  v_fy_actual NUMERIC := 0;
  v_latest_refresh TIMESTAMPTZ;
  v_source_max DATE;
  v_unmapped_rows INTEGER := 0;
  v_unmapped_value NUMERIC := 0;
  v_categories JSONB := '[]'::jsonb;
BEGIN
  SELECT id, role INTO v_actor_user_id, v_actor_role
  FROM public.users
  WHERE auth_id = auth.uid() AND is_active = true;

  IF v_actor_role = 'sales' THEN
    IF p_salesperson_user_id IS NOT NULL AND p_salesperson_user_id <> v_actor_user_id THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
    v_user_id := v_actor_user_id;
  ELSIF v_actor_role = 'admin' AND p_salesperson_user_id IS NOT NULL THEN
    SELECT id INTO v_user_id
    FROM public.users
    WHERE id = p_salesperson_user_id AND role = 'sales' AND is_active = true;
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_fy
  FROM public.financial_years
  WHERE v_as_of BETWEEN starts_on AND ends_on
  ORDER BY starts_on DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'financial_year_missing', 'as_of_date', v_as_of);
  END IF;

  SELECT
    count(*) FILTER (WHERE is_working_day),
    count(*) FILTER (WHERE is_working_day AND calendar_date <= v_as_of),
    count(*) FILTER (
      WHERE is_working_day
        AND calendar_date >= date_trunc('month', v_as_of)::date
        AND calendar_date <= v_as_of
    ),
    count(*) FILTER (WHERE is_working_day AND calendar_date > v_as_of),
    count(*) FILTER (WHERE is_working_day AND calendar_date = v_as_of)
  INTO v_total_workdays, v_elapsed_fy_workdays, v_elapsed_month_workdays,
       v_remaining_workdays, v_today_workday
  FROM public.financial_year_calendar
  WHERE financial_year_id = v_fy.id;

  SELECT coalesce(sum(annual_target_lakhs * 100000), 0)
  INTO v_annual_target
  FROM public.sales_targets
  WHERE financial_year_id = v_fy.id
    AND salesperson_user_id = v_user_id;

  SELECT
    coalesce(sum(net_achievement) FILTER (WHERE sales_date = v_as_of), 0),
    coalesce(sum(net_achievement) FILTER (
      WHERE sales_date >= date_trunc('month', v_as_of)::date AND sales_date <= v_as_of
    ), 0),
    coalesce(sum(net_achievement) FILTER (WHERE sales_date <= v_as_of), 0)
  INTO v_today_actual, v_month_actual, v_fy_actual
  FROM public.sales_achievement_daily
  WHERE financial_year_id = v_fy.id
    AND salesperson_user_id = v_user_id;

  SELECT completed_at, source_max_voucher_date,
         unmatched_salesperson_rows + unmatched_category_rows,
         unmatched_salesperson_value + unmatched_category_value
  INTO v_latest_refresh, v_source_max, v_unmapped_rows, v_unmapped_value
  FROM public.sales_achievement_refresh_runs
  WHERE status = 'completed'
  ORDER BY completed_at DESC LIMIT 1;

  WITH target_by_segment AS (
    SELECT sales_segment_id, sum(annual_target_lakhs * 100000) AS annual_target
    FROM public.sales_targets
    WHERE financial_year_id = v_fy.id
      AND salesperson_user_id = v_user_id
      AND sales_segment_id IS NOT NULL
    GROUP BY sales_segment_id
  ), actual_by_segment AS (
    SELECT
      sales_segment_id,
      sum(net_achievement) FILTER (WHERE sales_date = v_as_of) AS today_actual,
      sum(net_achievement) FILTER (
        WHERE sales_date >= date_trunc('month', v_as_of)::date AND sales_date <= v_as_of
      ) AS month_actual,
      sum(net_achievement) FILTER (WHERE sales_date <= v_as_of) AS fy_actual
    FROM public.sales_achievement_daily
    WHERE financial_year_id = v_fy.id
      AND salesperson_user_id = v_user_id
    GROUP BY sales_segment_id
  ), combined AS (
    SELECT
      coalesce(t.sales_segment_id, a.sales_segment_id) AS segment_id,
      coalesce(t.annual_target, 0) AS annual_target,
      coalesce(a.today_actual, 0) AS today_actual,
      coalesce(a.month_actual, 0) AS month_actual,
      coalesce(a.fy_actual, 0) AS fy_actual
    FROM target_by_segment t
    FULL JOIN actual_by_segment a ON a.sales_segment_id = t.sales_segment_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'segment_id', c.segment_id,
    'name', s.name,
    'is_unmapped', s.is_unmapped,
    'annual_target', c.annual_target,
    'today_actual', c.today_actual,
    'today_expected', CASE WHEN v_total_workdays > 0
      THEN c.annual_target * v_today_workday / v_total_workdays ELSE 0 END,
    'month_actual', c.month_actual,
    'month_expected', CASE WHEN v_total_workdays > 0
      THEN c.annual_target * v_elapsed_month_workdays / v_total_workdays ELSE 0 END,
    'fy_actual', c.fy_actual,
    'fy_expected', CASE WHEN v_total_workdays > 0
      THEN c.annual_target * v_elapsed_fy_workdays / v_total_workdays ELSE 0 END,
    'fy_contribution_percent', CASE WHEN v_fy_actual <> 0
      THEN c.fy_actual * 100 / v_fy_actual ELSE 0 END
  ) ORDER BY s.name), '[]'::jsonb)
  INTO v_categories
  FROM combined c
  JOIN public.sales_segments s ON s.id = c.segment_id;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_annual_target = 0 THEN 'targets_missing' ELSE 'ready' END,
    'as_of_date', v_as_of,
    'financial_year', jsonb_build_object(
      'id', v_fy.id, 'label', v_fy.label, 'starts_on', v_fy.starts_on, 'ends_on', v_fy.ends_on
    ),
    'working_days', jsonb_build_object(
      'total', v_total_workdays,
      'elapsed_fy', v_elapsed_fy_workdays,
      'elapsed_month', v_elapsed_month_workdays,
      'remaining', v_remaining_workdays,
      'is_today_working_day', v_today_workday = 1
    ),
    'annual_target', v_annual_target,
    'remaining_annual', greatest(v_annual_target - v_fy_actual, 0),
    'required_daily_run_rate', CASE WHEN v_remaining_workdays > 0
      THEN greatest(v_annual_target - v_fy_actual, 0) / v_remaining_workdays ELSE 0 END,
    'periods', jsonb_build_object(
      'today', jsonb_build_object(
        'actual', v_today_actual,
        'expected', CASE WHEN v_total_workdays > 0 THEN v_annual_target * v_today_workday / v_total_workdays ELSE 0 END
      ),
      'month', jsonb_build_object(
        'actual', v_month_actual,
        'expected', CASE WHEN v_total_workdays > 0 THEN v_annual_target * v_elapsed_month_workdays / v_total_workdays ELSE 0 END
      ),
      'fy', jsonb_build_object(
        'actual', v_fy_actual,
        'expected', CASE WHEN v_total_workdays > 0 THEN v_annual_target * v_elapsed_fy_workdays / v_total_workdays ELSE 0 END
      )
    ),
    'categories', v_categories,
    'freshness', jsonb_build_object(
      'aggregated_at', v_latest_refresh,
      'source_max_voucher_date', v_source_max,
      'is_stale', v_latest_refresh IS NULL OR v_latest_refresh < now() - interval '10 minutes',
      'unmapped_rows', v_unmapped_rows,
      'unmapped_value', v_unmapped_value
    )
  );
END;
$$;

-- Direct browser access is unnecessary. RPCs are the public contract.
REVOKE ALL ON public.sales_segments FROM anon, authenticated;
REVOKE ALL ON public.sales_segment_members FROM anon, authenticated;
REVOKE ALL ON public.salesperson_source_aliases FROM anon, authenticated;
REVOKE ALL ON public.financial_year_calendar FROM anon, authenticated;
REVOKE ALL ON public.sales_achievement_daily FROM anon, authenticated;
REVOKE ALL ON public.sales_achievement_refresh_runs FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.refresh_sales_achievement_daily(DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_recent_sales_achievement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_active_fy_sales_achievement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_sales_pace(DATE, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_sales_pace(DATE, BIGINT) TO authenticated;
REVOKE ALL ON FUNCTION public.normalize_sales_dimension(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.busy_sales_date(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.busy_sales_number(TEXT) FROM PUBLIC, anon, authenticated;

-- Initial reconciliation backfill before cron begins serving incremental data.
DO $$
DECLARE
  v_fy RECORD;
BEGIN
  FOR v_fy IN SELECT * FROM public.financial_years ORDER BY starts_on LOOP
    PERFORM public.refresh_sales_achievement_daily(v_fy.starts_on, v_fy.ends_on, 'backfill');
  END LOOP;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-recent-sales-achievement') THEN
    PERFORM cron.unschedule('refresh-recent-sales-achievement');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-active-fy-sales-achievement') THEN
    PERFORM cron.unschedule('refresh-active-fy-sales-achievement');
  END IF;

  PERFORM cron.schedule(
    'refresh-recent-sales-achievement',
    '*/3 * * * *',
    'SELECT public.refresh_recent_sales_achievement()'
  );
  PERFORM cron.schedule(
    'refresh-active-fy-sales-achievement',
    '35 20 * * *',
    'SELECT public.refresh_active_fy_sales_achievement()'
  );
END;
$$;
