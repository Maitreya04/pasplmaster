-- A user keeps one canonical operational role. Busy sales attribution is an
-- independent capability, derived from a governed source alias.

CREATE OR REPLACE FUNCTION public.has_my_sales_attribution()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.salesperson_source_aliases a
      ON a.salesperson_user_id = u.id
    WHERE u.auth_id = auth.uid()
      AND u.is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.has_my_sales_attribution() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_my_sales_attribution() TO authenticated;

DO $$
DECLARE
  v_kamlakar_user_id BIGINT;
  v_function_definition TEXT;
  v_updated_definition TEXT;
  v_result JSONB;
  v_fy RECORD;
BEGIN
  SELECT id
  INTO STRICT v_kamlakar_user_id
  FROM public.users
  WHERE role = 'billing'
    AND is_active = true
    AND public.normalize_sales_dimension(full_name) = 'kamlakar';

  UPDATE public.salesperson_source_aliases
  SET salesperson_user_id = v_kamlakar_user_id,
      source_name = 'KAMLAKAR'
  WHERE normalized_source_name = 'kamlakar';

  IF NOT FOUND THEN
    INSERT INTO public.salesperson_source_aliases(salesperson_user_id, source_name)
    VALUES (v_kamlakar_user_id, 'KAMLAKAR');
  END IF;

  SELECT pg_get_functiondef('public.get_my_sales_pace(date,bigint)'::regprocedure)
  INTO v_function_definition;

  v_updated_definition := replace(
    v_function_definition,
    $old$  IF v_actor_role = 'sales' THEN
    IF p_salesperson_user_id IS NOT NULL AND p_salesperson_user_id <> v_actor_user_id THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
    v_user_id := v_actor_user_id;
  ELSIF v_actor_role = 'admin' AND p_salesperson_user_id IS NOT NULL THEN
    SELECT id INTO v_user_id
    FROM public.users
    WHERE id = p_salesperson_user_id AND role = 'sales' AND is_active = true;
  END IF;$old$,
    $new$  IF v_actor_role = 'sales' THEN
    IF p_salesperson_user_id IS NOT NULL AND p_salesperson_user_id <> v_actor_user_id THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
    v_user_id := v_actor_user_id;
  ELSIF v_actor_role = 'billing'
    AND (p_salesperson_user_id IS NULL OR p_salesperson_user_id = v_actor_user_id)
    AND EXISTS (
      SELECT 1
      FROM public.salesperson_source_aliases a
      WHERE a.salesperson_user_id = v_actor_user_id
    )
  THEN
    v_user_id := v_actor_user_id;
  ELSIF v_actor_role = 'admin' AND p_salesperson_user_id IS NOT NULL THEN
    SELECT u.id INTO v_user_id
    FROM public.users u
    WHERE u.id = p_salesperson_user_id
      AND u.is_active = true
      AND (
        u.role = 'sales'
        OR EXISTS (
          SELECT 1
          FROM public.salesperson_source_aliases a
          WHERE a.salesperson_user_id = u.id
        )
      );
  END IF;$new$
  );

  IF v_updated_definition = v_function_definition THEN
    RAISE EXCEPTION 'get_my_sales_pace authorization block did not match expected definition';
  END IF;

  -- Scope freshness/mapping diagnostics to the financial year being viewed.
  v_function_definition := v_updated_definition;
  v_updated_definition := replace(
    v_function_definition,
    $old$  WHERE status = 'completed'
  ORDER BY completed_at DESC LIMIT 1;$old$,
    $new$  WHERE status = 'completed'
    AND range_start <= v_fy.starts_on
    AND range_end >= LEAST(v_as_of, v_fy.ends_on)
  ORDER BY completed_at DESC, id DESC LIMIT 1;$new$
  );

  IF v_updated_definition = v_function_definition THEN
    RAISE EXCEPTION 'get_my_sales_pace freshness block did not match expected definition';
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
    IF coalesce((v_result->>'success')::BOOLEAN, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Sales achievement refresh failed: %', v_result;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_sales_pace(DATE, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_sales_pace(DATE, BIGINT) TO authenticated;
