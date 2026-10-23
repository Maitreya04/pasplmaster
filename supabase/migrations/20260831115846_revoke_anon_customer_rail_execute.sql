-- The original customer-rail function granted anon explicitly. Removing the
-- inherited PUBLIC grant alone does not revoke that direct privilege.
REVOKE EXECUTE ON FUNCTION public.get_salesperson_top_customers_live(TEXT, INTEGER) FROM anon;
