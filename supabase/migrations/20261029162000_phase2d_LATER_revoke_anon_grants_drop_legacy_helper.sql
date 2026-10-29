-- PHASE 2d LATER — apply after 2a–c + session-redirect frontend are live.
-- Revoke anon table grants, drop is_legacy_anon_session, fix default privileges.
-- NEVER revoke service_role. Manual apply only.

CREATE OR REPLACE FUNCTION public.resolve_sales_actor(p_actor_user_id bigint DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid BIGINT := public.current_user_id();
  v_role TEXT := public.current_user_role();
  v_user_id BIGINT;
BEGIN
  v_user_id := CASE WHEN v_role = 'admin' THEN COALESCE(p_actor_user_id, v_uid) ELSE v_uid END;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id AND is_active AND role = 'sales') THEN
    RAISE EXCEPTION 'sales_role_required';
  END IF;
  RETURN v_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_admin_or_sales_self(p_user_id bigint)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF public.current_user_role() = 'admin' OR public.current_user_id() = p_user_id THEN RETURN; END IF;
  RAISE EXCEPTION 'forbidden';
END;
$$;

CREATE OR REPLACE FUNCTION public.get_field_activity_dashboard(p_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_workdays JSONB; v_visits JSONB;
BEGIN
  IF public.current_user_role() <> 'admin' THEN RAISE EXCEPTION 'admin_required'; END IF;
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_workdays FROM (
    SELECT u.id AS salesman_user_id, u.full_name AS salesman_name, w.started_at, w.ended_at,
           w.visits_count, w.orders_total,
           (SELECT cv.started_at FROM public.customer_visits cv
            WHERE cv.salesman_user_id = u.id AND cv.started_at::DATE = p_date
            ORDER BY cv.started_at DESC LIMIT 1) AS last_visit_at
    FROM public.users u
    LEFT JOIN public.workday_logs w ON w.salesman_user_id = u.id AND w.date = p_date
    WHERE u.role = 'sales' AND u.is_active ORDER BY u.full_name
  ) t;
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::JSONB) INTO v_visits FROM (
    SELECT cv.id, cv.started_at, cv.ended_at, cv.duration_minutes, cv.outcome, cv.notes,
           cv.interaction_type, u.full_name AS salesman_name, c.name AS customer_name, c.city AS customer_city
    FROM public.customer_visits cv
    JOIN public.users u ON u.id = cv.salesman_user_id
    JOIN public.customers c ON c.id = cv.customer_id
    WHERE cv.started_at::DATE = p_date ORDER BY cv.started_at DESC
  ) t;
  RETURN jsonb_build_object('date', p_date, 'workdays', v_workdays, 'visits', v_visits);
END;
$$;

DROP FUNCTION IF EXISTS public.is_legacy_anon_session();

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS name, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S')
  LOOP
    IF r.relkind = 'S' THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM anon, PUBLIC', r.name);
    ELSE
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, PUBLIC', r.name);
    END IF;
  END LOOP;
END $$;

GRANT SELECT ON public.partner_companies TO anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, PUBLIC;
