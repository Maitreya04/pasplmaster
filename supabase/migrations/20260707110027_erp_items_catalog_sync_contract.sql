-- PASPL Master — ERP item catalog sync contract.
--
-- Busy/ERP is the source of truth for synced catalog identity. Keep
-- public.items.name unique for app search/display, but make integrations use
-- busy_code as the durable key and perform idempotent upserts.

CREATE TABLE IF NOT EXISTS public.erp_item_catalog_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'erp_catalog_sync',
  rows_in INTEGER NOT NULL DEFAULT 0,
  rows_invalid INTEGER NOT NULL DEFAULT 0,
  rows_staged INTEGER NOT NULL DEFAULT 0,
  rows_claimed_legacy INTEGER NOT NULL DEFAULT 0,
  rows_updated INTEGER NOT NULL DEFAULT 0,
  rows_inserted INTEGER NOT NULL DEFAULT 0,
  rows_skipped_name_conflict INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  extra JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.erp_item_catalog_sync_runs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.erp_item_catalog_sync_runs IS
  'Audit log for Busy/ERP item catalog upserts into public.items.';

GRANT SELECT, INSERT ON public.erp_item_catalog_sync_runs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.erp_item_catalog_sync_runs_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_erp_items_catalog(
  p_rows JSONB,
  p_source TEXT DEFAULT 'erp_catalog_sync',
  p_extra JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_in INTEGER := 0;
  v_invalid INTEGER := 0;
  v_staged INTEGER := 0;
  v_claimed INTEGER := 0;
  v_updated INTEGER := 0;
  v_inserted INTEGER := 0;
  v_name_conflicts INTEGER := 0;
  v_run_id BIGINT;
  v_num TEXT := '^-?[0-9]+(\.[0-9]+)?$';
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'p_rows must be a JSON array'
    );
  END IF;

  v_in := coalesce(jsonb_array_length(p_rows), 0);

  IF v_in = 0 THEN
    RETURN jsonb_build_object(
      'success', true,
      'run_id', NULL,
      'rows_in', 0,
      'rows_invalid', 0,
      'rows_staged', 0,
      'rows_claimed_legacy', 0,
      'rows_updated', 0,
      'rows_inserted', 0,
      'rows_skipped_name_conflict', 0
    );
  END IF;

  DROP TABLE IF EXISTS pg_temp.erp_item_catalog_stage;

  CREATE TEMP TABLE erp_item_catalog_stage (
    ord INTEGER NOT NULL,
    busy_code BIGINT NOT NULL,
    name TEXT NOT NULL,
    alias TEXT,
    alias1 TEXT,
    parent_group TEXT,
    main_group TEXT,
    item_category TEXT,
    gst_percent NUMERIC,
    hsn_code TEXT,
    sales_price NUMERIC,
    mrp NUMERIC,
    stock_qty NUMERIC,
    rack_no TEXT,
    selling_unit TEXT,
    is_active BOOLEAN,
    has_alias BOOLEAN NOT NULL,
    has_alias1 BOOLEAN NOT NULL,
    has_parent_group BOOLEAN NOT NULL,
    has_main_group BOOLEAN NOT NULL,
    has_item_category BOOLEAN NOT NULL,
    has_gst_percent BOOLEAN NOT NULL,
    has_hsn_code BOOLEAN NOT NULL,
    has_sales_price BOOLEAN NOT NULL,
    has_mrp BOOLEAN NOT NULL,
    has_stock_qty BOOLEAN NOT NULL,
    has_rack_no BOOLEAN NOT NULL,
    has_selling_unit BOOLEAN NOT NULL,
    has_is_active BOOLEAN NOT NULL
  ) ON COMMIT DROP;

  WITH expanded AS (
    SELECT elem, ordinality::INTEGER AS ord
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(elem, ordinality)
  ),
  parsed AS (
    SELECT
      ord,
      NULLIF(trim(coalesce(
        elem->>'busy_code',
        elem->>'busyCode',
        elem->>'BusyCode',
        elem->>'item_code',
        elem->>'itemCode',
        elem->>'code'
      )), '') AS busy_code_text,
      NULLIF(trim(coalesce(
        elem->>'name',
        elem->>'item_name',
        elem->>'itemName',
        elem->>'Itemname',
        elem->>'item_description',
        elem->>'description'
      )), '') AS name,
      NULLIF(trim(coalesce(elem->>'alias', elem->>'item_alias')), '') AS alias,
      NULLIF(trim(coalesce(elem->>'alias1', elem->>'alias_1', elem->>'part_no', elem->>'partNo')), '') AS alias1,
      NULLIF(trim(coalesce(elem->>'parent_group', elem->>'parentGroup')), '') AS parent_group,
      NULLIF(trim(coalesce(elem->>'main_group', elem->>'mainGroup')), '') AS main_group,
      NULLIF(trim(coalesce(elem->>'item_category', elem->>'itemCategory')), '') AS item_category,
      NULLIF(trim(coalesce(elem->>'gst_percent', elem->>'gstPercent', elem->>'gst')), '') AS gst_percent_text,
      NULLIF(trim(coalesce(elem->>'hsn_code', elem->>'hsnCode', elem->>'hsn')), '') AS hsn_code,
      NULLIF(trim(replace(coalesce(elem->>'sales_price', elem->>'salesPrice', elem->>'salesprice'), ',', '')), '') AS sales_price_text,
      NULLIF(trim(replace(elem->>'mrp', ',', '')), '') AS mrp_text,
      NULLIF(trim(replace(coalesce(elem->>'stock_qty', elem->>'stockQty', elem->>'stock'), ',', '')), '') AS stock_qty_text,
      NULLIF(trim(coalesce(elem->>'rack_no', elem->>'rackNo', elem->>'rack')), '') AS rack_no,
      NULLIF(trim(coalesce(elem->>'selling_unit', elem->>'sellingUnit')), '') AS selling_unit,
      NULLIF(trim(coalesce(elem->>'is_active', elem->>'isActive')), '') AS is_active_text,
      (elem ? 'alias' OR elem ? 'item_alias') AS has_alias,
      (elem ? 'alias1' OR elem ? 'alias_1' OR elem ? 'part_no' OR elem ? 'partNo') AS has_alias1,
      (elem ? 'parent_group' OR elem ? 'parentGroup') AS has_parent_group,
      (elem ? 'main_group' OR elem ? 'mainGroup') AS has_main_group,
      (elem ? 'item_category' OR elem ? 'itemCategory') AS has_item_category,
      (elem ? 'gst_percent' OR elem ? 'gstPercent' OR elem ? 'gst') AS has_gst_percent,
      (elem ? 'hsn_code' OR elem ? 'hsnCode' OR elem ? 'hsn') AS has_hsn_code,
      (elem ? 'sales_price' OR elem ? 'salesPrice' OR elem ? 'salesprice') AS has_sales_price,
      (elem ? 'mrp') AS has_mrp,
      (elem ? 'stock_qty' OR elem ? 'stockQty' OR elem ? 'stock') AS has_stock_qty,
      (elem ? 'rack_no' OR elem ? 'rackNo' OR elem ? 'rack') AS has_rack_no,
      (elem ? 'selling_unit' OR elem ? 'sellingUnit') AS has_selling_unit,
      (elem ? 'is_active' OR elem ? 'isActive') AS has_is_active
    FROM expanded
  ),
  valid AS (
    SELECT *
    FROM parsed
    WHERE busy_code_text ~ v_num
      AND name IS NOT NULL
      AND (gst_percent_text IS NULL OR gst_percent_text ~ v_num)
      AND (sales_price_text IS NULL OR sales_price_text ~ v_num)
      AND (mrp_text IS NULL OR mrp_text ~ v_num)
      AND (stock_qty_text IS NULL OR stock_qty_text ~ v_num)
      AND (selling_unit IS NULL OR selling_unit IN ('piece', 'packet', 'box'))
      AND (is_active_text IS NULL OR lower(is_active_text) IN ('true', 'false', 't', 'f', '1', '0', 'yes', 'no'))
  ),
  deduped AS (
    SELECT DISTINCT ON (busy_code_text::BIGINT)
      ord,
      busy_code_text::BIGINT AS busy_code,
      name,
      alias,
      alias1,
      parent_group,
      main_group,
      item_category,
      CASE
        WHEN gst_percent_text IS NULL THEN NULL
        WHEN gst_percent_text::NUMERIC > 0 AND gst_percent_text::NUMERIC < 1 THEN gst_percent_text::NUMERIC * 100
        ELSE gst_percent_text::NUMERIC
      END AS gst_percent,
      hsn_code,
      sales_price_text::NUMERIC AS sales_price,
      mrp_text::NUMERIC AS mrp,
      stock_qty_text::NUMERIC AS stock_qty,
      rack_no,
      selling_unit,
      CASE
        WHEN is_active_text IS NULL THEN NULL
        WHEN lower(is_active_text) IN ('true', 't', '1', 'yes') THEN true
        ELSE false
      END AS is_active,
      has_alias,
      has_alias1,
      has_parent_group,
      has_main_group,
      has_item_category,
      has_gst_percent,
      has_hsn_code,
      has_sales_price,
      has_mrp,
      has_stock_qty,
      has_rack_no,
      has_selling_unit,
      has_is_active
    FROM valid
    ORDER BY busy_code_text::BIGINT, ord DESC
  )
  INSERT INTO erp_item_catalog_stage
  SELECT * FROM deduped;

  SELECT count(*) INTO v_staged FROM erp_item_catalog_stage;
  v_invalid := v_in - (SELECT count(*) FROM (
    SELECT 1
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(elem, ordinality)
    WHERE NULLIF(trim(coalesce(
        elem->>'busy_code', elem->>'busyCode', elem->>'BusyCode',
        elem->>'item_code', elem->>'itemCode', elem->>'code'
      )), '') ~ v_num
      AND NULLIF(trim(coalesce(
        elem->>'name', elem->>'item_name', elem->>'itemName', elem->>'Itemname',
        elem->>'item_description', elem->>'description'
      )), '') IS NOT NULL
  ) ok);

  -- Legacy rows may exist with a matching name but no busy_code. Claim those
  -- rows instead of inserting a duplicate catalog item.
  UPDATE public.items i
  SET
    busy_code = s.busy_code,
    alias = CASE WHEN s.has_alias THEN s.alias ELSE i.alias END,
    alias1 = CASE WHEN s.has_alias1 THEN s.alias1 ELSE i.alias1 END,
    parent_group = CASE WHEN s.has_parent_group THEN s.parent_group ELSE i.parent_group END,
    main_group = CASE WHEN s.has_main_group THEN s.main_group ELSE i.main_group END,
    item_category = CASE WHEN s.has_item_category THEN s.item_category ELSE i.item_category END,
    gst_percent = CASE WHEN s.has_gst_percent THEN s.gst_percent ELSE i.gst_percent END,
    hsn_code = CASE WHEN s.has_hsn_code THEN s.hsn_code ELSE i.hsn_code END,
    sales_price = CASE WHEN s.has_sales_price THEN s.sales_price ELSE i.sales_price END,
    mrp = CASE WHEN s.has_mrp THEN s.mrp ELSE i.mrp END,
    stock_qty = CASE WHEN s.has_stock_qty THEN s.stock_qty ELSE i.stock_qty END,
    rack_no = CASE WHEN s.has_rack_no THEN s.rack_no ELSE i.rack_no END,
    selling_unit = CASE WHEN s.has_selling_unit THEN s.selling_unit ELSE i.selling_unit END,
    is_active = CASE WHEN s.has_is_active THEN s.is_active ELSE i.is_active END
  FROM erp_item_catalog_stage s
  WHERE i.name = s.name
    AND i.busy_code IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.items existing
      WHERE existing.busy_code = s.busy_code
    );

  GET DIAGNOSTICS v_claimed = ROW_COUNT;

  UPDATE public.items i
  SET
    name = CASE
      WHEN i.name IS DISTINCT FROM s.name
       AND NOT EXISTS (SELECT 1 FROM public.items n WHERE n.name = s.name AND n.id <> i.id)
      THEN s.name
      ELSE i.name
    END,
    alias = CASE WHEN s.has_alias THEN s.alias ELSE i.alias END,
    alias1 = CASE WHEN s.has_alias1 THEN s.alias1 ELSE i.alias1 END,
    parent_group = CASE WHEN s.has_parent_group THEN s.parent_group ELSE i.parent_group END,
    main_group = CASE WHEN s.has_main_group THEN s.main_group ELSE i.main_group END,
    item_category = CASE WHEN s.has_item_category THEN s.item_category ELSE i.item_category END,
    gst_percent = CASE WHEN s.has_gst_percent THEN s.gst_percent ELSE i.gst_percent END,
    hsn_code = CASE WHEN s.has_hsn_code THEN s.hsn_code ELSE i.hsn_code END,
    sales_price = CASE WHEN s.has_sales_price THEN s.sales_price ELSE i.sales_price END,
    mrp = CASE WHEN s.has_mrp THEN s.mrp ELSE i.mrp END,
    stock_qty = CASE WHEN s.has_stock_qty THEN s.stock_qty ELSE i.stock_qty END,
    rack_no = CASE WHEN s.has_rack_no THEN s.rack_no ELSE i.rack_no END,
    selling_unit = CASE WHEN s.has_selling_unit THEN s.selling_unit ELSE i.selling_unit END,
    is_active = CASE WHEN s.has_is_active THEN s.is_active ELSE i.is_active END
  FROM erp_item_catalog_stage s
  WHERE i.busy_code = s.busy_code
    AND (
      (
        i.name IS DISTINCT FROM s.name
        AND NOT EXISTS (SELECT 1 FROM public.items n WHERE n.name = s.name AND n.id <> i.id)
      )
      OR (s.has_alias AND i.alias IS DISTINCT FROM s.alias)
      OR (s.has_alias1 AND i.alias1 IS DISTINCT FROM s.alias1)
      OR (s.has_parent_group AND i.parent_group IS DISTINCT FROM s.parent_group)
      OR (s.has_main_group AND i.main_group IS DISTINCT FROM s.main_group)
      OR (s.has_item_category AND i.item_category IS DISTINCT FROM s.item_category)
      OR (s.has_gst_percent AND i.gst_percent IS DISTINCT FROM s.gst_percent)
      OR (s.has_hsn_code AND i.hsn_code IS DISTINCT FROM s.hsn_code)
      OR (s.has_sales_price AND i.sales_price IS DISTINCT FROM s.sales_price)
      OR (s.has_mrp AND i.mrp IS DISTINCT FROM s.mrp)
      OR (s.has_stock_qty AND i.stock_qty IS DISTINCT FROM s.stock_qty)
      OR (s.has_rack_no AND i.rack_no IS DISTINCT FROM s.rack_no)
      OR (s.has_selling_unit AND i.selling_unit IS DISTINCT FROM s.selling_unit)
      OR (s.has_is_active AND i.is_active IS DISTINCT FROM s.is_active)
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT count(*)
  INTO v_name_conflicts
  FROM erp_item_catalog_stage s
  WHERE NOT EXISTS (
      SELECT 1 FROM public.items i
      WHERE i.busy_code = s.busy_code
    )
    AND EXISTS (
      SELECT 1 FROM public.items i
      WHERE i.name = s.name
        AND i.busy_code IS DISTINCT FROM s.busy_code
    );

  INSERT INTO public.items (
    busy_code,
    name,
    alias,
    alias1,
    parent_group,
    main_group,
    item_category,
    gst_percent,
    hsn_code,
    sales_price,
    mrp,
    stock_qty,
    rack_no,
    selling_unit,
    is_active
  )
  SELECT
    s.busy_code,
    s.name,
    s.alias,
    s.alias1,
    s.parent_group,
    s.main_group,
    s.item_category,
    coalesce(s.gst_percent, 18),
    s.hsn_code,
    coalesce(s.sales_price, 0),
    coalesce(s.mrp, 0),
    coalesce(s.stock_qty, 0),
    s.rack_no,
    coalesce(s.selling_unit, 'piece'),
    coalesce(s.is_active, true)
  FROM erp_item_catalog_stage s
  WHERE NOT EXISTS (
      SELECT 1 FROM public.items i
      WHERE i.busy_code = s.busy_code
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.items i
      WHERE i.name = s.name
    );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  INSERT INTO public.erp_item_catalog_sync_runs (
    source,
    rows_in,
    rows_invalid,
    rows_staged,
    rows_claimed_legacy,
    rows_updated,
    rows_inserted,
    rows_skipped_name_conflict,
    extra
  )
  VALUES (
    coalesce(nullif(trim(p_source), ''), 'erp_catalog_sync'),
    v_in,
    greatest(v_invalid, 0),
    v_staged,
    v_claimed,
    v_updated,
    v_inserted,
    v_name_conflicts,
    coalesce(p_extra, '{}'::jsonb) || jsonb_build_object(
      'upsert_erp_items_catalog', true
    )
  )
  RETURNING id INTO v_run_id;

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id,
    'rows_in', v_in,
    'rows_invalid', greatest(v_invalid, 0),
    'rows_staged', v_staged,
    'rows_claimed_legacy', v_claimed,
    'rows_updated', v_updated,
    'rows_inserted', v_inserted,
    'rows_skipped_name_conflict', v_name_conflicts
  );
END;
$$;

COMMENT ON FUNCTION public.upsert_erp_items_catalog(JSONB, TEXT, JSONB) IS
  'Idempotently upserts Busy/ERP item catalog rows into public.items using busy_code as the source-of-truth key.';

REVOKE ALL ON FUNCTION public.upsert_erp_items_catalog(JSONB, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_erp_items_catalog(JSONB, TEXT, JSONB) TO service_role;
