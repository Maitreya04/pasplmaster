-- Billing desk: assign a specific approved order to a picker (creates picking claim).

CREATE OR REPLACE FUNCTION public.billing_assign_picker(
  p_order_id BIGINT,
  p_picker_user_id BIGINT,
  p_actor_user_id BIGINT,
  p_actor_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_picker_name TEXT;
  v_actor_name TEXT;
  v_claim_id BIGINT;
  v_existing_claim RECORD;
  v_stale_threshold INTERVAL := INTERVAL '3 minutes';
BEGIN
  v_actor_name := COALESCE(NULLIF(TRIM(p_actor_name), ''), 'Billing');

  IF p_order_id IS NULL OR p_picker_user_id IS NULL OR p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_params');
  END IF;

  SELECT full_name INTO v_picker_name
  FROM public.users
  WHERE id = p_picker_user_id
    AND role = 'picking'
    AND is_active = true;

  IF v_picker_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'picker_not_found');
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'order_not_found');
  END IF;

  IF v_order.workflow_status IS DISTINCT FROM 'approved' THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'not_approved',
      'workflow_status', v_order.workflow_status
    );
  END IF;

  IF v_order.fulfillment_path = 'direct_bill' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'direct_bill');
  END IF;

  -- Resume if this picker already holds an active claim on the order.
  SELECT wc.id
  INTO v_claim_id
  FROM public.work_claims wc
  WHERE wc.order_id = p_order_id
    AND wc.stage = 'picking'
    AND wc.status = 'active'
    AND wc.claimed_by_user_id = p_picker_user_id;

  IF FOUND THEN
    UPDATE public.orders
    SET workflow_status = 'picking',
        picker_name = v_picker_name,
        picked_at = COALESCE(picked_at, now())
    WHERE id = p_order_id;

    RETURN jsonb_build_object(
      'success', true,
      'claim_id', v_claim_id,
      'picker_name', v_picker_name,
      'resumed', true
    );
  END IF;

  -- Block if another picker has a fresh active claim.
  SELECT wc.id, wc.claimed_by_user_id, wc.last_heartbeat_at, u.full_name AS claimer_name
  INTO v_existing_claim
  FROM public.work_claims wc
  JOIN public.users u ON u.id = wc.claimed_by_user_id
  WHERE wc.order_id = p_order_id
    AND wc.stage = 'picking'
    AND wc.status = 'active';

  IF FOUND THEN
    IF (now() - v_existing_claim.last_heartbeat_at) > v_stale_threshold THEN
      UPDATE public.work_claims
      SET status = 'expired',
          released_at = now()
      WHERE id = v_existing_claim.id;

      INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
      VALUES (
        p_order_id,
        'claim_expired',
        p_actor_user_id,
        'picking',
        jsonb_build_object(
          'expired_claim_id', v_existing_claim.id,
          'expired_user', v_existing_claim.claimer_name,
          'reason', 'heartbeat_timeout',
          'via', 'billing_assign_picker'
        )
      );
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'picking_in_progress',
        'claimed_by', v_existing_claim.claimer_name
      );
    END IF;
  END IF;

  INSERT INTO public.work_claims (order_id, stage, claimed_by_user_id)
  VALUES (p_order_id, 'picking', p_picker_user_id)
  RETURNING id INTO v_claim_id;

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
  VALUES (
    p_order_id,
    'picking_claimed',
    p_picker_user_id,
    'picking',
    jsonb_build_object(
      'assigned_by', v_actor_name,
      'assigned_by_user_id', p_actor_user_id,
      'via', 'billing_desk'
    )
  );

  UPDATE public.orders
  SET workflow_status = 'picking',
      picker_name = v_picker_name,
      picked_at = COALESCE(picked_at, now())
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'claim_id', v_claim_id,
    'picker_name', v_picker_name,
    'resumed', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.billing_assign_picker(BIGINT, BIGINT, BIGINT, TEXT)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.billing_assign_picker(BIGINT, BIGINT, BIGINT, TEXT) IS
  'Billing desk: assign an approved warehouse-pick order to a specific picker and create an active picking claim.';
