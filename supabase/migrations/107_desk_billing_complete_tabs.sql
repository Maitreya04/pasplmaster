-- Desk Review vs Completed: direct-bill finalization, snapshot fields, force-complete reviewer.

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
  v_requested_path TEXT;
  v_downgraded BOOLEAN := false;
BEGIN
  v_requested_path := COALESCE(NULLIF(trim(p_fulfillment_path), ''), 'warehouse_pick');
  v_path := v_requested_path;
  IF v_path NOT IN ('warehouse_pick', 'direct_bill') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_fulfillment_path');
  END IF;

  IF v_path = 'warehouse_pick' AND NOT public.order_has_pickable_lines(p_order_id) THEN
    v_path := 'direct_bill';
    v_downgraded := true;
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
            jsonb_build_object(
              'reviewer', v_user_name,
              'fulfillment_path', v_path,
              'requested_fulfillment_path', v_requested_path,
              'pick_path_downgraded', v_downgraded
            ));
  ELSIF v_path = 'direct_bill' THEN
    UPDATE public.orders
    SET workflow_status = 'completed',
        reviewer_name = v_user_name,
        approved_at = COALESCE(approved_at, now()),
        completed_at = COALESCE(completed_at, now()),
        fulfillment_path = v_path
    WHERE id = p_order_id;

    INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
    VALUES (p_order_id, 'billing_approved', p_user_id, 'billing',
            jsonb_build_object(
              'reviewer', v_user_name,
              'fulfillment_path', v_path,
              'requested_fulfillment_path', v_requested_path,
              'pick_path_downgraded', v_downgraded
            ));
  ELSE
    UPDATE public.orders
    SET workflow_status = 'approved',
        approved_at = COALESCE(approved_at, now()),
        fulfillment_path = v_path
    WHERE id = p_order_id;

    INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
    VALUES (p_order_id, 'billing_approved', p_user_id, 'billing',
            jsonb_build_object(
              'billing_approver', v_user_name,
              'fulfillment_path', v_path,
              'requested_fulfillment_path', v_requested_path,
              'pick_path_downgraded', v_downgraded
            ));
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'fulfillment_path', v_path,
    'requested_fulfillment_path', v_requested_path,
    'pick_path_downgraded', v_downgraded
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.billing_force_complete_pre_pick(
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
  v_actor_name TEXT;
  v_active_picking_claim RECORD;
BEGIN
  v_actor_name := COALESCE(NULLIF(TRIM(p_actor_name), ''), 'Billing');

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'order_not_found');
  END IF;

  IF v_order.workflow_status IS DISTINCT FROM 'approved' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_approved');
  END IF;

  IF v_order.fulfillment_path = 'direct_bill' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_direct_bill');
  END IF;

  SELECT wc.id, u.full_name AS claimer_name
  INTO v_active_picking_claim
  FROM public.work_claims wc
  JOIN public.users u ON u.id = wc.claimed_by_user_id
  WHERE wc.order_id = p_order_id
    AND wc.stage = 'picking'
    AND wc.status = 'active'
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.work_claims
    SET status = 'expired',
        released_at = now()
    WHERE id = v_active_picking_claim.id;

    INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
    VALUES (
      p_order_id,
      'claim_expired',
      p_actor_user_id,
      'picking',
      jsonb_build_object(
        'expired_claim_id', v_active_picking_claim.id,
        'expired_user', v_active_picking_claim.claimer_name,
        'reason', 'billing_force_complete_pre_pick',
        'previous_picker', v_order.picker_name
      )
    );
  END IF;

  UPDATE public.orders
  SET workflow_status = 'completed',
      fulfillment_path = 'direct_bill',
      reviewer_name = v_actor_name,
      completed_at = COALESCE(completed_at, now()),
      priority = 'normal'
  WHERE id = p_order_id;

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
  VALUES (
    p_order_id,
    'picking_completed',
    p_actor_user_id,
    'billing',
    jsonb_build_object(
      'billing_actor', v_actor_name,
      'has_flags', false,
      'via', 'billing_force_complete_pre_pick',
      'previous_picker', v_order.picker_name,
      'skipped_assigned_pick', v_order.picker_name IS NOT NULL
    )
  );

  PERFORM public.emit_queue_event(
    'billing',
    'picking_completed',
    p_order_id,
    'completed',
    p_actor_user_id,
    jsonb_build_object(
      'billing_actor', v_actor_name,
      'via', 'billing_force_complete_pre_pick'
    )
  );

  PERFORM public.emit_queue_event(
    'picking',
    'picking_skipped',
    p_order_id,
    'completed',
    p_actor_user_id,
    jsonb_build_object(
      'billing_actor', v_actor_name,
      'via', 'billing_force_complete_pre_pick'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'workflow_status', 'completed'
  );
END;
$$;

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
  stock_location_code TEXT,
  fulfillment_path TEXT,
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
      stock_location_code,
      fulfillment_path,
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
    o.stock_location_code,
    o.fulfillment_path,
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

GRANT EXECUTE ON FUNCTION public.get_billing_queue_snapshot(TEXT[], TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ)
  TO PUBLIC;
