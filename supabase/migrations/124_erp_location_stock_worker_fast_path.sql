-- PASPL Master — fix sync worker 57014 timeouts on location-wise stock.
--
-- Remote pg_stat: the worker paginates public.locationwise_stock_available via
-- PostgREST (ORDER BY busy_code LIMIT/OFFSET). That view aggregates the full
-- stock_locationwise + stock_reservations tables on every page (~60s+).
--
-- Fixes:
--   1. get_stock_locationwise_for_sync — cursor page over stock_locationwise only.
--   2. apply_stock_locationwise_delta — fast bulk write for Writer B flat rows.
--   3. apply_erp_items_delta — remove pending-recovery loop, optimize joins,
--      session_replication_role during location replace, function-level timeout.

CREATE INDEX IF NOT EXISTS idx_stock_locationwise_updated_busy
  ON public.stock_locationwise (updated_at DESC, busy_code);

-- ── 1. Worker READ: never paginate locationwise_stock_available ─────────────

CREATE OR REPLACE FUNCTION public.get_stock_locationwise_for_sync(
  p_updated_since timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 1000,
  p_after_busy_code bigint DEFAULT NULL
)
RETURNS TABLE (
  busy_code bigint,
  stock_location text,
  stock_location_code text,
  stock_qty numeric,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
  SELECT
    sl.busy_code,
    sl.stock_location,
    public.normalize_stock_location_code(sl.stock_location) AS stock_location_code,
    sl.stock_qty,
    sl.updated_at
  FROM public.stock_locationwise sl
  WHERE public.normalize_stock_location_code(sl.stock_location) IS NOT NULL
    AND (p_updated_since IS NULL OR sl.updated_at > p_updated_since)
    AND (p_after_busy_code IS NULL OR sl.busy_code > p_after_busy_code)
  ORDER BY sl.busy_code ASC, sl.stock_location ASC
  LIMIT greatest(coalesce(p_limit, 1000), 1);
$$;

COMMENT ON FUNCTION public.get_stock_locationwise_for_sync(timestamptz, integer, bigint) IS
  'Sync worker: paginate raw stock_locationwise rows. Do NOT use locationwise_stock_available for export.';

GRANT EXECUTE ON FUNCTION public.get_stock_locationwise_for_sync(timestamptz, integer, bigint)
  TO service_role;

-- ── 2. Worker WRITE: flat location rows → grouped apply_erp_items_delta ─────

CREATE OR REPLACE FUNCTION public.apply_stock_locationwise_delta(
  p_rows jsonb,
  p_source text DEFAULT 'locationwise_writer',
  p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_grouped jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'p_rows must be a JSON array');
  END IF;

  IF coalesce(jsonb_array_length(p_rows), 0) = 0 THEN
    RETURN public.apply_erp_items_delta('[]'::jsonb, p_source, p_extra);
  END IF;

  SELECT coalesce(jsonb_agg(row_payload ORDER BY busy_code), '[]'::jsonb)
  INTO v_grouped
  FROM (
    SELECT
      busy_code,
      jsonb_build_object(
        'busy_code', busy_code::text,
        'locations', jsonb_agg(
          jsonb_build_object(
            'stock_location', stock_location,
            'stock_qty', stock_qty::text
          )
          ORDER BY stock_location
        )
      ) AS row_payload
    FROM (
      SELECT
        trim(both from coalesce(elem->>'busy_code', elem->>'busyCode', ''))::numeric AS busy_code,
        trim(both from coalesce(elem->>'stock_location', elem->>'stockLocation', '')) AS stock_location,
        trim(coalesce(elem->>'stock_qty', elem->>'stockQty', ''))::numeric AS stock_qty
      FROM jsonb_array_elements(p_rows) AS elem
      WHERE trim(both from coalesce(elem->>'busy_code', elem->>'busyCode', '')) ~ '^-?[0-9]+(\.[0-9]+)?$'
        AND trim(both from coalesce(elem->>'stock_location', elem->>'stockLocation', '')) <> ''
        AND trim(coalesce(elem->>'stock_qty', elem->>'stockQty', '')) ~ '^-?[0-9]+(\.[0-9]+)?$'
        AND public.normalize_stock_location_code(
          trim(both from coalesce(elem->>'stock_location', elem->>'stockLocation', ''))
        ) IS NOT NULL
    ) parsed
    WHERE busy_code IS NOT NULL
    GROUP BY busy_code
  ) grouped;

  RETURN public.apply_erp_items_delta(
    v_grouped,
    coalesce(nullif(trim(p_source), ''), 'locationwise_writer'),
    coalesce(p_extra, '{}'::jsonb) || jsonb_build_object('via', 'apply_stock_locationwise_delta')
  );
END;
$$;

COMMENT ON FUNCTION public.apply_stock_locationwise_delta(jsonb, text, jsonb) IS
  'Sync worker (Writer B): pass flat [{busy_code, stock_location, stock_qty}] rows; groups per SKU '
  'and applies via apply_erp_items_delta locations mode. Service role only.';

GRANT EXECUTE ON FUNCTION public.apply_stock_locationwise_delta(jsonb, text, jsonb) TO service_role;

-- ── 3. Deferred pending recovery (optional separate call after sync) ─────────

CREATE OR REPLACE FUNCTION public.refresh_pending_recovery_after_stock_sync(
  p_item_ids bigint[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
AS $$
DECLARE
  v_pending_id bigint;
  v_count integer := 0;
BEGIN
  FOR v_pending_id IN
    SELECT pi.id
    FROM public.pending_items pi
    WHERE pi.status = 'pending'
      AND (
        p_item_ids IS NULL
        OR cardinality(p_item_ids) = 0
        OR pi.item_id = ANY (p_item_ids)
      )
  LOOP
    PERFORM public.recompute_pending_recovery_status(v_pending_id, true);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.refresh_pending_recovery_after_stock_sync(bigint[]) IS
  'Optional post-sync pass for pending recovery. Not run inside apply_erp_items_delta.';

GRANT EXECUTE ON FUNCTION public.refresh_pending_recovery_after_stock_sync(bigint[]) TO service_role;

-- ── 4. Harden apply_erp_items_delta ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_erp_items_delta(
  p_rows jsonb,
  p_source text DEFAULT 'erp_sync',
  p_extra jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '120s'
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
  v_old_replication_role TEXT;
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

  PERFORM set_config('paspl.erp_sync', '1', true);

  DROP TABLE IF EXISTS _erp_busy_codes;
  CREATE TEMP TABLE _erp_busy_codes (
    busy_code NUMERIC PRIMARY KEY
  ) ON COMMIT DROP;

  INSERT INTO _erp_busy_codes (busy_code)
  SELECT DISTINCT trim(both from coalesce(elem->>'busy_code', elem->>'busyCode', ''))::numeric
  FROM jsonb_array_elements(p_rows) AS elem
  WHERE trim(both from coalesce(elem->>'busy_code', elem->>'busyCode', '')) ~ v_num;

  v_old_replication_role := current_setting('session_replication_role', true);
  PERFORM set_config('session_replication_role', 'replica', true);

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

  PERFORM set_config('session_replication_role', coalesce(nullif(v_old_replication_role, ''), 'origin'), true);
  PERFORM set_config('paspl.erp_sync', '', true);

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
  'and sets items.stock_qty in one transaction. Pending recovery is deferred — call '
  'refresh_pending_recovery_after_stock_sync separately if needed. Service role only.';

COMMENT ON VIEW public.locationwise_stock_available IS
  'Sales UI sellable stock view. Sync workers must NOT paginate this view — use get_stock_locationwise_for_sync.';
