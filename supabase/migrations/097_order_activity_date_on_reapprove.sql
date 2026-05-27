-- Orders re-approved after revive (or any second billing pass) must land on the
-- processing day, not the original submission / first-approval day.

CREATE OR REPLACE FUNCTION public.complete_billing(
  p_order_id BIGINT,
  p_claim_id BIGINT,
  p_user_id BIGINT,
  p_is_resolving_flags BOOLEAN DEFAULT false,
  p_fulfillment_path TEXT DEFAULT 'warehouse_pick'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim RECORD;
  v_user_name TEXT;
  v_path TEXT;
BEGIN
  v_path := COALESCE(NULLIF(trim(p_fulfillment_path), ''), 'warehouse_pick');
  IF v_path NOT IN ('warehouse_pick', 'direct_bill') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_fulfillment_path');
  END IF;

  SELECT id, order_id, stage, claimed_by_user_id
  INTO v_claim
  FROM public.work_claims
  WHERE id = p_claim_id
    AND order_id = p_order_id
    AND stage = 'billing'
    AND claimed_by_user_id = p_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'No active billing claim found');
  END IF;

  SELECT full_name INTO v_user_name FROM public.users WHERE id = p_user_id;

  UPDATE public.work_claims
  SET status = 'completed',
      completed_at = now()
  WHERE id = p_claim_id;

  UPDATE public.stock_reservations sr
  SET qty_reserved = GREATEST(COALESCE(oi.qty_approved, oi.qty_shippable, 0), 0),
      status = CASE
        WHEN GREATEST(COALESCE(oi.qty_approved, oi.qty_shippable, 0), 0) > 0 THEN 'awaiting_erp_sync'
        ELSE 'released'
      END,
      awaiting_erp_sync_at = CASE
        WHEN GREATEST(COALESCE(oi.qty_approved, oi.qty_shippable, 0), 0) > 0 THEN now()
        ELSE sr.awaiting_erp_sync_at
      END,
      released_at = CASE
        WHEN GREATEST(COALESCE(oi.qty_approved, oi.qty_shippable, 0), 0) > 0 THEN sr.released_at
        ELSE COALESCE(sr.released_at, now())
      END,
      last_reconciled_at = now()
  FROM public.order_items oi
  WHERE sr.order_item_id = oi.id
    AND sr.order_id = p_order_id
    AND sr.status IN ('active', 'released', 'awaiting_erp_sync');

  IF p_is_resolving_flags THEN
    UPDATE public.orders
    SET workflow_status = 'completed',
        reviewer_name = v_user_name,
        priority = 'normal',
        fulfillment_path = v_path
    WHERE id = p_order_id;

    INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
    VALUES (p_order_id, 'billing_flags_resolved', p_user_id, 'billing',
            jsonb_build_object('reviewer', v_user_name, 'fulfillment_path', v_path));
  ELSIF v_path = 'direct_bill' THEN
    UPDATE public.orders
    SET workflow_status = 'completed',
        reviewer_name = v_user_name,
        approved_at = now(),
        completed_at = now(),
        fulfillment_path = v_path
    WHERE id = p_order_id;

    INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
    VALUES (p_order_id, 'billing_approved', p_user_id, 'billing',
            jsonb_build_object('reviewer', v_user_name, 'fulfillment_path', v_path));
  ELSE
    UPDATE public.orders
    SET workflow_status = 'approved',
        reviewer_name = v_user_name,
        approved_at = now(),
        fulfillment_path = v_path
    WHERE id = p_order_id;

    INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
    VALUES (p_order_id, 'billing_approved', p_user_id, 'billing',
            jsonb_build_object('reviewer', v_user_name, 'fulfillment_path', v_path));
  END IF;

  RETURN jsonb_build_object('success', true, 'fulfillment_path', v_path);
END;
$$;

