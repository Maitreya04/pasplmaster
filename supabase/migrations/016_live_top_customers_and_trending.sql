-- Your Customers + Trending on New Order: live from app orders (not upload tables).

CREATE OR REPLACE FUNCTION public.get_salesperson_top_customers_live(
  p_salesperson_name text,
  p_limit integer DEFAULT 8
)
RETURNS TABLE (
  customer_name text,
  order_count integer,
  last_order_date date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    c.name AS customer_name,
    COUNT(DISTINCT o.id)::integer AS order_count,
    MAX(o.created_at)::date AS last_order_date
  FROM public.orders o
  JOIN public.customers c ON c.id = o.customer_id
  WHERE o.salesperson_name = p_salesperson_name
    AND o.workflow_status IS DISTINCT FROM 'flagged'
  GROUP BY c.id, c.name
  ORDER BY order_count DESC, MAX(o.created_at) DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 8), 50));
$fn$;

COMMENT ON FUNCTION public.get_salesperson_top_customers_live(text, integer) IS
  'Top customers for a salesperson by distinct app orders (excludes flagged). New Order "Your Customers" rail.';

CREATE OR REPLACE FUNCTION public.get_trending_items_live(
  p_limit integer DEFAULT 5
)
RETURNS TABLE (
  item_id bigint,
  order_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    oi.item_id,
    COUNT(DISTINCT o.id)::integer AS order_count
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.id
  WHERE o.workflow_status IS DISTINCT FROM 'flagged'
  GROUP BY oi.item_id
  ORDER BY order_count DESC, MAX(o.created_at) DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 5), 50));
$fn$;

COMMENT ON FUNCTION public.get_trending_items_live(integer) IS
  'Globally trending parts by how many distinct app orders include each item (excludes flagged). New Order Trending.';

GRANT EXECUTE ON FUNCTION public.get_salesperson_top_customers_live(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_trending_items_live(integer) TO anon, authenticated;
