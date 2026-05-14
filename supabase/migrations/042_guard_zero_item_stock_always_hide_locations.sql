-- PASPL Master — when items.stock_qty is explicitly zero (or negative), never
-- trust positive stock_locationwise rows for sellable math or the UI view.
--
-- Fixes cases like KV137: Busy/item worker set items.stock_qty = 0 but
-- stock_locationwise still had positives because a separate path bumped
-- sl.updated_at after the item row, so the migration 040 timestamp guard
-- refused to hide stale location stock.

CREATE OR REPLACE FUNCTION public.guarded_locationwise_available_qty(
  p_busy_code NUMERIC,
  p_stock_location_code TEXT,
  p_payload_reserved_qty NUMERIC DEFAULT 0
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock_location_code TEXT;
  v_item_stock_qty NUMERIC;
  v_physical_qty NUMERIC := 0;
  v_reserved_qty NUMERIC := 0;
BEGIN
  IF p_busy_code IS NULL THEN
    RETURN 0;
  END IF;

  v_stock_location_code := CASE p_stock_location_code
    WHEN 'jabalpur' THEN 'jabalpur'
    ELSE 'main_store'
  END;

  SELECT i.stock_qty
  INTO v_item_stock_qty
  FROM public.items i
  WHERE i.busy_code IS NOT DISTINCT FROM p_busy_code
    AND COALESCE(i.is_active, true) = true
  ORDER BY i.id
  LIMIT 1;

  SELECT COALESCE(SUM(sl.stock_qty), 0)
  INTO v_physical_qty
  FROM public.stock_locationwise sl
  WHERE sl.busy_code::NUMERIC IS NOT DISTINCT FROM p_busy_code
    AND public.normalize_stock_location_code(sl.stock_location) = v_stock_location_code;

  -- ERP/catalog says this SKU has no sellable stock: ignore stale location rows
  -- regardless of sl.updated_at vs items.updated_at ordering.
  IF v_item_stock_qty IS NOT NULL AND v_item_stock_qty <= 0 THEN
    v_physical_qty := 0;
  END IF;

  SELECT COALESCE(SUM(sr.qty_reserved), 0)
  INTO v_reserved_qty
  FROM public.stock_reservations sr
  WHERE sr.busy_code IS NOT DISTINCT FROM p_busy_code
    AND sr.stock_location_code = v_stock_location_code
    AND sr.status IN ('active', 'awaiting_erp_sync');

  RETURN FLOOR(
    GREATEST(
      COALESCE(v_physical_qty, 0)
        - COALESCE(v_reserved_qty, 0)
        - COALESCE(p_payload_reserved_qty, 0),
      0
    )
  )::INTEGER;
END;
$$;

COMMENT ON FUNCTION public.guarded_locationwise_available_qty(NUMERIC, TEXT, NUMERIC) IS
  'Sellable stock: location minus reservations; physical forced to 0 when items.stock_qty is explicitly <= 0 (stale location rows ignored).';

CREATE OR REPLACE VIEW public.locationwise_stock_available AS
WITH physical AS (
  SELECT
    sl.busy_code::NUMERIC AS busy_code,
    public.normalize_stock_location_code(sl.stock_location) AS stock_location_code,
    SUM(COALESCE(sl.stock_qty, 0))::NUMERIC AS raw_physical_qty,
    MAX(sl.updated_at) AS latest_stock_updated_at
  FROM public.stock_locationwise sl
  WHERE public.normalize_stock_location_code(sl.stock_location) IS NOT NULL
  GROUP BY sl.busy_code::NUMERIC, public.normalize_stock_location_code(sl.stock_location)
),
reserved AS (
  SELECT
    sr.busy_code,
    sr.stock_location_code,
    SUM(sr.qty_reserved)::NUMERIC AS reserved_qty
  FROM public.stock_reservations sr
  WHERE sr.status IN ('active', 'awaiting_erp_sync')
  GROUP BY sr.busy_code, sr.stock_location_code
),
item_master AS (
  SELECT DISTINCT ON (i.busy_code)
    i.busy_code,
    i.stock_qty
  FROM public.items i
  WHERE i.busy_code IS NOT NULL
    AND COALESCE(i.is_active, true) = true
  ORDER BY i.busy_code, i.id
),
guarded AS (
  SELECT
    p.busy_code,
    p.stock_location_code,
    p.raw_physical_qty,
    CASE
      WHEN i.stock_qty IS NOT NULL AND i.stock_qty <= 0 THEN 0::NUMERIC
      ELSE p.raw_physical_qty
    END AS physical_qty,
    p.latest_stock_updated_at
  FROM physical p
  LEFT JOIN item_master i
    ON i.busy_code IS NOT DISTINCT FROM p.busy_code
)
SELECT
  g.busy_code,
  g.stock_location_code,
  public.stock_location_label(g.stock_location_code) AS stock_location_label,
  g.physical_qty,
  COALESCE(r.reserved_qty, 0)::NUMERIC AS reserved_qty,
  GREATEST(g.physical_qty - COALESCE(r.reserved_qty, 0), 0)::NUMERIC AS available_qty,
  g.latest_stock_updated_at
FROM guarded g
LEFT JOIN reserved r
  ON r.busy_code IS NOT DISTINCT FROM g.busy_code
 AND r.stock_location_code = g.stock_location_code;

GRANT SELECT ON public.locationwise_stock_available TO anon, authenticated, service_role;
