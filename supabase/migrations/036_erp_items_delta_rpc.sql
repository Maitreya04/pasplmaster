-- PASPL Master — ERP / MSSQL stock+price delta apply (single round-trip, minimal row churn)
--
-- Integration workers should POST one JSON array per tick (e.g. every 60s) with only
-- changed SKUs. Rows are matched on items.busy_code. Updates run only when stock_qty,
-- sales_price, or mrp actually differ (IS DISTINCT FROM), so triggers such as
-- trg_items_refresh_pending_recovery do not fire for no-op writes.
--
-- Callable only by service_role (never anon/authenticated).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'items'
      AND column_name = 'busy_code'
  ) THEN
    ALTER TABLE public.items ADD COLUMN busy_code NUMERIC;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_items_busy_code
  ON public.items (busy_code)
  WHERE busy_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.inventory_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'erp_sync',
  rows_in INTEGER NOT NULL DEFAULT 0,
  rows_invalid INTEGER NOT NULL DEFAULT 0,
  rows_staged INTEGER NOT NULL DEFAULT 0,
  rows_updated INTEGER NOT NULL DEFAULT 0,
  rows_not_found INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  extra JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.inventory_sync_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.inventory_sync_runs IS 'Audit log for ERP→Supabase item delta applies (service_role only).';

GRANT SELECT, INSERT ON public.inventory_sync_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.inventory_sync_runs_id_seq TO service_role;

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
  v_run_id BIGINT;
  v_num TEXT := '^-?[0-9]+(\.[0-9]+)?$';
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
      'rows_not_found', 0
    );
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
      (elem ? 'mrp') AND coalesce(trim(elem->>'mrp'), '') <> '' AS set_mrp
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
      (bc_text ~ v_num) AS bc_ok,
      CASE WHEN NOT set_stock OR (trim(elem->>'stock_qty') ~ v_num) THEN true ELSE false END AS stock_ok,
      CASE WHEN NOT set_sp OR (trim(elem->>'sales_price') ~ v_num) THEN true ELSE false END AS sp_ok,
      CASE WHEN NOT set_mrp OR (trim(elem->>'mrp') ~ v_num) THEN true ELSE false END AS mrp_ok
    FROM classified
  ),
  ok_rows AS (
    SELECT *
    FROM validated
    WHERE bc_ok AND stock_ok AND sp_ok AND mrp_ok
  ),
  staged AS (
    SELECT DISTINCT ON (bc_num)
      ord,
      bc_num AS busy_code,
      set_stock,
      CASE WHEN set_stock THEN trim(elem->>'stock_qty')::numeric END AS stock_qty,
      set_sp,
      CASE WHEN set_sp THEN trim(elem->>'sales_price')::numeric END AS sales_price,
      set_mrp,
      CASE WHEN set_mrp THEN trim(elem->>'mrp')::numeric END AS mrp
    FROM (
      SELECT
        ord,
        elem,
        set_stock,
        set_sp,
        set_mrp,
        bc_text::numeric AS bc_num
      FROM ok_rows
    ) x
    ORDER BY bc_num, ord DESC
  ),
  missing AS (
    SELECT count(*)::int AS c
    FROM staged s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.items i
      WHERE i.busy_code IS NOT DISTINCT FROM s.busy_code
    )
  ),
  updated AS (
    UPDATE public.items i
    SET
      stock_qty = CASE
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
    WHERE i.busy_code IS NOT DISTINCT FROM s.busy_code
      AND (
        (s.set_stock AND i.stock_qty IS DISTINCT FROM s.stock_qty)
        OR (s.set_sp AND i.sales_price IS DISTINCT FROM s.sales_price)
        OR (s.set_mrp AND i.mrp IS DISTINCT FROM s.mrp)
      )
    RETURNING i.id
  ),
  tallies AS (
    SELECT
      (SELECT count(*)::int FROM expanded) AS rows_in,
      (SELECT count(*)::int FROM validated WHERE NOT (bc_ok AND stock_ok AND sp_ok AND mrp_ok)) AS rows_invalid,
      (SELECT count(*)::int FROM staged) AS rows_staged,
      (SELECT count(*)::int FROM updated) AS rows_updated,
      (SELECT c FROM missing) AS rows_not_found
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
      'apply_erp_items_delta', true
    )
  FROM tallies t
  RETURNING
    id,
    rows_in,
    rows_invalid,
    rows_staged,
    rows_updated,
    rows_not_found
  INTO v_run_id, v_in, v_invalid, v_staged, v_updated, v_not_found;

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id,
    'rows_in', v_in,
    'rows_invalid', v_invalid,
    'rows_staged', v_staged,
    'rows_updated', v_updated,
    'rows_not_found', v_not_found
  );
END;
$$;

COMMENT ON FUNCTION public.apply_erp_items_delta(jsonb, text, jsonb) IS
  'Apply ERP/MSSQL stock and price deltas keyed by items.busy_code. Service role only. Inserts one inventory_sync_runs audit row per call.';

REVOKE ALL ON FUNCTION public.apply_erp_items_delta(jsonb, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_erp_items_delta(jsonb, text, jsonb) TO service_role;
