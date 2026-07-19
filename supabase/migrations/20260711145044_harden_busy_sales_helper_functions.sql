ALTER FUNCTION public.normalize_sales_dimension(TEXT) SET search_path = pg_catalog;
ALTER FUNCTION public.busy_sales_date(TEXT) SET search_path = pg_catalog;
ALTER FUNCTION public.busy_sales_number(TEXT) SET search_path = pg_catalog;

REVOKE ALL ON FUNCTION public.normalize_sales_dimension(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.busy_sales_date(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.busy_sales_number(TEXT) FROM PUBLIC, anon, authenticated;
