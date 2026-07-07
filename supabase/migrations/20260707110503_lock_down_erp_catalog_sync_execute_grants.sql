-- PASPL Master — lock ERP catalog sync RPCs to service_role.
--
-- These functions are sync endpoints, not browser APIs. Explicitly revoke
-- inherited/previous execute grants from public client roles.

REVOKE ALL ON FUNCTION public.upsert_erp_items_catalog(JSONB, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_erp_items_catalog(JSONB, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_erp_items_catalog(JSONB, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_erp_items_catalog(JSONB, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.upsert_erp_items_catalog_with_stock_legacy(JSONB, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_erp_items_catalog_with_stock_legacy(JSONB, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_erp_items_catalog_with_stock_legacy(JSONB, TEXT, JSONB) FROM authenticated;
REVOKE ALL ON FUNCTION public.upsert_erp_items_catalog_with_stock_legacy(JSONB, TEXT, JSONB) FROM service_role;
