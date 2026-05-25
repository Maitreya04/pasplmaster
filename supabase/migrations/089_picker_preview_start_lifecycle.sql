-- Picker preview → Start lifecycle:
-- Assign/claim keeps workflow_status = 'approved' until picker explicitly starts.
-- start_picking transitions to 'picking' and records pick_started.

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

  SELECT wc.id
  INTO v_claim_id
  FROM public.work_claims wc
  WHERE wc.order_id = p_order_id
    AND wc.stage = 'picking'
    AND wc.status = 'active'
    AND wc.claimed_by_user_id = p_picker_user_id;

  IF FOUND THEN
    UPDATE public.orders
    SET picker_name = v_picker_name
    WHERE id = p_order_id;

    RETURN jsonb_build_object(
      'success', true,
      'claim_id', v_claim_id,
      'picker_name', v_picker_name,
      'resumed', true
    );
  END IF;

  SELECT wc.id, wc.claimed_by_user_id, wc.last_heartbeat_at, u.full_name AS claimer_name
  INTO v_existing_claim
  FROM public.work_claims wc
  JOIN public.users u ON u.id = wc.claimed_by_user_id
  WHERE wc.order_id = p_order_id
    AND wc.stage = 'picking'
    AND wc.status = 'active';

  IF FOUND THEN
    IF (now() - v_existing_claim.last_heartbeat_at) > v_stale_threshold
       AND EXISTS (
         SELECT 1 FROM public.orders o
         WHERE o.id = p_order_id AND o.workflow_status = 'picking'
       ) THEN
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
  SET picker_name = v_picker_name
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'claim_id', v_claim_id,
    'picker_name', v_picker_name,
    'resumed', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.start_picking(
  p_order_id BIGINT,
  p_user_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_claim RECORD;
  v_user_name TEXT;
BEGIN
  IF p_order_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_params');
  END IF;

  SELECT full_name INTO v_user_name
  FROM public.users
  WHERE id = p_user_id AND is_active = true;

  IF v_user_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'user_not_found');
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'order_not_found');
  END IF;

  IF v_order.fulfillment_path = 'direct_bill' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'direct_bill');
  END IF;

  IF v_order.workflow_status = 'picking' THEN
    SELECT wc.id, wc.claimed_by_user_id
    INTO v_claim
    FROM public.work_claims wc
    WHERE wc.order_id = p_order_id
      AND wc.stage = 'picking'
      AND wc.status = 'active'
      AND wc.claimed_by_user_id = p_user_id;

    IF FOUND THEN
      UPDATE public.work_claims
      SET last_heartbeat_at = now()
      WHERE id = v_claim.id;

      RETURN jsonb_build_object(
        'success', true,
        'claim_id', v_claim.id,
        'already_started', true
      );
    END IF;

    RETURN jsonb_build_object('success', false, 'reason', 'picking_in_progress');
  END IF;

  IF v_order.workflow_status IS DISTINCT FROM 'approved' THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'not_ready',
      'workflow_status', v_order.workflow_status
    );
  END IF;

  SELECT wc.id, wc.claimed_by_user_id
  INTO v_claim
  FROM public.work_claims wc
  WHERE wc.order_id = p_order_id
    AND wc.stage = 'picking'
    AND wc.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_claim');
  END IF;

  IF v_claim.claimed_by_user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_your_claim');
  END IF;

  UPDATE public.work_claims
  SET last_heartbeat_at = now()
  WHERE id = v_claim.id;

  UPDATE public.orders
  SET workflow_status = 'picking',
      picker_name = v_user_name,
      picked_at = COALESCE(picked_at, now())
  WHERE id = p_order_id;

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
  VALUES (
    p_order_id,
    'pick_started',
    p_user_id,
    'picking',
    jsonb_build_object('picker', v_user_name)
  );

  RETURN jsonb_build_object(
    'success', true,
    'claim_id', v_claim.id,
    'already_started', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION claim_order(
  p_order_id BIGINT,
  p_stage TEXT,
  p_user_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order RECORD;
  v_existing RECORD;
  v_claim_id BIGINT;
  v_user_name TEXT;
  v_stale_threshold INTERVAL := INTERVAL '3 minutes';
BEGIN
  IF p_stage NOT IN ('billing', 'picking') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Invalid stage');
  END IF;

  SELECT id, workflow_status INTO v_order
  FROM orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Order not found');
  END IF;

  SELECT full_name INTO v_user_name FROM users WHERE id = p_user_id AND is_active = true;
  IF v_user_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'User not found or inactive');
  END IF;

  SELECT wc.id, wc.claimed_by_user_id, wc.claimed_at, wc.last_heartbeat_at, wc.status,
         u.full_name AS claimer_name
  INTO v_existing
  FROM work_claims wc
  JOIN users u ON u.id = wc.claimed_by_user_id
  WHERE wc.order_id = p_order_id
    AND wc.stage = p_stage
    AND wc.status = 'active';

  IF FOUND THEN
    IF v_existing.claimed_by_user_id = p_user_id THEN
      RETURN jsonb_build_object(
        'success', true,
        'claim_id', v_existing.id,
        'claim_version', 1,
        'reclaimed', true
      );
    END IF;

    IF (now() - v_existing.last_heartbeat_at) > v_stale_threshold
       AND (p_stage <> 'picking' OR v_order.workflow_status = 'picking') THEN
      UPDATE work_claims
      SET status = 'expired',
          released_at = now()
      WHERE id = v_existing.id;

      INSERT INTO order_events (order_id, event_type, actor_user_id, stage, payload)
      VALUES (p_order_id, 'claim_expired', p_user_id, p_stage,
              jsonb_build_object(
                'expired_claim_id', v_existing.id,
                'expired_user', v_existing.claimer_name,
                'reason', 'heartbeat_timeout'
              ));

      INSERT INTO order_events (order_id, event_type, actor_user_id, stage, payload)
      VALUES (p_order_id, 'claim_takeover', p_user_id, p_stage,
              jsonb_build_object(
                'previous_owner', v_existing.claimer_name,
                'new_owner', v_user_name
              ));
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'already_claimed',
        'claimed_by', v_existing.claimer_name,
        'claimed_at', v_existing.claimed_at,
        'last_heartbeat_at', v_existing.last_heartbeat_at
      );
    END IF;
  END IF;

  INSERT INTO work_claims (order_id, stage, claimed_by_user_id)
  VALUES (p_order_id, p_stage, p_user_id)
  RETURNING id INTO v_claim_id;

  INSERT INTO order_events (order_id, event_type, actor_user_id, stage)
  VALUES (p_order_id,
          CASE p_stage WHEN 'billing' THEN 'billing_claimed' ELSE 'picking_claimed' END,
          p_user_id,
          p_stage);

  IF p_stage = 'picking' THEN
    UPDATE orders
    SET picker_name = v_user_name
    WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'claim_id', v_claim_id,
    'claim_version', 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION release_claim(
  p_claim_id BIGINT,
  p_user_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claim RECORD;
BEGIN
  SELECT wc.id, wc.order_id, wc.stage, wc.claimed_by_user_id
  INTO v_claim
  FROM work_claims wc
  WHERE wc.id = p_claim_id
    AND wc.claimed_by_user_id = p_user_id
    AND wc.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Claim not found or not active');
  END IF;

  UPDATE work_claims
  SET status = 'released',
      released_at = now()
  WHERE id = p_claim_id;

  INSERT INTO order_events (order_id, event_type, actor_user_id, stage)
  VALUES (v_claim.order_id,
          CASE v_claim.stage WHEN 'billing' THEN 'billing_released' ELSE 'picking_released' END,
          p_user_id,
          v_claim.stage);

  IF v_claim.stage = 'picking' THEN
    UPDATE orders
    SET workflow_status = 'approved',
        picker_name = NULL
    WHERE id = v_claim.order_id
      AND workflow_status IN ('picking', 'approved');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION expire_stale_claims()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_expired_count INTEGER := 0;
  v_claim RECORD;
  v_stale_threshold INTERVAL := INTERVAL '3 minutes';
BEGIN
  FOR v_claim IN
    SELECT wc.id, wc.order_id, wc.stage, wc.claimed_by_user_id, u.full_name, o.workflow_status
    FROM work_claims wc
    JOIN users u ON u.id = wc.claimed_by_user_id
    JOIN orders o ON o.id = wc.order_id
    WHERE wc.status = 'active'
      AND (now() - wc.last_heartbeat_at) > v_stale_threshold
      AND (wc.stage <> 'picking' OR o.workflow_status = 'picking')
  LOOP
    UPDATE work_claims
    SET status = 'expired',
        released_at = now()
    WHERE id = v_claim.id;

    INSERT INTO order_events (order_id, event_type, stage, payload)
    VALUES (v_claim.order_id, 'claim_expired', v_claim.stage,
            jsonb_build_object(
              'expired_claim_id', v_claim.id,
              'expired_user', v_claim.full_name,
              'reason', 'heartbeat_timeout'
            ));

    IF v_claim.stage = 'picking' THEN
      UPDATE orders
      SET workflow_status = 'approved',
          picker_name = NULL
      WHERE id = v_claim.order_id
        AND workflow_status = 'picking';
    END IF;

    v_expired_count := v_expired_count + 1;
  END LOOP;

  RETURN jsonb_build_object('expired_count', v_expired_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_next_picking_order(p_user_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name text;
  v_claim_id bigint;
  v_order_id bigint;
  v_existing_claim record;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_user_id');
  END IF;

  SELECT full_name INTO v_user_name
  FROM public.users
  WHERE id = p_user_id AND is_active = true;

  IF v_user_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'user_not_found');
  END IF;

  SELECT wc.id, wc.order_id, o.workflow_status
  INTO v_existing_claim
  FROM public.work_claims wc
  JOIN public.orders o ON o.id = wc.order_id
  WHERE wc.claimed_by_user_id = p_user_id
    AND wc.stage = 'picking'
    AND wc.status = 'active'
  ORDER BY wc.claimed_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'order_id', v_existing_claim.order_id,
      'claim_id', v_existing_claim.id,
      'resumed', true,
      'started', v_existing_claim.workflow_status = 'picking'
    );
  END IF;

  PERFORM public.expire_stale_claims();

  SELECT o.id
  INTO v_order_id
  FROM public.orders o
  WHERE o.workflow_status = 'approved'
    AND o.fulfillment_path IS DISTINCT FROM 'direct_bill'
    AND o.stock_location_code IS DISTINCT FROM 'jabalpur'
    AND public.order_has_pickable_lines(o.id)
    AND NOT EXISTS (
      SELECT 1
      FROM public.work_claims wc
      WHERE wc.order_id = o.id
        AND wc.stage = 'picking'
        AND wc.status = 'active'
    )
  ORDER BY
    (o.priority = 'urgent') DESC,
    o.approved_at DESC NULLS LAST,
    o.id DESC
  LIMIT 1
  FOR UPDATE OF o SKIP LOCKED;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'queue_empty');
  END IF;

  INSERT INTO public.work_claims (order_id, stage, claimed_by_user_id)
  VALUES (v_order_id, 'picking', p_user_id)
  RETURNING id INTO v_claim_id;

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage)
  VALUES (v_order_id, 'picking_claimed', p_user_id, 'picking');

  UPDATE public.orders
  SET picker_name = v_user_name
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'claim_id', v_claim_id,
    'resumed', false,
    'started', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_picking(BIGINT, BIGINT)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.start_picking(BIGINT, BIGINT) IS
  'Picker explicitly starts a claimed approved order — sets workflow_status to picking and records pick_started.';
