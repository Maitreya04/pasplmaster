-- PASPL Master — protect stock source of truth in catalog sync.
--
-- public.upsert_erp_items_catalog is for ERP item identity/catalog metadata.
-- Stock remains owned by the existing stock sync path:
--   - public.apply_stock_locationwise_delta(...)
--   - public.apply_erp_items_delta(...)
--
-- The first catalog RPC accepted stock_qty if present. Keep that implementation
-- as an internal legacy helper, then expose a wrapper with the original name
-- that strips stock fields before delegating. This prevents a catalog batch
-- from accidentally competing with live stock_locationwise / MRP stock sync.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'upsert_erp_items_catalog'
      AND pg_get_function_identity_arguments(p.oid) = 'p_rows jsonb, p_source text, p_extra jsonb'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'upsert_erp_items_catalog_with_stock_legacy'
      AND pg_get_function_identity_arguments(p.oid) = 'p_rows jsonb, p_source text, p_extra jsonb'
  ) THEN
    ALTER FUNCTION public.upsert_erp_items_catalog(JSONB, TEXT, JSONB)
      RENAME TO upsert_erp_items_catalog_with_stock_legacy;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_erp_items_catalog_with_stock_legacy(JSONB, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_erp_items_catalog_with_stock_legacy(JSONB, TEXT, JSONB) FROM service_role;

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
  v_rows JSONB;
  v_stock_field_rows INTEGER := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'p_rows must be a JSON array'
    );
  END IF;

  SELECT
    coalesce(jsonb_agg(elem - 'stock_qty' - 'stockQty' - 'stock' ORDER BY ord), '[]'::jsonb),
    count(*) FILTER (WHERE elem ? 'stock_qty' OR elem ? 'stockQty' OR elem ? 'stock')::INTEGER
  INTO v_rows, v_stock_field_rows
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(elem, ord);

  RETURN public.upsert_erp_items_catalog_with_stock_legacy(
    v_rows,
    p_source,
    coalesce(p_extra, '{}'::jsonb) || jsonb_build_object(
      'catalog_rpc_ignores_stock_qty', true,
      'rows_with_stock_qty_ignored', coalesce(v_stock_field_rows, 0)
    )
  );
END;
$$;

COMMENT ON FUNCTION public.upsert_erp_items_catalog(JSONB, TEXT, JSONB) IS
  'Idempotently upserts Busy/ERP item catalog rows into public.items using busy_code; ignores stock_qty so stock remains owned by stock sync RPCs.';

REVOKE ALL ON FUNCTION public.upsert_erp_items_catalog(JSONB, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_erp_items_catalog(JSONB, TEXT, JSONB) TO service_role;
