-- Keep Busy salesperson identities attached to the canonical app sales user.
-- Exact normalized-name matches are safe to seed automatically. Nicknames and
-- replacement accounts must be governed explicitly, as with Guddu below.

DO $$
DECLARE
  v_guddu_user_id BIGINT;
  v_gourav_user_id BIGINT;
  v_result JSONB;
  v_fy RECORD;
BEGIN
  SELECT id
  INTO STRICT v_guddu_user_id
  FROM public.users
  WHERE role = 'sales'
    AND is_active = true
    AND public.normalize_sales_dimension(full_name) = 'guddu';

  SELECT id
  INTO STRICT v_gourav_user_id
  FROM public.users
  WHERE role = 'sales'
    AND is_active = false
    AND public.normalize_sales_dimension(full_name) = 'gouravyadav';

  UPDATE public.salesperson_source_aliases
  SET salesperson_user_id = v_guddu_user_id,
      source_name = 'Gourav Yadav'
  WHERE normalized_source_name = 'gouravyadav'
    AND salesperson_user_id = v_gourav_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Expected Gourav Yadav alias on inactive user %, so no identity mapping was changed',
      v_gourav_user_id;
  END IF;

  -- Cover every unambiguous active-user/source exact-name match. The unique
  -- normalized_source_name constraint prevents one Busy identity mapping twice.
  INSERT INTO public.salesperson_source_aliases(salesperson_user_id, source_name)
  SELECT DISTINCT u.id, trim(s."Salesman")
  FROM public.sales s
  JOIN public.users u
    ON u.role = 'sales'
   AND u.is_active = true
   AND public.normalize_sales_dimension(u.full_name)
       = public.normalize_sales_dimension(s."Salesman")
  WHERE nullif(trim(s."Salesman"), '') IS NOT NULL
  ON CONFLICT (normalized_source_name) DO NOTHING;

  FOR v_fy IN
    SELECT id, starts_on, ends_on
    FROM public.financial_years
    ORDER BY starts_on
  LOOP
    PERFORM public.reconcile_sales_target_segment_members(v_fy.id);
    v_result := public.refresh_sales_achievement_daily(
      v_fy.starts_on,
      v_fy.ends_on,
      'mapping'
    );

    IF coalesce((v_result->>'success')::BOOLEAN, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Sales achievement refresh failed for FY %: %', v_fy.id, v_result;
    END IF;
  END LOOP;
END;
$$;
