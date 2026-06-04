-- revive_billing_order must not null fulfillment_path (NOT NULL since migration 078).

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
    p_order_id::bigint,
    p_actor_user_id::bigint,
    p_actor_name::text
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
    fulfillment_path = COALESCE(v_order.fulfillment_path, 'warehouse_pick')
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

COMMENT ON FUNCTION public.revive_billing_order(BIGINT, BIGINT, TEXT) IS
  'Billing: return account-hold order to submitted queue; keeps fulfillment_path (defaults to warehouse_pick).';
