-- Fix stale customer id resolution: SELECT INTO leaves variables unchanged when no row matches,
-- so a missing id was treated as valid and name fallback never ran.

CREATE OR REPLACE FUNCTION public.resolve_sales_order_customer(
  p_customer_id BIGINT,
  p_customer_name TEXT,
  p_customer_city TEXT DEFAULT NULL
)
RETURNS TABLE(
  customer_id BIGINT,
  customer_name TEXT,
  customer_city TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $resolve$
DECLARE
  v_name TEXT := NULLIF(TRIM(p_customer_name), '');
  v_city TEXT := NULLIF(TRIM(p_customer_city), '');
  v_id BIGINT;
  v_resolved_name TEXT;
  v_resolved_city TEXT;
BEGIN
  IF v_name IS NULL THEN
    RETURN;
  END IF;

  SELECT c.id, c.name, COALESCE(NULLIF(TRIM(c.city), ''), NULLIF(TRIM(c.station), ''), v_city)
  INTO v_id, v_resolved_name, v_resolved_city
  FROM public.customers c
  WHERE c.id = p_customer_id
    AND c.is_active = true;

  IF FOUND THEN
    customer_id := v_id;
    customer_name := v_resolved_name;
    customer_city := v_resolved_city;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT c.id, c.name, COALESCE(NULLIF(TRIM(c.city), ''), NULLIF(TRIM(c.station), ''), v_city)
  INTO v_id, v_resolved_name, v_resolved_city
  FROM public.customers c
  WHERE c.is_active = true
    AND lower(trim(regexp_replace(c.name, '\s+', ' ', 'g')))
      = lower(trim(regexp_replace(v_name, '\s+', ' ', 'g')))
  ORDER BY c.id
  LIMIT 1;

  IF FOUND THEN
    customer_id := v_id;
    customer_name := v_resolved_name;
    customer_city := v_resolved_city;
    RETURN NEXT;
  END IF;
END;
$resolve$;

GRANT EXECUTE ON FUNCTION public.resolve_sales_order_customer(BIGINT, TEXT, TEXT) TO anon, authenticated, service_role;
