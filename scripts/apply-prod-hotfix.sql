-- Prod hotfix — run once in Supabase SQL Editor (project nekjredgojtgnwzuobbr)
-- Source migrations:
--   20260718231000_drop_visit_geo_compat_overloads.sql
--   20260718231100_map_kamlakar_and_billing_operator_sales.sql

-- 1) Unbreak visit / workday RPC overload (PGRST203)
DROP FUNCTION IF EXISTS public.start_workday(DOUBLE PRECISION, DOUBLE PRECISION, BIGINT);
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

-- 2) KAMLAKAR → billing Kamlakar; other billing Busy stamps → Direct
DO $$
DECLARE
  v_kamlakar_user_id BIGINT;
  v_direct_user_id BIGINT;
  v_alias_user_id BIGINT;
  v_billing RECORD;
  v_result JSONB;
  v_fy RECORD;
BEGIN
  SELECT id
  INTO STRICT v_kamlakar_user_id
  FROM public.users
  WHERE role = 'billing'
    AND is_active = true
    AND public.normalize_sales_dimension(full_name) = 'kamlakar';

  SELECT id
  INTO STRICT v_direct_user_id
  FROM public.users
  WHERE role = 'sales'
    AND is_active = true
    AND public.normalize_sales_dimension(full_name) = 'direct';

  UPDATE public.salesperson_source_aliases
  SET salesperson_user_id = v_kamlakar_user_id,
      source_name = 'KAMLAKAR'
  WHERE normalized_source_name = 'kamlakar';

  IF NOT FOUND THEN
    INSERT INTO public.salesperson_source_aliases(salesperson_user_id, source_name)
    VALUES (v_kamlakar_user_id, 'KAMLAKAR');
  END IF;

  SELECT salesperson_user_id
  INTO STRICT v_alias_user_id
  FROM public.salesperson_source_aliases
  WHERE normalized_source_name = 'kamlakar';

  IF v_alias_user_id <> v_kamlakar_user_id THEN
    RAISE EXCEPTION 'Kamlakar alias postcondition failed: expected %, found %',
      v_kamlakar_user_id, v_alias_user_id;
  END IF;

  FOR v_billing IN
    SELECT u.id, u.full_name
    FROM public.users u
    WHERE u.role = 'billing'
      AND u.is_active = true
      AND public.normalize_sales_dimension(u.full_name) <> 'kamlakar'
      AND NOT EXISTS (
        SELECT 1
        FROM public.salesperson_source_aliases a
        WHERE a.salesperson_user_id = u.id
      )
    ORDER BY u.full_name
  LOOP
    UPDATE public.salesperson_source_aliases
    SET salesperson_user_id = v_direct_user_id,
        source_name = trim(v_billing.full_name)
    WHERE normalized_source_name = public.normalize_sales_dimension(v_billing.full_name);

    IF NOT FOUND THEN
      INSERT INTO public.salesperson_source_aliases(salesperson_user_id, source_name)
      VALUES (v_direct_user_id, trim(v_billing.full_name));
    END IF;
  END LOOP;

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
END;
$$;
