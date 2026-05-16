-- PASPL Master — stop phantom Jabalpur rows + guard stale Main Store in view.
--
-- ROOT CAUSE (diagnosed 2026-05-15):
--   Migration 043 (reconcile_stock_locationwise_to_item_total) introduced two bugs:
--     (a) Rescale arithmetic produced 22-decimal phantom 'Jabalpur' rows whenever
--         both 'JBP' and 'Jabalpur' existed for the same busy_code, inflating
--         sellable Jabalpur stock by ~20,669 units across 200 SKUs.
--         Phantom rows confirmed: 200 total, 175 with decimal qty, all created today.
--     (b) Early-return when items.stock_qty unchanged meant fossilised Main Store
--         rows were never corrected.
--
--   Additionally, Writer B (locationwise upserter) runs a Jabalpur-biased hourly
--   delta + a daily full Main Store snapshot. When the daily snapshot misses SKUs,
--   Main Store rows fossilise while Jabalpur stays fresh. Diagnostic data shows
--   99 SKUs with severe skew (7-30 days), ~678 positive Main Store units at risk.
--
-- WHAT THIS MIGRATION DOES:
--   1. Drop trigger 043 to stop new phantom Jabalpur rows being created.
--   2. Delete the 200 existing phantom 'Jabalpur' rows (confirmed safe).
--   3. Normalise location labels on write (JBP -> Jabalpur, Indore -> Main Store)
--      so Writer B's raw Busy codes land on canonical PKs from now on.
--   4. Add a sibling-skew guard to locationwise_stock_available: when one
--      warehouse's updated_at is > 24h older than its sibling's, treat its
--      physical qty as 0 in available_qty so stale stock cannot be sold.
--
-- WHAT THIS MIGRATION DOES NOT DO (intentionally):
--   Derivation of Main Store from items.stock_qty was considered but validation
--   showed only 54.8% of clean SKUs satisfy items.stock_qty = Main + JBP.
--   The remaining 45% (539 SKUs) have a third value — likely Rejection warehouse
--   or transit stock included in the Busy total field. Derivation is deferred
--   until the Busy stock field definition is confirmed.
--
-- REVERT:
--   See revert script at the bottom of this file.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. PRE-FLIGHT SNAPSHOT — save current Main Store rows before any changes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public._backup_main_store_before_047 AS
SELECT busy_code, stock_location, stock_qty, created_at, updated_at
FROM public.stock_locationwise
WHERE stock_location = 'Main Store';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DROP MIGRATION 043 TRIGGER + FUNCTION
--    Stops new phantom decimal 'Jabalpur' rows from being created.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_items_reconcile_location_stock ON public.items;
DROP FUNCTION IF EXISTS public.reconcile_stock_locationwise_to_item_total();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. DELETE 200 PHANTOM 'Jabalpur' ROWS
--    Only rows where stock_location = 'Jabalpur' AND same busy_code has 'JBP'.
--    SKUs with only 'Jabalpur' (no JBP sibling) are NOT touched.
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM public.stock_locationwise sl
WHERE sl.stock_location = 'Jabalpur'
  AND EXISTS (
    SELECT 1
    FROM public.stock_locationwise sl2
    WHERE sl2.busy_code = sl.busy_code
      AND sl2.stock_location = 'JBP'
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. LABEL NORMALISATION TRIGGER
--    Rewrites raw Busy warehouse codes to canonical labels on every write so
--    Writer B's 'JBP' upsert hits the canonical 'Jabalpur' PK going forward.
--    This stops label drift and makes ON CONFLICT work cleanly.
--
--    Mappings (mirrors normalize_stock_location_code):
--      JBP / jbp / Jbp / jabalpur       -> 'Jabalpur'
--      Main Store / mainstore / Indore   -> 'Main Store'
--    Unknown labels are left as-is (view already ignores them via normalize IS NULL).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.normalize_locationwise_label_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_norm TEXT;
BEGIN
  v_norm := public.normalize_stock_location_code(NEW.stock_location);

  -- Only rewrite when we know the canonical label and the raw label differs.
  IF v_norm = 'jabalpur' AND NEW.stock_location <> 'Jabalpur' THEN
    NEW.stock_location := 'Jabalpur';
  ELSIF v_norm = 'main_store' AND NEW.stock_location <> 'Main Store' THEN
    NEW.stock_location := 'Main Store';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_locationwise_normalize_label ON public.stock_locationwise;

CREATE TRIGGER trg_stock_locationwise_normalize_label
  BEFORE INSERT OR UPDATE ON public.stock_locationwise
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_locationwise_label_before_write();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3b. MIGRATE EXISTING 'JBP' ROWS TO CANONICAL 'Jabalpur'
--     Now that the normalisation trigger is in place, consolidate existing
--     'JBP' rows into 'Jabalpur' rows. Sum quantities where both exist.
--     Done as a plain UPDATE/INSERT so the BEFORE trigger fires and canonical
--     label is used.
-- ─────────────────────────────────────────────────────────────────────────────

-- Upsert JBP -> Jabalpur (trigger will canonicalise the label automatically).
INSERT INTO public.stock_locationwise (busy_code, stock_location, stock_qty, updated_at)
SELECT busy_code, 'JBP', stock_qty, updated_at
FROM public.stock_locationwise
WHERE stock_location = 'JBP'
ON CONFLICT (busy_code, stock_location)
DO UPDATE SET
  stock_qty  = EXCLUDED.stock_qty,
  updated_at = GREATEST(public.stock_locationwise.updated_at, EXCLUDED.updated_at);

-- Delete the now-redundant raw 'JBP' rows (label was rewritten to 'Jabalpur'
-- by the trigger above, so 'JBP' rows are empty now).
DELETE FROM public.stock_locationwise WHERE stock_location = 'JBP';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. SIBLING-SKEW GUARD IN locationwise_stock_available
--    When one warehouse's updated_at is > 24 hours older than its sibling's,
--    treat its physical qty as 0 in available_qty.
--
--    Rationale: Writer B is alive and updating Jabalpur hourly. If Main Store
--    is > 24h behind Jabalpur for the same SKU, the daily snapshot was missed.
--    We cannot know if the value is still correct, so we sell 0 from it rather
--    than risk overselling stale stock.
--
--    Threshold 24h: Writer B's intended cadence is daily for Main Store.
--    Anything older than one cycle is a missed write, not a quiet warehouse.
--
--    This guard does NOT affect SKUs where only one warehouse exists (no sibling
--    to compare against). It also stacks with the migration 042 guard
--    (items.stock_qty <= 0 -> physical 0).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.locationwise_stock_available AS
WITH physical AS (
  SELECT
    sl.busy_code::NUMERIC                                       AS busy_code,
    public.normalize_stock_location_code(sl.stock_location)    AS stock_location_code,
    SUM(COALESCE(sl.stock_qty, 0))::NUMERIC                    AS raw_physical_qty,
    MAX(sl.updated_at)                                         AS latest_stock_updated_at
  FROM public.stock_locationwise sl
  WHERE public.normalize_stock_location_code(sl.stock_location) IS NOT NULL
  GROUP BY sl.busy_code::NUMERIC,
           public.normalize_stock_location_code(sl.stock_location)
),
sibling AS (
  -- Newest updated_at across ALL warehouses for this SKU.
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
      -- Migration 042 rule: items.stock_qty explicitly <= 0 -> zero location stock.
      WHEN i.stock_qty IS NOT NULL AND i.stock_qty <= 0
        THEN 0::NUMERIC
      -- New sibling-skew rule: this warehouse is > 24h older than its sibling
      -- -> daily snapshot was missed -> treat as 0 to prevent stale oversell.
      WHEN s.newest_sibling_at IS NOT NULL
       AND p.latest_stock_updated_at IS NOT NULL
       AND s.newest_sibling_at - p.latest_stock_updated_at > INTERVAL '24 hours'
        THEN 0::NUMERIC
      ELSE p.raw_physical_qty
    END AS physical_qty,
    p.latest_stock_updated_at
  FROM physical p
  LEFT JOIN item_master i ON i.busy_code IS NOT DISTINCT FROM p.busy_code
  LEFT JOIN sibling s     ON s.busy_code IS NOT DISTINCT FROM p.busy_code
)
SELECT
  g.busy_code,
  g.stock_location_code,
  public.stock_location_label(g.stock_location_code) AS stock_location_label,
  g.physical_qty,
  COALESCE(r.reserved_qty, 0)::NUMERIC               AS reserved_qty,
  GREATEST(g.physical_qty - COALESCE(r.reserved_qty, 0), 0)::NUMERIC AS available_qty,
  g.latest_stock_updated_at
FROM guarded g
LEFT JOIN reserved r
  ON r.busy_code IS NOT DISTINCT FROM g.busy_code
 AND r.stock_location_code = g.stock_location_code;

GRANT SELECT ON public.locationwise_stock_available TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- REVERT SCRIPT — paste into SQL Editor to undo this migration.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. Remove label normalisation trigger.
--   DROP TRIGGER IF EXISTS trg_stock_locationwise_normalize_label ON public.stock_locationwise;
--   DROP FUNCTION IF EXISTS public.normalize_locationwise_label_before_write();
--
-- 2. Restore original Main Store rows (if bootstrap had been run — not in this version).
--   INSERT INTO public.stock_locationwise (busy_code, stock_location, stock_qty, created_at, updated_at)
--   SELECT busy_code, stock_location, stock_qty, created_at, updated_at
--   FROM public._backup_main_store_before_047
--   ON CONFLICT (busy_code, stock_location)
--   DO UPDATE SET stock_qty = EXCLUDED.stock_qty, updated_at = EXCLUDED.updated_at;
--
-- 3. Restore view to migration 042 version (remove sibling-skew guard):
--    Re-run migration 042 SQL to get the previous view definition back.
--
-- 4. Re-create trigger 043 ONLY if you want to accept its phantom-row bug again:
--    Re-run migration 043 SQL.
--
-- 5. Cleanup snapshot table when revert is confirmed permanent:
--   DROP TABLE IF EXISTS public._backup_main_store_before_047;
