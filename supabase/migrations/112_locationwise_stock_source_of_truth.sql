-- PASPL Master — stock_locationwise is the source of truth for sellable stock.
--
-- Removes migration 040/042 guards that zeroed location rows when items.stock_qty <= 0.
-- Stops items.stock_qty from rewriting warehouse rows (migration 043/053 reconcile trigger).
-- Syncs items.stock_qty FROM the sum of canonical warehouse rows when locations change.

-- ── 1. Sellable qty helper (order submit, reservations) ─────────────────────

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

  SELECT COALESCE(SUM(sl.stock_qty), 0)
  INTO v_physical_qty
  FROM public.stock_locationwise sl
  WHERE sl.busy_code::NUMERIC IS NOT DISTINCT FROM p_busy_code
    AND public.normalize_stock_location_code(sl.stock_location) = v_stock_location_code;

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
  'Sellable stock from stock_locationwise minus active reservations; items.stock_qty is not used.';

-- ── 2. Full view (billing/supply paths that scan the view) ───────────────────

CREATE OR REPLACE VIEW public.locationwise_stock_available AS
WITH physical AS (
  SELECT
    sl.busy_code::NUMERIC AS busy_code,
    public.normalize_stock_location_code(sl.stock_location) AS stock_location_code,
    SUM(COALESCE(sl.stock_qty, 0))::NUMERIC AS raw_physical_qty,
    MAX(sl.updated_at) AS latest_stock_updated_at
  FROM public.stock_locationwise sl
  WHERE public.normalize_stock_location_code(sl.stock_location) IS NOT NULL
  GROUP BY sl.busy_code::NUMERIC,
           public.normalize_stock_location_code(sl.stock_location)
),
sibling AS (
  SELECT busy_code, MAX(latest_stock_updated_at) AS newest_sibling_at
  FROM physical
  GROUP BY busy_code
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
guarded AS (
  SELECT
    p.busy_code,
    p.stock_location_code,
    p.raw_physical_qty,
    CASE
      WHEN s.newest_sibling_at IS NOT NULL
       AND p.latest_stock_updated_at IS NOT NULL
       AND s.newest_sibling_at - p.latest_stock_updated_at > INTERVAL '24 hours'
        THEN 0::NUMERIC
      ELSE p.raw_physical_qty
    END AS physical_qty,
    p.latest_stock_updated_at
  FROM physical p
  LEFT JOIN sibling s ON s.busy_code IS NOT DISTINCT FROM p.busy_code
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

-- ── 3. Bounded RPC used by the sales app ─────────────────────────────────────

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
      SUM(COALESCE(sl.stock_qty, 0))::numeric AS physical_qty
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
    GREATEST(p.physical_qty - COALESCE(r.reserved_qty, 0), 0)::numeric AS available_qty,
    p.physical_qty,
    COALESCE(r.reserved_qty, 0)::numeric AS reserved_qty
  FROM physical p
  LEFT JOIN reserved r
    ON r.busy_code IS NOT DISTINCT FROM p.busy_code
   AND r.stock_location_code = p.stock_location_code;
$$;

COMMENT ON FUNCTION public.get_locationwise_stock_for_busy_codes(bigint[]) IS
  'Sellable stock per busy_code and warehouse from stock_locationwise; items.stock_qty is not used.';

-- ── 4. Stop items.stock_qty from overwriting warehouse rows ──────────────────

DROP TRIGGER IF EXISTS trg_items_reconcile_location_stock ON public.items;

-- ── 5. Keep items.stock_qty as a denormalized sum when locations change ─────

CREATE OR REPLACE FUNCTION public.sync_item_stock_qty_from_locationwise()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bc NUMERIC;
  v_sum NUMERIC;
BEGIN
  v_bc := COALESCE(NEW.busy_code, OLD.busy_code)::NUMERIC;
  IF v_bc IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(sl.stock_qty), 0)
  INTO v_sum
  FROM public.stock_locationwise sl
  WHERE sl.busy_code::NUMERIC IS NOT DISTINCT FROM v_bc
    AND public.normalize_stock_location_code(sl.stock_location) IN ('main_store', 'jabalpur');

  UPDATE public.items i
  SET
    stock_qty = v_sum,
    updated_at = now()
  WHERE i.busy_code IS NOT DISTINCT FROM v_bc
    AND i.stock_qty IS DISTINCT FROM v_sum;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.sync_item_stock_qty_from_locationwise() IS
  'Denormalize items.stock_qty to the sum of Main Store + Jabalpur rows after stock_locationwise changes.';

DROP TRIGGER IF EXISTS trg_stock_locationwise_sync_item_total ON public.stock_locationwise;

CREATE TRIGGER trg_stock_locationwise_sync_item_total
  AFTER INSERT OR UPDATE OF stock_qty, stock_location, busy_code OR DELETE
  ON public.stock_locationwise
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_item_stock_qty_from_locationwise();

-- ── 6. Backfill catalog totals from current warehouse rows ───────────────────

UPDATE public.items i
SET
  stock_qty = loc.sum_qty,
  updated_at = now()
FROM (
  SELECT
    sl.busy_code::numeric AS busy_code,
    SUM(COALESCE(sl.stock_qty, 0))::numeric AS sum_qty
  FROM public.stock_locationwise sl
  WHERE public.normalize_stock_location_code(sl.stock_location) IS NOT NULL
  GROUP BY sl.busy_code
) loc
WHERE i.busy_code IS NOT DISTINCT FROM loc.busy_code
  AND i.stock_qty IS DISTINCT FROM loc.sum_qty;
