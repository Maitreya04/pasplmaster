-- =========================================================================
-- VALIDATION (run manually in SQL Editor after migration applies):
-- =========================================================================
--
-- 1. Confirm v1 and v2 return identical row sets for active queue:
-- SELECT COUNT(*) FROM (
--   SELECT * FROM public.get_billing_queue_snapshot(
--     ARRAY['pending_review','in_review']::text[], NULL, NULL)
--   EXCEPT
--   SELECT * FROM public.get_billing_queue_snapshot_v1(
--     ARRAY['pending_review','in_review']::text[], NULL, NULL)
-- ) diff;
-- -- Expected: 0
--
-- 2. Compare timing:
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM public.get_billing_queue_snapshot_v1(
--   ARRAY['pending_review','in_review']::text[], NULL, NULL);
--
-- EXPLAIN (ANALYZE, BUFFERS)
-- SELECT * FROM public.get_billing_queue_snapshot(
--   ARRAY['pending_review','in_review']::text[], NULL, NULL);
--
-- Expected: v2 has lower "Execution Time" and fewer "shared hit/read" buffers.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.is_ask_line(
  p_main_group text,
  p_parent_group text,
  p_item_name text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT
    UPPER(COALESCE(p_main_group, '')) = 'ASK'
    OR UPPER(COALESCE(p_parent_group, '')) = 'ASK'
    OR UPPER(COALESCE(p_item_name, '')) = 'ASK'
    OR UPPER(COALESCE(p_item_name, '')) LIKE 'ASK %'
    OR UPPER(COALESCE(p_item_name, '')) LIKE 'ASK-%'
    OR UPPER(COALESCE(p_item_name, '')) ~ '(^|[^A-Z0-9])ASK([^A-Z0-9]|$)';
$$;

ALTER FUNCTION public.get_billing_queue_snapshot(text[], timestamptz, timestamptz)
RENAME TO get_billing_queue_snapshot_v1;

CREATE OR REPLACE FUNCTION public.get_billing_queue_snapshot(
  p_statuses text[] DEFAULT NULL,
  p_created_from timestamptz DEFAULT NULL,
  p_created_to timestamptz DEFAULT NULL
) RETURNS TABLE (
  id BIGINT,
  order_number TEXT,
  order_kind TEXT,
  customer_id BIGINT,
  customer_name TEXT,
  customer_city TEXT,
  transport_id BIGINT,
  transport_name TEXT,
  salesperson_name TEXT,
  salesperson_user_id BIGINT,
  reviewer_name TEXT,
  picker_name TEXT,
  workflow_status TEXT,
  priority TEXT,
  notes TEXT,
  item_count INTEGER,
  ask_line_count INTEGER,
  special_rate_line_count INTEGER,
  special_rate_qty INTEGER,
  total_value NUMERIC,
  created_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  picked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  claim_id BIGINT,
  claimed_by_user_id BIGINT,
  claimed_by_name TEXT,
  claimed_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  claim_is_stale BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered_orders AS (
    SELECT
      id,
      order_number,
      order_kind,
      customer_id,
      customer_name,
      customer_city,
      transport_id,
      transport_name,
      salesperson_name,
      salesperson_user_id,
      reviewer_name,
      picker_name,
      workflow_status,
      priority,
      notes,
      item_count,
      total_value,
      created_at,
      approved_at,
      picked_at,
      completed_at,
      dispatched_at
    FROM public.orders
    WHERE (p_statuses IS NULL OR workflow_status = ANY(p_statuses))
      AND (p_created_from IS NULL OR created_at >= p_created_from)
      AND (p_created_to IS NULL OR created_at <= p_created_to)
  ),
  line_summary AS (
    SELECT
      oi.order_id,
      COUNT(*)::INTEGER AS live_item_count,
      COUNT(*) FILTER (
        WHERE public.is_ask_line(i.main_group, i.parent_group, oi.item_name)
      )::INTEGER AS ask_line_count,
      COUNT(*) FILTER (
        WHERE oi.price_quoted IS NOT NULL
          AND oi.price_system IS NOT NULL
          AND oi.price_quoted IS DISTINCT FROM oi.price_system
      )::INTEGER AS special_rate_line_count,
      COALESCE(
        SUM(
          CASE
            WHEN oi.price_quoted IS NOT NULL
              AND oi.price_system IS NOT NULL
              AND oi.price_quoted IS DISTINCT FROM oi.price_system
            THEN GREATEST(COALESCE(oi.qty_requested, 0), 0)
            ELSE 0
          END
        ),
        0
      )::INTEGER AS special_rate_qty
    FROM public.order_items oi
    INNER JOIN filtered_orders fo ON fo.id = oi.order_id
    LEFT JOIN public.items i ON i.id = oi.item_id
    GROUP BY oi.order_id
  ),
  active_billing_claims AS (
    SELECT DISTINCT ON (wc.order_id)
      wc.order_id,
      wc.id AS claim_id,
      wc.claimed_by_user_id,
      u.full_name AS claimed_by_name,
      wc.claimed_at,
      wc.last_heartbeat_at,
      ((now() - wc.last_heartbeat_at) > INTERVAL '3 minutes') AS claim_is_stale
    FROM public.work_claims wc
    LEFT JOIN public.users u ON u.id = wc.claimed_by_user_id
    WHERE wc.stage = 'billing'
      AND wc.status = 'active'
    ORDER BY wc.order_id, wc.claimed_at DESC
  )
  SELECT
    o.id,
    o.order_number,
    o.order_kind,
    o.customer_id,
    o.customer_name,
    o.customer_city,
    o.transport_id,
    o.transport_name,
    o.salesperson_name,
    o.salesperson_user_id,
    o.reviewer_name,
    o.picker_name,
    o.workflow_status,
    o.priority,
    o.notes,
    COALESCE(ls.live_item_count, o.item_count, 0)::INTEGER AS item_count,
    COALESCE(ls.ask_line_count, 0)::INTEGER AS ask_line_count,
    COALESCE(ls.special_rate_line_count, 0)::INTEGER AS special_rate_line_count,
    COALESCE(ls.special_rate_qty, 0)::INTEGER AS special_rate_qty,
    COALESCE(o.total_value, 0) AS total_value,
    o.created_at,
    o.approved_at,
    o.picked_at,
    o.completed_at,
    o.dispatched_at,
    abc.claim_id,
    abc.claimed_by_user_id,
    abc.claimed_by_name,
    abc.claimed_at,
    abc.last_heartbeat_at,
    abc.claim_is_stale
  FROM filtered_orders o
  LEFT JOIN line_summary ls ON ls.order_id = o.id
  LEFT JOIN active_billing_claims abc ON abc.order_id = o.id
  ORDER BY o.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_billing_queue_snapshot(TEXT[], TIMESTAMPTZ, TIMESTAMPTZ)
  TO PUBLIC;

COMMENT ON FUNCTION public.get_billing_queue_snapshot(TEXT[], TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Compact billing queue payload used with queue_events Realtime to reduce free-tier egress.';
