-- PASPL Master — fix apply_erp_items_delta statement timeouts (57014).
--
-- Root cause: migration 053 bulk-writes stock_locationwise while migration 112's
-- per-row trigger re-updates items on every DELETE/INSERT, and 062's pending
-- recovery trigger fans out on each intermediate items touch. Migration 115 made
-- FIFO peel on sync writes unnecessary for sellable stock.
--
-- Fix:
--   1. Session flag paspl.erp_sync=1 suppresses expensive row triggers during RPC.
--   2. apply_erp_items_delta owns items.stock_qty in one UPDATE (no FIFO peel).
--   3. One batched pending-recovery pass at the end for SKUs whose stock changed.

CREATE OR REPLACE FUNCTION public.paspl_in_erp_sync()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(current_setting('paspl.erp_sync', true), '') = '1';
$$;

COMMENT ON FUNCTION public.paspl_in_erp_sync() IS
  'True while apply_erp_items_delta is applying a bulk ERP stock delta.';

-- ── 1. Skip locationwise → items mirror during bulk RPC (112) ───────────────

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
  IF public.paspl_in_erp_sync() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

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

-- ── 2. Skip reservation reconcile on bulk location writes (038; audit-only per 115)

CREATE OR REPLACE FUNCTION public.reconcile_stock_reservations_after_stock_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock_location_code TEXT;
  v_sync_at TIMESTAMPTZ;
BEGIN
  IF public.paspl_in_erp_sync() THEN
    RETURN NEW;
  END IF;

  v_stock_location_code := public.normalize_stock_location_code(NEW.stock_location);
  IF v_stock_location_code IS NULL THEN
    RETURN NEW;
  END IF;

  v_sync_at := COALESCE(NEW.updated_at, now());

  UPDATE public.stock_reservations sr
  SET status = 'released',
      released_at = COALESCE(sr.released_at, v_sync_at),
      last_reconciled_at = now()
  WHERE sr.busy_code IS NOT DISTINCT FROM NEW.busy_code::NUMERIC
    AND sr.stock_location_code = v_stock_location_code
    AND sr.status = 'awaiting_erp_sync'
    AND sr.awaiting_erp_sync_at IS NOT NULL
    AND sr.awaiting_erp_sync_at <= v_sync_at;

  RETURN NEW;
END;
$$;

-- ── 3. Defer per-row pending recovery; RPC batches at end ───────────────────

CREATE OR REPLACE FUNCTION public.refresh_pending_recovery_for_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending RECORD;
BEGIN
  IF public.paspl_in_erp_sync() THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.stock_qty, 0) IS DISTINCT FROM COALESCE(OLD.stock_qty, 0) THEN
    FOR v_pending IN
      SELECT id
      FROM public.pending_items
      WHERE item_id = NEW.id
        AND status = 'pending'
    LOOP
      PERFORM public.recompute_pending_recovery_status(v_pending.id, true);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

-- ── 4. Fast bulk apply: one items touch per SKU, no FIFO peel ───────────────

