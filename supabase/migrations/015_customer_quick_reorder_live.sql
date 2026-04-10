-- Quick Reorder: live stats from app orders (orders + order_items), not upload-only customer_top_items.

CREATE OR REPLACE FUNCTION public.get_customer_quick_reorder_stats(
  p_customer_id bigint,
  p_limit integer DEFAULT 15
)
RETURNS TABLE (
  item_id bigint,
  order_count integer,
  most_common_qty integer,
  last_ordered timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH per_line AS (
    SELECT
      oi.item_id,
      o.id AS order_id,
      oi.qty_requested,
      o.created_at
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.customer_id = p_customer_id
      AND o.workflow_status IS DISTINCT FROM 'flagged'
  ),
  counts AS (
    SELECT
      pl.item_id,
      pl.qty_requested,
      COUNT(*)::bigint AS freq
    FROM per_line pl
    GROUP BY pl.item_id, pl.qty_requested
  ),
  mode_qty AS (
    SELECT DISTINCT ON (c.item_id)
      c.item_id,
      c.qty_requested::integer AS most_common_qty
    FROM counts c
    ORDER BY c.item_id, c.freq DESC, c.qty_requested DESC
  ),
  agg AS (
    SELECT
      pl.item_id,
      COUNT(DISTINCT pl.order_id)::integer AS order_count,
      MAX(pl.created_at) AS last_ordered
    FROM per_line pl
    GROUP BY pl.item_id
  )
  SELECT
    a.item_id,
    a.order_count,
    m.most_common_qty,
    a.last_ordered
  FROM agg a
  LEFT JOIN mode_qty m ON m.item_id = a.item_id
  ORDER BY a.order_count DESC, a.last_ordered DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 15), 50));
$fn$;

COMMENT ON FUNCTION public.get_customer_quick_reorder_stats(bigint, integer) IS
  'Top lines per customer from submitted app orders (excludes flagged). Used for Quick Reorder; updates as orders are recorded.';

GRANT EXECUTE ON FUNCTION public.get_customer_quick_reorder_stats(bigint, integer) TO anon, authenticated;
