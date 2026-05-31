-- Picker finalisation: shipping carton count on orders + extended complete_picking.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS box_count INTEGER
  CHECK (box_count IS NULL OR box_count >= 1);

COMMENT ON COLUMN public.orders.box_count IS
  'Shipping cartons packed for this pick; set when picker finalises (not label MRP).';

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
        box_count = COALESCE(p_box_count, box_count)
    WHERE id = p_order_id;
  ELSE
    UPDATE public.orders
    SET workflow_status = 'completed',
        completed_at = COALESCE(completed_at, now()),
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

GRANT EXECUTE ON FUNCTION public.complete_picking(BIGINT, BIGINT, BIGINT, BOOLEAN, INTEGER)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.complete_picking(BIGINT, BIGINT, BIGINT, BOOLEAN, INTEGER) IS
  'Complete picking claim; optional box_count from picker finalisation emits pick_ready_for_billing.';
