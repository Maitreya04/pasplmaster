-- Billing can force-complete orders stuck in picking when the picker's claim is stale.

CREATE OR REPLACE FUNCTION public.billing_complete_stale_picking(
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
  v_claim RECORD;
  v_stale_threshold INTERVAL := INTERVAL '3 minutes';
  v_actor_name TEXT;
  v_has_flags BOOLEAN;
  v_new_status TEXT;
  v_flagged_count INTEGER;
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

  IF v_order.workflow_status IS DISTINCT FROM 'picking' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_picking');
  END IF;

  SELECT wc.id,
         wc.claimed_by_user_id,
         wc.last_heartbeat_at,
         u.full_name AS claimer_name
  INTO v_claim
  FROM public.work_claims wc
  JOIN public.users u ON u.id = wc.claimed_by_user_id
  WHERE wc.order_id = p_order_id
    AND wc.stage = 'picking'
    AND wc.status = 'active'
  FOR UPDATE;

  IF FOUND THEN
    IF (now() - v_claim.last_heartbeat_at) <= v_stale_threshold THEN
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'picking_still_active',
        'claimed_by', v_claim.claimer_name
      );
    END IF;

    UPDATE public.work_claims
    SET status = 'expired',
        released_at = now()
    WHERE id = v_claim.id;

    INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
    VALUES (
      p_order_id,
      'claim_expired',
      p_actor_user_id,
      'picking',
      jsonb_build_object(
        'expired_claim_id', v_claim.id,
        'expired_user', v_claim.claimer_name,
        'reason', 'billing_force_complete'
      )
    );
  END IF;

  SELECT count(*)::INTEGER
  INTO v_flagged_count
  FROM public.order_items
  WHERE order_id = p_order_id
    AND state = 'flagged';

  v_has_flags := v_flagged_count > 0;
  v_new_status := CASE WHEN v_has_flags THEN 'flagged' ELSE 'completed' END;

  UPDATE public.orders
  SET workflow_status = v_new_status,
      completed_at = CASE
        WHEN v_new_status = 'completed' THEN COALESCE(completed_at, now())
        ELSE completed_at
      END,
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
      'has_flags', v_has_flags,
      'flagged_count', v_flagged_count,
      'via', 'billing_stale_picking_complete',
      'previous_picker', v_order.picker_name
    )
  );

  PERFORM public.emit_queue_event(
    'billing',
    'picking_completed',
    p_order_id,
    v_new_status,
    p_actor_user_id,
    jsonb_build_object(
      'billing_actor', v_actor_name,
      'has_flags', v_has_flags,
      'via', 'billing_stale_picking_complete'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'workflow_status', v_new_status,
    'has_flags', v_has_flags,
    'flagged_count', v_flagged_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.billing_complete_stale_picking(BIGINT, BIGINT, TEXT)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.billing_complete_stale_picking(BIGINT, BIGINT, TEXT) IS
  'Billing: complete an order stuck in picking when the picker claim heartbeat is stale (>3 min).';
