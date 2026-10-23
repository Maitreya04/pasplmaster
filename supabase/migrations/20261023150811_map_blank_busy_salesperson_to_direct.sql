-- Blank Busy salesperson stamps represent counter/direct sales, not a new
-- salesperson identity. Resolve them to the existing Direct app user on every
-- future aggregation, then rebuild each financial-year snapshot.
DO $direct$
DECLARE
  v_function_definition TEXT;
  v_updated_definition TEXT;
  v_fy RECORD;
  v_result JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.salesperson_source_aliases a
      ON a.salesperson_user_id = u.id
    WHERE u.role = 'sales'
      AND u.is_active = true
      AND public.normalize_sales_dimension(u.full_name) = 'direct'
      AND a.normalized_source_name = 'direct'
  ) THEN
    RAISE EXCEPTION 'Active Direct user with a Direct Busy alias is required';
  END IF;

  SELECT pg_get_functiondef(
    'public.refresh_sales_achievement_daily(date,date,text)'::regprocedure
  )
  INTO v_function_definition;

  v_updated_definition := replace(
    v_function_definition,
    $$a.normalized_source_name = public.normalize_sales_dimension(s."Salesman")$$,
    $$a.normalized_source_name = coalesce(nullif(public.normalize_sales_dimension(s."Salesman"), ''), 'direct')$$
  );

  IF v_updated_definition = v_function_definition THEN
    RAISE EXCEPTION 'Sales refresh salesperson join did not match the expected definition';
  END IF;

  EXECUTE v_updated_definition;

  FOR v_fy IN
    SELECT starts_on, ends_on
    FROM public.financial_years
    ORDER BY starts_on
  LOOP
    v_result := public.refresh_sales_achievement_daily(
      v_fy.starts_on,
      v_fy.ends_on,
      'mapping'
    );

    IF coalesce((v_result ->> 'success')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Sales refresh failed for % to %: %',
        v_fy.starts_on,
        v_fy.ends_on,
        v_result;
    END IF;
  END LOOP;
END;
$direct$;
