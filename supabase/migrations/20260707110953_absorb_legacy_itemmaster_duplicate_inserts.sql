-- Keep the current legacy ItemMaster importer from aborting on duplicate item
-- names while the importer is moved to the catalog RPC/upsert contract.
--
-- This intentionally does not weaken items_name_key or items_busy_code_key.
-- Duplicate names are absorbed as idempotent catalog refreshes. Stock remains
-- owned by the stock sync path, so stock_qty is never copied from these raw
-- inserts.

CREATE OR REPLACE FUNCTION public.absorb_legacy_itemmaster_duplicate_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.items%ROWTYPE;
  v_alias TEXT := NULLIF(BTRIM(NEW.alias), '');
  v_alias1 TEXT := NULLIF(BTRIM(NEW.alias1), '');
  v_parent_group TEXT := NULLIF(BTRIM(NEW.parent_group), '');
  v_main_group TEXT := NULLIF(BTRIM(NEW.main_group), '');
  v_item_category TEXT := NULLIF(BTRIM(NEW.item_category), '');
  v_hsn_code TEXT := NULLIF(BTRIM(NEW.hsn_code), '');
  v_rack_no TEXT := NULLIF(BTRIM(NEW.rack_no), '');
  v_busy_code_available BOOLEAN := FALSE;
BEGIN
  IF NEW.name IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT i.*
  INTO v_existing
  FROM public.items AS i
  WHERE i.name = NEW.name
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.busy_code IS NOT NULL AND v_existing.busy_code IS NULL THEN
    SELECT NOT EXISTS (
      SELECT 1
      FROM public.items AS busy_item
      WHERE busy_item.busy_code IS NOT DISTINCT FROM NEW.busy_code
        AND busy_item.id <> v_existing.id
    )
    INTO v_busy_code_available;
  END IF;

  UPDATE public.items AS i
  SET
    busy_code = CASE
      WHEN v_busy_code_available THEN NEW.busy_code
      ELSE i.busy_code
    END,
    alias = COALESCE(v_alias, i.alias),
    alias1 = COALESCE(v_alias1, i.alias1),
    parent_group = COALESCE(v_parent_group, i.parent_group),
    main_group = COALESCE(v_main_group, i.main_group),
    item_category = COALESCE(v_item_category, i.item_category),
    hsn_code = COALESCE(v_hsn_code, i.hsn_code),
    rack_no = COALESCE(v_rack_no, i.rack_no),
    sales_price = CASE
      WHEN NEW.sales_price IS NOT NULL AND NEW.sales_price > 0 THEN NEW.sales_price
      ELSE i.sales_price
    END,
    mrp = CASE
      WHEN NEW.mrp IS NOT NULL AND NEW.mrp > 0 THEN NEW.mrp
      ELSE i.mrp
    END
  WHERE i.id = v_existing.id
    AND (
      (v_busy_code_available AND i.busy_code IS DISTINCT FROM NEW.busy_code)
      OR (v_alias IS NOT NULL AND i.alias IS DISTINCT FROM v_alias)
      OR (v_alias1 IS NOT NULL AND i.alias1 IS DISTINCT FROM v_alias1)
      OR (v_parent_group IS NOT NULL AND i.parent_group IS DISTINCT FROM v_parent_group)
      OR (v_main_group IS NOT NULL AND i.main_group IS DISTINCT FROM v_main_group)
      OR (v_item_category IS NOT NULL AND i.item_category IS DISTINCT FROM v_item_category)
      OR (v_hsn_code IS NOT NULL AND i.hsn_code IS DISTINCT FROM v_hsn_code)
      OR (v_rack_no IS NOT NULL AND i.rack_no IS DISTINCT FROM v_rack_no)
      OR (NEW.sales_price IS NOT NULL AND NEW.sales_price > 0 AND i.sales_price IS DISTINCT FROM NEW.sales_price)
      OR (NEW.mrp IS NOT NULL AND NEW.mrp > 0 AND i.mrp IS DISTINCT FROM NEW.mrp)
    );

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_items_absorb_legacy_itemmaster_duplicate_insert ON public.items;

CREATE TRIGGER trg_items_absorb_legacy_itemmaster_duplicate_insert
  BEFORE INSERT ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.absorb_legacy_itemmaster_duplicate_insert();

COMMENT ON FUNCTION public.absorb_legacy_itemmaster_duplicate_insert() IS
  'Absorbs duplicate-name raw ItemMaster inserts as catalog refreshes while ignoring stock_qty/is_active/default-sensitive fields; stock remains owned by stock sync RPCs.';
