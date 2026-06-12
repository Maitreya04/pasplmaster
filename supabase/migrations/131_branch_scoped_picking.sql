-- Branch-scoped pick queue: assign orders matching picker's stock_location_code.

CREATE OR REPLACE FUNCTION public.assign_next_picking_order(p_user_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name text;
  v_user_branch text;
  v_claim_id bigint;
  v_order_id bigint;
  v_existing_claim record;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_user_id');
  END IF;

  SELECT full_name, stock_location_code
  INTO v_user_name, v_user_branch
  FROM public.users
  WHERE id = p_user_id AND is_active = true;

  IF v_user_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'user_not_found');
  END IF;

  IF v_user_branch IS NULL OR btrim(v_user_branch) = '' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_branch');
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
    AND o.stock_location_code = v_user_branch
    AND public.order_has_pickable_lines(o.id)
    AND (o.picker_name IS NULL OR btrim(o.picker_name) = '')
    AND NOT EXISTS (
      SELECT 1
      FROM public.work_claims wc
      WHERE wc.order_id = o.id
        AND wc.stage = 'picking'
        AND wc.status = 'active'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.work_claims wc
      WHERE wc.order_id = o.id
        AND wc.stage = 'sales_edit'
        AND wc.status = 'active'
        AND (now() - wc.last_heartbeat_at) <= INTERVAL '3 minutes'
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

COMMENT ON FUNCTION public.assign_next_picking_order(bigint) IS
  'Atomically assign next approved pick order for the picker branch (stock_location_code). Skips direct_bill and sales_edit locks.';
