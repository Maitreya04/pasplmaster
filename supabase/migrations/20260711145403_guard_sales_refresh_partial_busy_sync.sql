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
END;
$$;

DO $$
DECLARE
  v_fy RECORD;
BEGIN
  FOR v_fy IN SELECT * FROM public.financial_years ORDER BY starts_on LOOP
    PERFORM public.refresh_sales_achievement_daily(v_fy.starts_on, v_fy.ends_on, 'backfill');
  END LOOP;
END;
$$;
