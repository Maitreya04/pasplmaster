-- Fix: FILTER must apply to AVG(), not ROUND(). PostgreSQL error 42809 otherwise.

CREATE OR REPLACE FUNCTION public.refresh_salesperson_search_patterns()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  TRUNCATE public.salesperson_search_patterns;
  INSERT INTO public.salesperson_search_patterns (
    salesperson_name,
    query_normalized,
    item_id,
    selection_count,
    last_used_at,
    avg_time_to_select_ms
  )
  SELECT
    se.salesperson_name,
    lower(trim(regexp_replace(se.search_query, '\s+', ' ', 'g'))),
    se.selected_item_id,
    COUNT(*)::integer,
    MAX(se.created_at),
    ROUND(AVG(se.time_to_select_ms::numeric) FILTER (WHERE se.time_to_select_ms IS NOT NULL))::integer
  FROM public.search_events se
  WHERE se.selected_item_id IS NOT NULL
    AND length(trim(se.search_query)) > 0
  GROUP BY se.salesperson_name, lower(trim(regexp_replace(se.search_query, '\s+', ' ', 'g'))), se.selected_item_id
  HAVING COUNT(*) >= 3;
END;
$fn$;
