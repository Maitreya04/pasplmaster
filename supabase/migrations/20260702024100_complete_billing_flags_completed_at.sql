-- Flagged/OOS billing resolution must stamp completed_at so completed queues
-- and daily handoff filters treat the order as fully closed.

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
        completed_at = COALESCE(completed_at, now()),
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
