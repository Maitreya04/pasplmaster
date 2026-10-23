-- Sales pace used to expose only the last successful full-period refresh. That
-- hid a newer failed validation attempt and left the client to render an
-- apparently harmless "refreshed" timestamp. Return the latest attempt's
-- outcome so a client can clearly mark the dashboard as unsafe.
DO $$
DECLARE
  v_function_definition TEXT;
  v_updated_definition TEXT;
BEGIN
  SELECT pg_get_functiondef('public.get_my_sales_pace(date,bigint)'::regprocedure)
  INTO v_function_definition;

  v_updated_definition := replace(
    v_function_definition,
    $old$  v_latest_refresh TIMESTAMPTZ;
  v_source_max DATE;$old$,
    $new$  v_latest_refresh TIMESTAMPTZ;
  v_latest_full_refresh_at TIMESTAMPTZ;
  v_latest_full_refresh_status TEXT;
  v_latest_full_refresh_error TEXT;
  v_source_max DATE;$new$
  );

  IF v_updated_definition = v_function_definition THEN
    RAISE EXCEPTION 'get_my_sales_pace freshness declarations did not match expected definition';
  END IF;

  v_function_definition := v_updated_definition;
  v_updated_definition := replace(
    v_function_definition,
    $old$  WITH target_by_segment AS ($old$,
    $new$  -- A short recent refresh can complete successfully even when the
  -- full-FY validation has just failed. Keep both facts: the last known-good
  -- full refresh above, and the most recent full refresh attempt below.
  SELECT completed_at, status, error_message
  INTO v_latest_full_refresh_at, v_latest_full_refresh_status, v_latest_full_refresh_error
  FROM public.sales_achievement_refresh_runs
  WHERE range_start <= v_fy.starts_on
    AND range_end >= LEAST(v_as_of, v_fy.ends_on)
  ORDER BY started_at DESC, id DESC
  LIMIT 1;

  WITH target_by_segment AS ($new$
  );

  IF v_updated_definition = v_function_definition THEN
    RAISE EXCEPTION 'get_my_sales_pace freshness attempt block did not match expected definition';
  END IF;

  v_function_definition := v_updated_definition;
  v_updated_definition := replace(
    v_function_definition,
    $old$      'aggregated_at', v_latest_refresh,
      'source_max_voucher_date', v_source_max,
      'is_stale', v_latest_refresh IS NULL OR v_latest_refresh < now() - interval '10 minutes',
      'unmapped_rows', v_unmapped_rows,$old$,
    $new$      'aggregated_at', v_latest_refresh,
      'source_max_voucher_date', v_source_max,
      'is_stale', v_latest_refresh IS NULL
        OR v_latest_refresh < now() - interval '10 minutes'
        OR coalesce(v_latest_full_refresh_status, 'missing') <> 'completed',
      'last_full_refresh_status', coalesce(v_latest_full_refresh_status, 'missing'),
      'last_full_refresh_at', v_latest_full_refresh_at,
      'last_full_refresh_error', v_latest_full_refresh_error,
      'unmapped_rows', v_unmapped_rows,$new$
  );

  IF v_updated_definition = v_function_definition THEN
    RAISE EXCEPTION 'get_my_sales_pace freshness payload did not match expected definition';
  END IF;

  EXECUTE v_updated_definition;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_sales_pace(DATE, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_sales_pace(DATE, BIGINT) TO authenticated;
