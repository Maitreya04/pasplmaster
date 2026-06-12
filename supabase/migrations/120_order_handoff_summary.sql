-- Read-only handoff summary for Desk Done/Finalise and picker screens.

CREATE OR REPLACE FUNCTION public.get_order_handoff_summary(p_order_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_checked_by TEXT;
  v_assigned_by TEXT;
  v_picked_by TEXT;
  v_bill_by TEXT;
  v_change_count INT;
BEGIN
  SELECT id, workflow_status, picker_name, reviewer_name, fulfillment_path
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(
    NULLIF(TRIM(oe.payload->>'reviewer'), ''),
    NULLIF(TRIM(oe.payload->>'billing_approver'), ''),
    NULLIF(TRIM(u.full_name), '')
  )
  INTO v_checked_by
  FROM public.order_events oe
  LEFT JOIN public.users u ON u.id = oe.actor_user_id
  WHERE oe.order_id = p_order_id
    AND oe.event_type = 'billing_approved'
  ORDER BY oe.created_at DESC
  LIMIT 1;

  SELECT NULLIF(TRIM(oe.payload->>'assigned_by'), '')
  INTO v_assigned_by
  FROM public.order_events oe
  WHERE oe.order_id = p_order_id
    AND oe.event_type = 'picking_claimed'
    AND NULLIF(TRIM(oe.payload->>'assigned_by'), '') IS NOT NULL
  ORDER BY oe.created_at DESC
  LIMIT 1;

  SELECT COALESCE(
    NULLIF(TRIM(oe.payload->>'picker'), ''),
    NULLIF(TRIM(oe.payload->>'billing_actor'), '')
  )
  INTO v_picked_by
  FROM public.order_events oe
  WHERE oe.order_id = p_order_id
    AND oe.event_type = 'picking_completed'
  ORDER BY oe.created_at DESC
  LIMIT 1;

  IF v_picked_by IS NULL THEN
    v_picked_by := NULLIF(TRIM(v_order.picker_name), '');
  END IF;

  SELECT COALESCE(
    NULLIF(TRIM(oe.payload->>'reviewer'), ''),
    NULLIF(TRIM(u.full_name), '')
  )
  INTO v_bill_by
  FROM public.order_events oe
  LEFT JOIN public.users u ON u.id = oe.actor_user_id
  WHERE oe.order_id = p_order_id
    AND oe.event_type = 'billing_flags_resolved'
  ORDER BY oe.created_at DESC
  LIMIT 1;

  IF v_bill_by IS NULL AND v_order.workflow_status = 'completed' THEN
    v_bill_by := NULLIF(TRIM(v_order.reviewer_name), '');
  END IF;

  SELECT COUNT(*)::INT
  INTO v_change_count
  FROM public.order_events oe
  WHERE oe.order_id = p_order_id
    AND oe.event_type IN ('billing_line_removed', 'billing_line_edited', 'pick_line_reverted');

  RETURN jsonb_build_object(
    'checkedBy', v_checked_by,
    'assignedBy', v_assigned_by,
    'pickedBy', v_picked_by,
    'billBy', v_bill_by,
    'changeCount', COALESCE(v_change_count, 0),
    'fulfillmentPath', v_order.fulfillment_path
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_order_handoff_summary(BIGINT)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_order_handoff_summary(BIGINT) IS
  'Returns who checked, assigned, picked, and finalised an order plus bill-change count from order_events.';
