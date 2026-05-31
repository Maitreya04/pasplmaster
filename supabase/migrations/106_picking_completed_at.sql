-- When the warehouse pick stage ends (clean or flagged), independent of billing close.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS picking_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.orders.picking_completed_at IS
  'When the picker finished the warehouse pick stage; set even when workflow_status is flagged.';

-- Backfill historical picks.
UPDATE public.orders o
SET picking_completed_at = COALESCE(
  o.picking_completed_at,
  o.completed_at,
  (
    SELECT MAX(wc.completed_at)
    FROM public.work_claims wc
    WHERE wc.order_id = o.id
      AND wc.stage = 'picking'
      AND wc.completed_at IS NOT NULL
  ),
  (
    SELECT MAX(oe.created_at)
    FROM public.order_events oe
    WHERE oe.order_id = o.id
      AND oe.event_type = 'picking_completed'
  )
)
WHERE o.workflow_status IN ('completed', 'flagged')
  AND o.picking_completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_picker_picking_completed
  ON public.orders (picker_name, picking_completed_at DESC)
  WHERE picker_name IS NOT NULL AND picking_completed_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.complete_picking(
  p_order_id BIGINT,
  p_claim_id BIGINT,
  p_user_id BIGINT,
  p_has_flags BOOLEAN DEFAULT false,
  p_box_count INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim RECORD;
  v_user_name TEXT;
  v_new_status TEXT;
BEGIN
  IF p_box_count IS NOT NULL AND p_box_count < 1 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_box_count');
  END IF;

  SELECT id, order_id, stage, claimed_by_user_id
  INTO v_claim
  FROM public.work_claims
  WHERE id = p_claim_id
    AND order_id = p_order_id
    AND stage = 'picking'
    AND claimed_by_user_id = p_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'No active picking claim found');
  END IF;

  SELECT full_name INTO v_user_name FROM public.users WHERE id = p_user_id;

  UPDATE public.work_claims
  SET status = 'completed',
      completed_at = now()
  WHERE id = p_claim_id;

  v_new_status := CASE WHEN p_has_flags THEN 'flagged' ELSE 'completed' END;

  IF p_has_flags THEN
    UPDATE public.orders
    SET workflow_status = 'flagged',
        picking_completed_at = COALESCE(picking_completed_at, now()),
        box_count = COALESCE(p_box_count, box_count)
    WHERE id = p_order_id;
  ELSE
    UPDATE public.orders
    SET workflow_status = 'completed',
        completed_at = COALESCE(completed_at, now()),
        picking_completed_at = COALESCE(picking_completed_at, now()),
        priority = 'normal',
        box_count = COALESCE(p_box_count, box_count)
    WHERE id = p_order_id;
  END IF;

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
  VALUES (
    p_order_id,
    'picking_completed',
    p_user_id,
    'picking',
    jsonb_build_object(
      'picker', v_user_name,
      'has_flags', p_has_flags,
      'box_count', p_box_count
    )
  );

  IF p_box_count IS NOT NULL THEN
    PERFORM public.emit_queue_event(
      'billing',
      'pick_ready_for_billing',
      p_order_id,
      v_new_status,
      p_user_id,
      jsonb_build_object(
        'picker', v_user_name,
        'has_flags', p_has_flags,
        'box_count', p_box_count
      )
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

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
      picking_completed_at = COALESCE(picking_completed_at, now()),
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
