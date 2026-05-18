-- PASPL Master — FIFO reservation peel when Busy lowers location stock (fix PG error).
--
-- PostgreSQL rejects REFERENCING OLD/NEW TABLE on triggers that list more than one
-- event (e.g. INSERT OR DELETE OR UPDATE): 0A000 transition tables cannot be specified...
--
-- Same behaviour as intended in 051: when physical qty drops per warehouse, peel FIFO
-- reservations up to that drop. Implemented by:
--   1) Snapshot stock_locationwise before apply_erp_items_delta location replace, diff after.
--   2) reconcile_stock_locationwise_to_item_total: compare old vs new split before DELETE/INSERT.

DROP TRIGGER IF EXISTS trg_stock_locationwise_stmt_inventory_drop ON public.stock_locationwise;

DROP FUNCTION IF EXISTS public.stock_locationwise_stmt_release_reservations_on_inventory_drop();

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
  v_did_fifo_presnapshot BOOLEAN := false;
  r RECORD;
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

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) AS elem
    WHERE jsonb_typeof(coalesce(elem->'locations', 'null'::jsonb)) = 'array'
      AND jsonb_array_length(coalesce(elem->'locations', '[]'::jsonb)) > 0
      AND trim(both from coalesce(elem->>'busy_code', elem->>'busyCode', '')) ~ v_num
  ) THEN
    DROP TABLE IF EXISTS _fifo_sl_presnapshot;
    CREATE TEMP TABLE _fifo_sl_presnapshot (
      bc NUMERIC NOT NULL,
      loc TEXT NOT NULL,
      qty NUMERIC NOT NULL,
      PRIMARY KEY (bc, loc)
    ) ON COMMIT DROP;

    INSERT INTO _fifo_sl_presnapshot (bc, loc, qty)
    SELECT
      sl.busy_code::NUMERIC,
      public.normalize_stock_location_code(sl.stock_location),
      SUM(COALESCE(sl.stock_qty, 0))::NUMERIC
    FROM public.stock_locationwise sl
    WHERE public.normalize_stock_location_code(sl.stock_location) IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_rows) AS elem2
        WHERE jsonb_typeof(coalesce(elem2->'locations', 'null'::jsonb)) = 'array'
          AND jsonb_array_length(coalesce(elem2->'locations', '[]'::jsonb)) > 0
          AND trim(both from coalesce(elem2->>'busy_code', elem2->>'busyCode', '')) ~ v_num
          AND sl.busy_code::NUMERIC IS NOT DISTINCT FROM trim(both from coalesce(elem2->>'busy_code', elem2->>'busyCode', ''))::NUMERIC
      )
    GROUP BY 1, 2;

    v_did_fifo_presnapshot := true;
  END IF;

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
      END
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
      'rows_stock_locations_inserted', t.rows_stock_locations_inserted
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

  IF v_did_fifo_presnapshot THEN
    FOR r IN
      SELECT p.bc,
             p.loc AS loc_code,
             p.qty AS old_qty,
             COALESCE(n.qty, 0)::numeric AS new_qty
      FROM _fifo_sl_presnapshot p
      LEFT JOIN (
        SELECT sl.busy_code::numeric AS bc,
               public.normalize_stock_location_code(sl.stock_location) AS loc,
               SUM(COALESCE(sl.stock_qty, 0))::numeric AS qty
        FROM public.stock_locationwise sl
        WHERE public.normalize_stock_location_code(sl.stock_location) IS NOT NULL
        GROUP BY 1, 2
      ) n ON n.bc IS NOT DISTINCT FROM p.bc AND n.loc IS NOT DISTINCT FROM p.loc
    LOOP
      IF r.new_qty < r.old_qty THEN
        PERFORM public.release_stock_reservations_fifo_for_location_drop(
          r.bc,
          r.loc_code::TEXT,
          r.old_qty - r.new_qty
        );
      END IF;
    END LOOP;
  END IF;

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
  'Apply ERP/MSSQL deltas keyed by items.busy_code. Optional `locations` replaces stock_locationwise + sets items.stock_qty; FIFO-peels reservations when location qty drops. Service role only.';

CREATE OR REPLACE FUNCTION public.reconcile_stock_locationwise_to_item_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bc NUMERIC;
  v_target NUMERIC;
  v_main NUMERIC := 0;
  v_jab NUMERIC := 0;
  v_tot NUMERIC;
  v_new_main NUMERIC;
  v_new_jab NUMERIC;
BEGIN
  IF NEW.busy_code IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.stock_qty IS NOT DISTINCT FROM OLD.stock_qty THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    NULL;
  ELSE
    RETURN NEW;
  END IF;

  IF NEW.stock_qty IS NULL THEN
    RETURN NEW;
  END IF;

  v_bc := NEW.busy_code;
  v_target := NEW.stock_qty;

  SELECT
    coalesce(sum(CASE WHEN public.normalize_stock_location_code(sl.stock_location) = 'main_store'
      THEN coalesce(sl.stock_qty, 0) ELSE 0 END), 0),
    coalesce(sum(CASE WHEN public.normalize_stock_location_code(sl.stock_location) = 'jabalpur'
      THEN coalesce(sl.stock_qty, 0) ELSE 0 END), 0)
  INTO v_main, v_jab
  FROM public.stock_locationwise sl
  WHERE sl.busy_code::NUMERIC IS NOT DISTINCT FROM v_bc;

  v_tot := v_main + v_jab;

  IF v_tot IS NOT DISTINCT FROM v_target THEN
    RETURN NEW;
  END IF;

  IF v_target <= 0 THEN
    v_new_main := 0;
    v_new_jab := 0;
  ELSIF v_tot <= 0 THEN
    v_new_main := v_target;
    v_new_jab := 0;
  ELSE
    v_new_main := v_target * (v_main / v_tot);
    v_new_jab := v_target - v_new_main;
  END IF;

  IF v_new_main < v_main THEN
    PERFORM public.release_stock_reservations_fifo_for_location_drop(
      v_bc,
      'main_store',
      v_main - v_new_main
    );
  END IF;

  IF v_new_jab < v_jab THEN
    PERFORM public.release_stock_reservations_fifo_for_location_drop(
      v_bc,
      'jabalpur',
      v_jab - v_new_jab
    );
  END IF;

  DELETE FROM public.stock_locationwise sl
  WHERE sl.busy_code::NUMERIC IS NOT DISTINCT FROM v_bc
    AND public.normalize_stock_location_code(sl.stock_location) IN ('main_store', 'jabalpur');

  INSERT INTO public.stock_locationwise (busy_code, stock_location, stock_qty)
  VALUES
    (v_bc::bigint, 'Main Store', v_new_main),
    (v_bc::bigint, 'Jabalpur', v_new_jab);

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.reconcile_stock_locationwise_to_item_total() IS
  'Keeps stock_locationwise aligned with items.stock_qty; FIFO-peels reservations when a warehouse qty drops before rewriting rows.';
