DO $$
DECLARE
  v_guddu_user_id BIGINT;
  v_alias_user_id BIGINT;
  v_result JSONB;
  v_fy RECORD;
BEGIN
  SELECT id
  INTO STRICT v_guddu_user_id
  FROM public.users
  WHERE role = 'sales'
    AND is_active = true
    AND public.normalize_sales_dimension(full_name) = 'guddu';

  UPDATE public.salesperson_source_aliases
  SET salesperson_user_id = v_guddu_user_id
  WHERE normalized_source_name = 'gouravyadav';

  SELECT salesperson_user_id
  INTO STRICT v_alias_user_id
  FROM public.salesperson_source_aliases
  WHERE normalized_source_name = 'gouravyadav';

  IF v_alias_user_id <> v_guddu_user_id THEN
    RAISE EXCEPTION 'Guddu alias postcondition failed: expected %, found %',
      v_guddu_user_id, v_alias_user_id;
  END IF;

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
    IF coalesce((v_result->>'success')::BOOLEAN, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Sales achievement refresh failed: %', v_result;
    END IF;
  END LOOP;

  SELECT salesperson_user_id
  INTO STRICT v_alias_user_id
  FROM public.salesperson_source_aliases
  WHERE normalized_source_name = 'gouravyadav';

  IF v_alias_user_id <> v_guddu_user_id THEN
    RAISE EXCEPTION 'Guddu alias changed during refresh: expected %, found %',
      v_guddu_user_id, v_alias_user_id;
  END IF;
END;
$$;