CREATE OR REPLACE FUNCTION public.revive_billing_order(
  p_order_id BIGINT,
  p_actor_user_id BIGINT,
  p_actor_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_hold_notes TEXT;
  v_reservation_result JSONB;
BEGIN
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  IF v_order.workflow_status IS DISTINCT FROM 'rejected' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_rejected');
  END IF;

  IF v_order.rejection_kind IS DISTINCT FROM 'account_hold' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_account_hold');
  END IF;

  v_hold_notes := v_order.notes;

  v_reservation_result := public.recreate_stock_reservations_for_order(
    p_order_id,
    p_actor_user_id,
    p_actor_name
  );

  IF COALESCE((v_reservation_result->>'success')::BOOLEAN, false) IS NOT TRUE THEN
    RETURN v_reservation_result;
  END IF;

  UPDATE public.orders
  SET
    workflow_status = 'submitted',
    rejection_kind = NULL,
    revived_at = now(),
    notes = NULL,
    approved_at = NULL,
    reviewer_name = NULL,
    picker_name = NULL,
    picked_at = NULL,
    completed_at = NULL,
    fulfillment_path = NULL
  WHERE id = p_order_id;

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
  VALUES (
    p_order_id,
    'billing_order_revived',
    p_actor_user_id,
    'billing',
    jsonb_build_object(
      'actor_name', p_actor_name,
      'previous_hold_notes', v_hold_notes,
      'warnings', COALESCE(v_reservation_result->'warnings', '[]'::jsonb)
    )
  );

  PERFORM public.emit_queue_event(
    'billing',
    'order_submitted',
    p_order_id,
    'submitted',
    p_actor_user_id,
    jsonb_build_object('order_number', v_order.order_number, 'via', 'revive')
  );

  RETURN jsonb_build_object(
    'success', true,
    'warnings', COALESCE(v_reservation_result->'warnings', '[]'::jsonb)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.get_billing_queue_snapshot(text[], timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.get_billing_queue_snapshot(text[], timestamptz, timestamptz, timestamptz);

CREATE FUNCTION public.get_billing_queue_snapshot(
  p_statuses text[] DEFAULT NULL,
  p_created_from timestamptz DEFAULT NULL,
  p_created_to timestamptz DEFAULT NULL,
  p_completed_from timestamptz DEFAULT NULL
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
  claim_is_stale BOOLEAN,
  sales_edit_claim_id BIGINT,
  sales_edit_claimed_by_user_id BIGINT,
  sales_edit_claimed_by_name TEXT,
  sales_edit_claimed_at TIMESTAMPTZ,
  sales_edit_last_heartbeat_at TIMESTAMPTZ,
  sales_edit_claim_is_stale BOOLEAN
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
      AND (p_completed_from IS NULL OR completed_at >= p_completed_from)
      AND (
        p_created_from IS NULL
        OR GREATEST(
          created_at,
          COALESCE(revived_at, '-infinity'::timestamptz),
          COALESCE(approved_at, '-infinity'::timestamptz),
          COALESCE(picked_at, '-infinity'::timestamptz),
          COALESCE(completed_at, '-infinity'::timestamptz)
        ) >= p_created_from
      )
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
  ),
  active_sales_edit_claims AS (
    SELECT DISTINCT ON (wc.order_id)
      wc.order_id,
      wc.id AS sales_edit_claim_id,
      wc.claimed_by_user_id AS sales_edit_claimed_by_user_id,
      u.full_name AS sales_edit_claimed_by_name,
      wc.claimed_at AS sales_edit_claimed_at,
      wc.last_heartbeat_at AS sales_edit_last_heartbeat_at,
      ((now() - wc.last_heartbeat_at) > INTERVAL '3 minutes') AS sales_edit_claim_is_stale
    FROM public.work_claims wc
    LEFT JOIN public.users u ON u.id = wc.claimed_by_user_id
    WHERE wc.stage = 'sales_edit'
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
    abc.claim_is_stale,
    asec.sales_edit_claim_id,
    asec.sales_edit_claimed_by_user_id,
    asec.sales_edit_claimed_by_name,
    asec.sales_edit_claimed_at,
    asec.sales_edit_last_heartbeat_at,
    asec.sales_edit_claim_is_stale
  FROM filtered_orders o
  LEFT JOIN line_summary ls ON ls.order_id = o.id
  LEFT JOIN active_billing_claims abc ON abc.order_id = o.id
  LEFT JOIN active_sales_edit_claims asec ON asec.order_id = o.id
  ORDER BY o.created_at DESC;
$$;

COMMENT ON FUNCTION public.get_billing_queue_snapshot(TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Billing queue snapshot. p_created_from = any workflow activity today; p_completed_from = bills closed today (completed_at).';

GRANT EXECUTE ON FUNCTION public.get_billing_queue_snapshot(TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ)
  TO PUBLIC;

COMMENT ON FUNCTION public.revive_billing_order(BIGINT, BIGINT, TEXT) IS
  'Billing: return account-hold order to submitted queue, clear prior approval/pick timestamps, recreate stock reservations.';

-- Backfill: revived orders re-approved with a stale approved_at still show on the old day.
UPDATE public.orders o
SET approved_at = latest.event_at
FROM (
  SELECT
    oe.order_id,
    MAX(oe.created_at) AS event_at
  FROM public.order_events oe
  INNER JOIN public.orders ord ON ord.id = oe.order_id
  WHERE oe.event_type = 'billing_approved'
    AND ord.revived_at IS NOT NULL
    AND oe.created_at >= ord.revived_at
  GROUP BY oe.order_id
) latest
WHERE o.id = latest.order_id
  AND o.workflow_status IN ('approved', 'picking')
  AND o.revived_at IS NOT NULL
  AND COALESCE(o.approved_at, '-infinity'::timestamptz) < latest.event_at;