CREATE OR REPLACE FUNCTION public.apply_erp_items_delta(
  p_rows jsonb,
  p_source text DEFAULT 'erp_sync',
  p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_in INTEGER := 0;
  v_invalid INTEGER := 0;
  v_staged INTEGER := 0;
  v_updated INTEGER := 0;
  v_not_found INTEGER := 0;
  v_loc_sl_deleted INTEGER := 0;
  v_loc_sl_inserted INTEGER := 0;
  v_run_id BIGINT;
  v_num TEXT := '^-?[0-9]+(\.[0-9]+)?$';
  v_pending_id BIGINT;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'p_rows must be a JSON array'
    );
  END IF;

  IF coalesce(jsonb_array_length(p_rows), 0) = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'run_id', null,
      'rows_in', 0,
      'rows_invalid', 0,
      'rows_staged', 0,
      'rows_updated', 0,
      'rows_not_found', 0,
      'rows_stock_locations_deleted', 0,
      'rows_stock_locations_inserted', 0
    );
  END IF;

  -- Headroom for large worker batches after trigger suppression.
  PERFORM set_config('statement_timeout', '90000', true);
  PERFORM set_config('paspl.erp_sync', '1', true);

  DROP TABLE IF EXISTS _erp_item_stock_before;
  CREATE TEMP TABLE _erp_item_stock_before (
    busy_code NUMERIC PRIMARY KEY,
    item_id BIGINT NOT NULL,
    stock_qty NUMERIC
  ) ON COMMIT DROP;

  INSERT INTO _erp_item_stock_before (busy_code, item_id, stock_qty)
  SELECT DISTINCT ON (i.busy_code)
    i.busy_code,
    i.id,
    i.stock_qty
  FROM public.items i
  WHERE i.busy_code IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_rows) AS elem
      WHERE trim(both from coalesce(elem->>'busy_code', elem->>'busyCode', '')) ~ v_num
        AND i.busy_code IS NOT DISTINCT FROM trim(both from coalesce(elem->>'busy_code', elem->>'busyCode', ''))::NUMERIC
    )
  ORDER BY i.busy_code, i.id;

  WITH expanded AS (
    SELECT
      t.elem AS elem,
      t.ordinality::int AS ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(elem, ordinality)
  ),
  classified AS (
    SELECT
      ord,
      elem,
      trim(both from coalesce(elem->>'busy_code', elem->>'busyCode', '')) AS bc_text,
      (elem ? 'stock_qty') AND coalesce(trim(elem->>'stock_qty'), '') <> '' AS set_stock,
      (elem ? 'sales_price') AND coalesce(trim(elem->>'sales_price'), '') <> '' AS set_sp,
      (elem ? 'mrp') AND coalesce(trim(elem->>'mrp'), '') <> '' AS set_mrp,
      (elem ? 'locations')
        AND jsonb_typeof(elem->'locations') = 'array'
        AND jsonb_array_length(coalesce(elem->'locations', '[]'::jsonb)) > 0 AS has_locations_array
    FROM expanded
  ),
  validated AS (
    SELECT
      ord,
      elem,
      bc_text,
      set_stock,
      set_sp,
      set_mrp,
      has_locations_array,
      (bc_text ~ v_num) AS bc_ok,
      CASE WHEN NOT set_stock OR (trim(elem->>'stock_qty') ~ v_num) THEN true ELSE false END AS stock_ok,
      CASE WHEN NOT set_sp OR (trim(elem->>'sales_price') ~ v_num) THEN true ELSE false END AS sp_ok,
      CASE WHEN NOT set_mrp OR (trim(elem->>'mrp') ~ v_num) THEN true ELSE false END AS mrp_ok,
      CASE
        WHEN NOT has_locations_array THEN true
        ELSE NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(elem->'locations') AS j(loc_line)
          WHERE trim(both from coalesce(loc_line->>'stock_location', loc_line->>'stockLocation', '')) = ''
            OR trim(coalesce(loc_line->>'stock_qty', loc_line->>'stockQty', '')) !~ v_num
            OR public.normalize_stock_location_code(
              trim(both from coalesce(loc_line->>'stock_location', loc_line->>'stockLocation', ''))
            ) IS NULL
        )
      END AS loc_ok
    FROM classified
  ),
  ok_rows AS (
    SELECT *
    FROM validated
    WHERE bc_ok
      AND stock_ok
      AND sp_ok
      AND mrp_ok
      AND loc_ok
      AND (set_stock OR set_sp OR set_mrp OR has_locations_array)
  ),
  staged AS (
    SELECT DISTINCT ON (bc_num)
      ord,
      bc_num AS busy_code,
      elem,
      set_stock,
      CASE WHEN set_stock THEN trim(elem->>'stock_qty')::numeric END AS stock_qty,
      set_sp,
      CASE WHEN set_sp THEN trim(elem->>'sales_price')::numeric END AS sales_price,
      set_mrp,
      CASE WHEN set_mrp THEN trim(elem->>'mrp')::numeric END AS mrp,
      has_locations_array AS has_loc_mode
    FROM (
      SELECT
        ord,
        elem,
        set_stock,
        set_sp,
        set_mrp,
        has_locations_array,
        bc_text::numeric AS bc_num
      FROM ok_rows
    ) x
    ORDER BY bc_num, ord DESC
  ),
  location_pts AS (
    SELECT
      s.busy_code,
      public.normalize_stock_location_code(
        trim(both from coalesce(loc_line->>'stock_location', loc_line->>'stockLocation', ''))
      ) AS norm,
      sum(trim(coalesce(loc_line->>'stock_qty', loc_line->>'stockQty', ''))::numeric)::numeric AS loc_qty
    FROM staged s
    CROSS JOIN LATERAL jsonb_array_elements(s.elem->'locations') AS j(loc_line)
    WHERE s.has_loc_mode
    GROUP BY s.busy_code, 2
  ),
  location_full AS (
    SELECT
      s.busy_code,
      w.norm,
      coalesce(lp.loc_qty, 0)::numeric AS qty
    FROM staged s
    CROSS JOIN (VALUES ('main_store'::text), ('jabalpur'::text)) AS w(norm)
    LEFT JOIN location_pts lp
      ON lp.busy_code IS NOT DISTINCT FROM s.busy_code
     AND lp.norm = w.norm
    WHERE s.has_loc_mode
  ),
  del_sl AS (
    DELETE FROM public.stock_locationwise sl
    USING staged s
    WHERE s.has_loc_mode
      AND sl.busy_code::numeric IS NOT DISTINCT FROM s.busy_code
      AND EXISTS (
        SELECT 1 FROM public.items i
        WHERE i.busy_code IS NOT DISTINCT FROM s.busy_code
      )
      AND public.normalize_stock_location_code(sl.stock_location) IN ('main_store', 'jabalpur')
    RETURNING sl.busy_code
  ),
  ins_sl AS (
    INSERT INTO public.stock_locationwise (busy_code, stock_location, stock_qty)
    SELECT lf.busy_code::bigint,
      CASE lf.norm
        WHEN 'main_store' THEN 'Main Store'
        WHEN 'jabalpur' THEN 'Jabalpur'
      END,
      lf.qty
    FROM location_full lf
    WHERE EXISTS (
      SELECT 1 FROM public.items i
      WHERE i.busy_code IS NOT DISTINCT FROM lf.busy_code
    )
    RETURNING busy_code
  ),
  missing AS (
    SELECT count(*)::int AS c
    FROM staged s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.items i
      WHERE i.busy_code IS NOT DISTINCT FROM s.busy_code
    )
  ),
  item_stock_from_locs AS (
    SELECT s.busy_code, sum(lf.qty)::numeric AS sum_qty
    FROM staged s
    JOIN location_full lf ON lf.busy_code IS NOT DISTINCT FROM s.busy_code
    WHERE s.has_loc_mode
    GROUP BY s.busy_code
  ),
  updated AS (
    UPDATE public.items i
    SET
      stock_qty = CASE
        WHEN s.has_loc_mode THEN isl.sum_qty
        WHEN s.set_stock THEN s.stock_qty
        ELSE i.stock_qty
      END,
      sales_price = CASE
        WHEN s.set_sp THEN s.sales_price
        ELSE i.sales_price
      END,
      mrp = CASE
        WHEN s.set_mrp THEN s.mrp
        ELSE i.mrp
      END,
      updated_at = now()
    FROM staged s
    LEFT JOIN item_stock_from_locs isl ON isl.busy_code IS NOT DISTINCT FROM s.busy_code
    WHERE i.busy_code IS NOT DISTINCT FROM s.busy_code
      AND (
        (
          s.has_loc_mode
          AND isl.sum_qty IS NOT NULL
          AND i.stock_qty IS DISTINCT FROM isl.sum_qty
        )
        OR (
          NOT s.has_loc_mode
          AND (
            (s.set_stock AND i.stock_qty IS DISTINCT FROM s.stock_qty)
            OR (s.set_sp AND i.sales_price IS DISTINCT FROM s.sales_price)
            OR (s.set_mrp AND i.mrp IS DISTINCT FROM s.mrp)
          )
        )
        OR (
          s.has_loc_mode
          AND (
            (s.set_sp AND i.sales_price IS DISTINCT FROM s.sales_price)
            OR (s.set_mrp AND i.mrp IS DISTINCT FROM s.mrp)
          )
        )
      )
    RETURNING i.id
  ),
  tallies AS (
    SELECT
      (SELECT count(*)::int FROM expanded) AS rows_in,
      (SELECT count(*)::int FROM validated WHERE NOT (
        bc_ok AND stock_ok AND sp_ok AND mrp_ok AND loc_ok
        AND (set_stock OR set_sp OR set_mrp OR has_locations_array)
      )) AS rows_invalid,
      (SELECT count(*)::int FROM staged) AS rows_staged,
      (SELECT count(*)::int FROM updated) AS rows_updated,
      (SELECT c FROM missing) AS rows_not_found,
      (SELECT count(*)::int FROM del_sl) AS rows_stock_locations_deleted,
      (SELECT count(*)::int FROM ins_sl) AS rows_stock_locations_inserted
  )
  INSERT INTO public.inventory_sync_runs (
    source,
    rows_in,
    rows_invalid,
    rows_staged,
    rows_updated,
    rows_not_found,
    extra
  )
  SELECT
    coalesce(nullif(trim(p_source), ''), 'erp_sync'),
    t.rows_in,
    t.rows_invalid,
    t.rows_staged,
    t.rows_updated,
    t.rows_not_found,
    coalesce(p_extra, '{}'::jsonb) || jsonb_build_object(
      'apply_erp_items_delta', true,
      'rows_stock_locations_deleted', t.rows_stock_locations_deleted,
      'rows_stock_locations_inserted', t.rows_stock_locations_inserted,
      'erp_sync_fast_path', true
    )
  FROM tallies t
  RETURNING
    id,
    rows_in,
    rows_invalid,
    rows_staged,
    rows_updated,
    rows_not_found,
    (extra->>'rows_stock_locations_deleted')::int,
    (extra->>'rows_stock_locations_inserted')::int
  INTO v_run_id, v_in, v_invalid, v_staged, v_updated, v_not_found, v_loc_sl_deleted, v_loc_sl_inserted;

  PERFORM set_config('paspl.erp_sync', '', true);

  FOR v_pending_id IN
    SELECT pi.id
    FROM public.pending_items pi
    INNER JOIN _erp_item_stock_before b ON b.item_id = pi.item_id
    INNER JOIN public.items i ON i.id = b.item_id
    WHERE pi.status = 'pending'
      AND b.stock_qty IS DISTINCT FROM i.stock_qty
  LOOP
    PERFORM public.recompute_pending_recovery_status(v_pending_id, true);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id,
    'rows_in', v_in,
    'rows_invalid', v_invalid,
    'rows_staged', v_staged,
    'rows_updated', v_updated,
    'rows_not_found', v_not_found,
    'rows_stock_locations_deleted', v_loc_sl_deleted,
    'rows_stock_locations_inserted', v_loc_sl_inserted
  );
END;
$$;

COMMENT ON FUNCTION public.apply_erp_items_delta(jsonb, text, jsonb) IS
  'Apply ERP/MSSQL deltas keyed by items.busy_code. Optional `locations` replaces stock_locationwise '
  'and sets items.stock_qty in one transaction. Suppresses per-row location/pending triggers during '
  'apply; batches pending recovery at end. Service role only.';

-- Dead since migration 047/112: items no longer rewrite stock_locationwise.
DROP FUNCTION IF EXISTS public.reconcile_stock_locationwise_to_item_total();
