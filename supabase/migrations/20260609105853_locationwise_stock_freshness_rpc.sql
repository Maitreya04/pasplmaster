-- Expose source freshness for offline sales stock snapshots.
-- Stock availability stays unchanged: available_qty is Busy/location physical qty.

DROP FUNCTION IF EXISTS public.get_locationwise_stock_for_busy_codes(bigint[]);

CREATE OR REPLACE FUNCTION public.get_locationwise_stock_for_busy_codes(p_busy_codes bigint[])
RETURNS TABLE (
  busy_code numeric,
  stock_location_code text,
  available_qty numeric,
  physical_qty numeric,
  reserved_qty numeric,
  latest_stock_updated_at timestamptz
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
      SUM(COALESCE(sl.stock_qty, 0))::numeric AS physical_qty,
      MAX(sl.updated_at) AS latest_stock_updated_at
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
  )
  SELECT
    p.busy_code,
    p.stock_location_code,
    p.physical_qty AS available_qty,
    p.physical_qty,
    COALESCE(r.reserved_qty, 0)::numeric AS reserved_qty,
    p.latest_stock_updated_at
  FROM physical p
  LEFT JOIN reserved r
    ON r.busy_code IS NOT DISTINCT FROM p.busy_code
   AND r.stock_location_code = p.stock_location_code;
$$;

COMMENT ON FUNCTION public.get_locationwise_stock_for_busy_codes(bigint[]) IS
  'Returns Busy ERP stock directly per warehouse, including stock_locationwise.updated_at for offline freshness display.';

GRANT EXECUTE ON FUNCTION public.get_locationwise_stock_for_busy_codes(bigint[])
  TO anon, authenticated, service_role;
