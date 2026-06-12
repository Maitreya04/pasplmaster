-- PASPL Master — make direct REST stock_locationwise sync batch-safe.
--
-- Root cause for local REST sync worker 57014 timeouts:
-- direct PostgREST inserts into stock_locationwise fired
-- trg_stock_locationwise_sync_item_total once per row. Each row scanned all
-- rows for that busy_code and updated items, so a 1,000-row REST batch repeated
-- aggregation/update work hundreds of times.
--
-- Keep direct REST compatibility, but recompute catalog stock totals once per
-- changed busy_code per statement.

DROP TRIGGER IF EXISTS trg_stock_locationwise_sync_item_total ON public.stock_locationwise;

CREATE OR REPLACE FUNCTION public.sync_item_stock_qty_from_locationwise_busy_codes(
  p_busy_codes numeric[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  IF public.paspl_in_erp_sync() THEN
    RETURN 0;
  END IF;

  WITH changed_busy_codes AS (
    SELECT DISTINCT bc AS busy_code
    FROM unnest(coalesce(p_busy_codes, ARRAY[]::numeric[])) AS u(bc)
    WHERE bc IS NOT NULL
  ),
  loc_totals AS (
    SELECT
      c.busy_code,
      coalesce(sum(sl.stock_qty), 0)::numeric AS sum_qty
    FROM changed_busy_codes c
    LEFT JOIN public.stock_locationwise sl
      ON sl.busy_code::numeric IS NOT DISTINCT FROM c.busy_code
     AND public.normalize_stock_location_code(sl.stock_location) IN ('main_store', 'jabalpur')
    GROUP BY c.busy_code
  ),
  updated AS (
    UPDATE public.items i
    SET
      stock_qty = lt.sum_qty,
      updated_at = now()
    FROM loc_totals lt
    WHERE i.busy_code IS NOT DISTINCT FROM lt.busy_code
      AND i.stock_qty IS DISTINCT FROM lt.sum_qty
    RETURNING i.id
  )
  SELECT count(*)::integer
  INTO v_count
  FROM updated;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.sync_item_stock_qty_from_locationwise_busy_codes(numeric[]) IS
  'Batch recomputes items.stock_qty from stock_locationwise for changed busy_codes; used by statement-level stock sync triggers.';

CREATE OR REPLACE FUNCTION public.sync_item_stock_qty_from_locationwise_insert_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_busy_codes numeric[];
BEGIN
  SELECT array_agg(DISTINCT n.busy_code::numeric)
  INTO v_busy_codes
  FROM new_rows n
  WHERE n.busy_code IS NOT NULL;

  PERFORM public.sync_item_stock_qty_from_locationwise_busy_codes(v_busy_codes);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_item_stock_qty_from_locationwise_update_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_busy_codes numeric[];
BEGIN
  SELECT array_agg(DISTINCT busy_code)
  INTO v_busy_codes
  FROM (
    SELECT n.busy_code::numeric AS busy_code FROM new_rows n WHERE n.busy_code IS NOT NULL
    UNION
    SELECT o.busy_code::numeric AS busy_code FROM old_rows o WHERE o.busy_code IS NOT NULL
  ) changed;

  PERFORM public.sync_item_stock_qty_from_locationwise_busy_codes(v_busy_codes);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_item_stock_qty_from_locationwise_delete_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_busy_codes numeric[];
BEGIN
  SELECT array_agg(DISTINCT o.busy_code::numeric)
  INTO v_busy_codes
  FROM old_rows o
  WHERE o.busy_code IS NOT NULL;

  PERFORM public.sync_item_stock_qty_from_locationwise_busy_codes(v_busy_codes);
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_stock_locationwise_sync_item_total_insert
AFTER INSERT ON public.stock_locationwise
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.sync_item_stock_qty_from_locationwise_insert_stmt();

CREATE TRIGGER trg_stock_locationwise_sync_item_total_update
AFTER UPDATE ON public.stock_locationwise
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.sync_item_stock_qty_from_locationwise_update_stmt();

CREATE TRIGGER trg_stock_locationwise_sync_item_total_delete
AFTER DELETE ON public.stock_locationwise
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.sync_item_stock_qty_from_locationwise_delete_stmt();

COMMENT ON TRIGGER trg_stock_locationwise_sync_item_total_insert ON public.stock_locationwise IS
  'Statement-level catalog stock total sync for REST/ERP batch inserts.';

COMMENT ON TRIGGER trg_stock_locationwise_sync_item_total_update ON public.stock_locationwise IS
  'Statement-level catalog stock total sync for REST/ERP batch updates.';

COMMENT ON TRIGGER trg_stock_locationwise_sync_item_total_delete ON public.stock_locationwise IS
  'Statement-level catalog stock total sync for REST/ERP batch deletes.';
