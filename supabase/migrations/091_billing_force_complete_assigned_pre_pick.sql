-- Billing can skip warehouse pick for approved orders even when a picker is
-- assigned but has not started (preview claim). Expire the preview claim first.

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

COMMENT ON FUNCTION public.billing_force_complete_pre_pick(BIGINT, BIGINT, TEXT) IS
  'Billing: skip warehouse pick and mark an approved order completed (unassigned or assigned-but-not-started).';
