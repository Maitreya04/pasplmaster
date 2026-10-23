-- Keep the Sales customer rail aligned with the ownership rule used by the
-- receivables RPCs. Salespeople may still search and order for any customer,
-- but their financial snapshots only appear for accounts currently assigned
-- to them. Admin and billing users retain their existing full access.

CREATE OR REPLACE FUNCTION public.get_salesperson_top_customers_live(
  p_salesperson_name TEXT,
  p_limit INTEGER DEFAULT 8
)
RETURNS TABLE (
  customer_name TEXT,
  order_count INTEGER,
  last_order_date DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    c.name AS customer_name,
    COUNT(DISTINCT o.id)::INTEGER AS order_count,
    MAX(o.created_at)::DATE AS last_order_date
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.salesperson_name = p_salesperson_name
    AND o.workflow_status IS DISTINCT FROM 'flagged'
    AND (
      public.current_user_role() IN ('admin', 'billing')
      OR public.receivables_can_view_customer(c.id)
    )
  GROUP BY c.id, c.name
  ORDER BY order_count DESC, MAX(o.created_at) DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 8), 50));
$fn$;

COMMENT ON FUNCTION public.get_salesperson_top_customers_live(TEXT, INTEGER) IS
  'Top customers from app orders, filtered to accounts whose receivables the current user may view.';

REVOKE ALL ON FUNCTION public.get_salesperson_top_customers_live(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_salesperson_top_customers_live(TEXT, INTEGER) TO authenticated, service_role;
