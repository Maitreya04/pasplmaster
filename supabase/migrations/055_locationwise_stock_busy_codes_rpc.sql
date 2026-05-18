-- Fast location-wise sellable stock for a bounded set of busy_codes.
-- Replaces scanning the full locationwise_stock_available view CTEs when the
-- client only needs ~50 SKUs (search results, cart lines).

CREATE OR REPLACE FUNCTION public.get_locationwise_stock_for_busy_codes(p_busy_codes bigint[])
RETURNS TABLE (
  busy_code numeric,
  stock_location_code text,
  available_qty numeric,
  physical_qty numeric,
  reserved_qty numeric
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH codes AS (
    SELECT DISTINCT bc AS busy_code
    FROM unnest(COALESCE(p_busy_codes, ARRAY[]::bigint[])) AS bc
    WHERE bc IS NOT NULL
  ),
  physical AS (
    SELECT
      sl.busy_code::numeric AS busy_code,
      public.normalize_stock_location_code(sl.stock_location) AS stock_location_code,
      SUM(COALESCE(sl.stock_qty, 0))::numeric AS raw_physical_qty
    FROM public.stock_locationwise sl
    INNER JOIN codes c ON c.busy_code = sl.busy_code
    WHERE public.normalize_stock_location_code(sl.stock_location) IS NOT NULL
    GROUP BY sl.busy_code, public.normalize_stock_location_code(sl.stock_location)
  ),
  reserved AS (
    SELECT
      sr.busy_code,
      sr.stock_location_code,
      SUM(sr.qty_reserved)::numeric AS reserved_qty
    FROM public.stock_reservations sr
    INNER JOIN codes c ON c.busy_code = sr.busy_code
    WHERE sr.status IN ('active', 'awaiting_erp_sync')
    GROUP BY sr.busy_code, sr.stock_location_code
  ),
  item_master AS (
    SELECT DISTINCT ON (i.busy_code)
      i.busy_code,
      i.stock_qty
    FROM public.items i
    INNER JOIN codes c ON c.busy_code = i.busy_code
    WHERE i.busy_code IS NOT NULL
      AND COALESCE(i.is_active, true) = true
    ORDER BY i.busy_code, i.id
  ),
  guarded AS (
    SELECT
      p.busy_code,
      p.stock_location_code,
      CASE
        WHEN i.stock_qty IS NOT NULL AND i.stock_qty <= 0 THEN 0::numeric
        ELSE p.raw_physical_qty
      END AS physical_qty
    FROM physical p
    LEFT JOIN item_master i ON i.busy_code IS NOT DISTINCT FROM p.busy_code
  )
  SELECT
    g.busy_code,
    g.stock_location_code,
    GREATEST(g.physical_qty - COALESCE(r.reserved_qty, 0), 0)::numeric AS available_qty,
    g.physical_qty,
    COALESCE(r.reserved_qty, 0)::numeric AS reserved_qty
  FROM guarded g
  LEFT JOIN reserved r
    ON r.busy_code IS NOT DISTINCT FROM g.busy_code
   AND r.stock_location_code = g.stock_location_code;
$$;

COMMENT ON FUNCTION public.get_locationwise_stock_for_busy_codes(bigint[]) IS
  'Sellable stock per busy_code and warehouse for a bounded SKU list; filters before aggregating.';

GRANT EXECUTE ON FUNCTION public.get_locationwise_stock_for_busy_codes(bigint[]) TO anon, authenticated, service_role;
