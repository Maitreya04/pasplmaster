-- PASPL Master — keep stock_locationwise aligned when only items.stock_qty changes
-- (legacy Busy/MSSQL worker path that does not send apply_erp_items_delta `locations`).
--
-- After UPDATE/INSERT of items.stock_qty for a row with busy_code:
--   If sum(main_store + jabalpur) already equals stock_qty → no-op.
--   Else rescale the two warehouses to match stock_qty (preserve ratio), or
--   if there was no location stock, put the full total on Main Store.
--
-- Skips when stock_qty is NULL (unknown total — do not invent splits).

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
  'Keeps stock_locationwise (Main Store + Jabalpur) sum aligned with items.stock_qty when the item row changes; preserves split ratio when rescaling.';

DROP TRIGGER IF EXISTS trg_items_reconcile_location_stock ON public.items;

CREATE TRIGGER trg_items_reconcile_location_stock
  AFTER INSERT OR UPDATE OF stock_qty
  ON public.items
  FOR EACH ROW
  WHEN (NEW.busy_code IS NOT NULL AND NEW.stock_qty IS NOT NULL)
  EXECUTE FUNCTION public.reconcile_stock_locationwise_to_item_total();
