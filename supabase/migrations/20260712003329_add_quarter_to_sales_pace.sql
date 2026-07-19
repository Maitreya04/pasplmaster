CREATE OR REPLACE FUNCTION public.get_my_sales_pace(
  p_as_of_date DATE DEFAULT NULL,
  p_salesperson_user_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
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
  v_elapsed_quarter_workdays INTEGER := 0;
  v_remaining_workdays INTEGER := 0;
  v_today_workday INTEGER := 0;
  v_annual_target NUMERIC := 0;
  v_today_actual NUMERIC := 0;
  v_month_actual NUMERIC := 0;
  v_quarter_actual NUMERIC := 0;
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
    count(*) FILTER (
      WHERE is_working_day
        AND calendar_date >= date_trunc('quarter', v_as_of)::date
        AND calendar_date <= v_as_of
    ),
    count(*) FILTER (WHERE is_working_day AND calendar_date > v_as_of),
    count(*) FILTER (WHERE is_working_day AND calendar_date = v_as_of)
  INTO v_total_workdays, v_elapsed_fy_workdays, v_elapsed_month_workdays,
       v_elapsed_quarter_workdays, v_remaining_workdays, v_today_workday
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
    coalesce(sum(net_achievement) FILTER (
      WHERE sales_date >= date_trunc('quarter', v_as_of)::date AND sales_date <= v_as_of
    ), 0),
    coalesce(sum(net_achievement) FILTER (WHERE sales_date <= v_as_of), 0)
  INTO v_today_actual, v_month_actual, v_quarter_actual, v_fy_actual
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
      sum(net_achievement) FILTER (
        WHERE sales_date >= date_trunc('quarter', v_as_of)::date AND sales_date <= v_as_of
      ) AS quarter_actual,
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
      coalesce(a.quarter_actual, 0) AS quarter_actual,
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
    'quarter_actual', c.quarter_actual,
    'quarter_expected', CASE WHEN v_total_workdays > 0
      THEN c.annual_target * v_elapsed_quarter_workdays / v_total_workdays ELSE 0 END,
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
      'elapsed_quarter', v_elapsed_quarter_workdays,
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
      'quarter', jsonb_build_object(
        'actual', v_quarter_actual,
        'expected', CASE WHEN v_total_workdays > 0 THEN v_annual_target * v_elapsed_quarter_workdays / v_total_workdays ELSE 0 END
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

REVOKE ALL ON FUNCTION public.get_my_sales_pace(DATE, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_sales_pace(DATE, BIGINT) TO authenticated;
