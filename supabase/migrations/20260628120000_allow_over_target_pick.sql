-- Allow picker over-target picks (e.g. 9 pcs when line ordered 3) so billing
-- receives the actual picked qty. Extra units stay shippable; PO qty unchanged.

CREATE OR REPLACE FUNCTION public.split_order_item_at_pick(
  p_order_id BIGINT,
  p_claim_id BIGINT,
  p_user_id BIGINT,
  p_root_order_item_id BIGINT,
  p_segment_qty INTEGER,
  p_confirmed_mrp NUMERIC,
  p_scan_result JSONB,
  p_is_first_segment BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim RECORD;
  v_order RECORD;
  v_root public.order_items%ROWTYPE;
  v_user_name TEXT;
  v_new_id BIGINT;
  v_reservation RECORD;
  v_po_ratio NUMERIC;
  v_segment_po INTEGER;
  v_bill_line_no INTEGER;
  v_bill_mrp NUMERIC;
  v_original_qty INTEGER;
  v_is_over_target BOOLEAN;
BEGIN
  IF p_segment_qty IS NULL OR p_segment_qty < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_qty');
  END IF;

  IF p_confirmed_mrp IS NULL OR p_confirmed_mrp < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_mrp');
  END IF;

  v_bill_mrp := ROUND(p_confirmed_mrp);

  IF p_claim_id IS NOT NULL THEN
    SELECT id, order_id, stage, claimed_by_user_id
    INTO v_claim
    FROM public.work_claims
    WHERE id = p_claim_id
      AND order_id = p_order_id
      AND stage = 'picking'
      AND claimed_by_user_id = p_user_id
      AND status = 'active';

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'claim_lost');
    END IF;
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  IF v_order.workflow_status IS DISTINCT FROM 'picking' THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_picking');
  END IF;

  SELECT full_name INTO v_user_name FROM public.users WHERE id = p_user_id;
  IF v_user_name IS NULL THEN
    v_user_name := 'Picker';
  END IF;

  SELECT *
  INTO v_root
  FROM public.order_items
  WHERE id = p_root_order_item_id
    AND order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'line_not_found');
  END IF;

  IF p_is_first_segment THEN
    v_original_qty := COALESCE(v_root.qty_requested, 0);
    v_is_over_target := p_segment_qty > v_original_qty;

    IF v_is_over_target THEN
      -- Extra pcs bill today; do not inflate sales PO backlog.
      v_segment_po := COALESCE(v_root.qty_po, 0);
    ELSE
      v_po_ratio := CASE
        WHEN v_original_qty > 0
          THEN COALESCE(v_root.qty_po, 0)::NUMERIC / v_original_qty::NUMERIC
        ELSE 0
      END;
      v_segment_po := FLOOR(p_segment_qty * v_po_ratio)::INT;
    END IF;

    UPDATE public.order_items
    SET
      qty_requested = p_segment_qty,
      qty_shippable = p_segment_qty,
      qty_approved = p_segment_qty,
      qty_po = v_segment_po,
      confirmed_mrp = p_confirmed_mrp,
      price_quoted = CASE WHEN COALESCE(is_foc, false) THEN price_quoted ELSE v_bill_mrp END,
      scan_result = p_scan_result,
      state = 'picked'
    WHERE id = p_root_order_item_id;

    SELECT *
    INTO v_reservation
    FROM public.stock_reservations
    WHERE order_item_id = p_root_order_item_id
      AND status IN ('active', 'awaiting_erp_sync')
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.stock_reservations
      SET qty_reserved = p_segment_qty
      WHERE id = v_reservation.id;
    END IF;

    INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
    VALUES (
      p_order_id,
      'pick_line_mrp_split',
      p_user_id,
      'picking',
      jsonb_build_object(
        'root_order_item_id', p_root_order_item_id,
        'order_item_id', p_root_order_item_id,
        'segment_qty', p_segment_qty,
        'confirmed_mrp', p_confirmed_mrp,
        'is_first_segment', true,
        'is_over_target', v_is_over_target,
        'original_qty_requested', v_original_qty
      )
    );

    UPDATE public.orders o
    SET
      item_count = sub.cnt,
      total_value = sub.tval
    FROM (
      SELECT
        COUNT(*)::INT AS cnt,
        COALESCE(SUM(COALESCE(oi.price_quoted, 0) * GREATEST(COALESCE(oi.qty_shippable, 0), 0)), 0)::NUMERIC AS tval
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    ) sub
    WHERE o.id = p_order_id;

    RETURN jsonb_build_object(
      'success', true,
      'order_item_id', p_root_order_item_id,
      'is_new_row', false,
      'is_over_target', v_is_over_target
    );
  END IF;

  v_po_ratio := CASE
    WHEN COALESCE(v_root.qty_requested, 0) > 0
      THEN COALESCE(v_root.qty_po, 0)::NUMERIC / v_root.qty_requested::NUMERIC
    ELSE 0
  END;
  v_segment_po := FLOOR(p_segment_qty * v_po_ratio)::INT;

  v_bill_line_no := public.allocate_split_bill_line_no(p_order_id, p_root_order_item_id);

  INSERT INTO public.order_items (
    order_id,
    item_id,
    item_name,
    item_alias,
    rack_no,
    qty_requested,
    qty_shippable,
    qty_po,
    qty_approved,
    price_quoted,
    price_system,
    state,
    stock_location_code,
    is_foc,
    split_from_id,
    confirmed_mrp,
    scan_result,
    bill_line_no
  )
  VALUES (
    p_order_id,
    v_root.item_id,
    v_root.item_name,
    v_root.item_alias,
    v_root.rack_no,
    p_segment_qty,
    p_segment_qty,
    v_segment_po,
    p_segment_qty,
    CASE WHEN COALESCE(v_root.is_foc, false) THEN v_root.price_quoted ELSE v_bill_mrp END,
    v_root.price_system,
    'picked',
    v_root.stock_location_code,
    COALESCE(v_root.is_foc, false),
    p_root_order_item_id,
    p_confirmed_mrp,
    p_scan_result,
    v_bill_line_no
  )
  RETURNING id INTO v_new_id;

  SELECT *
  INTO v_reservation
  FROM public.stock_reservations
  WHERE order_item_id = p_root_order_item_id
    AND status IN ('active', 'awaiting_erp_sync')
  LIMIT 1;

  IF FOUND AND v_root.item_id IS NOT NULL THEN
    INSERT INTO public.stock_reservations (
      order_id,
      order_item_id,
      item_id,
      busy_code,
      stock_location_code,
      qty_reserved,
      status,
      source,
      created_by_user_id,
      created_by
    )
    SELECT
      v_reservation.order_id,
      v_new_id,
      v_reservation.item_id,
      v_reservation.busy_code,
      v_reservation.stock_location_code,
      p_segment_qty,
      'active',
      'pick_mrp_split',
      p_user_id,
      v_user_name
    FROM public.stock_reservations sr
    WHERE sr.id = v_reservation.id;
  END IF;

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
  VALUES (
    p_order_id,
    'pick_line_mrp_split',
    p_user_id,
    'picking',
    jsonb_build_object(
      'root_order_item_id', p_root_order_item_id,
      'order_item_id', v_new_id,
      'segment_qty', p_segment_qty,
      'confirmed_mrp', p_confirmed_mrp,
      'is_first_segment', false
    )
  );

  UPDATE public.orders o
  SET
    item_count = sub.cnt,
    total_value = sub.tval
  FROM (
    SELECT
      COUNT(*)::INT AS cnt,
      COALESCE(SUM(COALESCE(oi.price_quoted, 0) * GREATEST(COALESCE(oi.qty_shippable, 0), 0)), 0)::NUMERIC AS tval
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  ) sub
  WHERE o.id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_item_id', v_new_id,
    'is_new_row', true
  );
END;
$$;

COMMENT ON FUNCTION public.split_order_item_at_pick(BIGINT, BIGINT, BIGINT, BIGINT, INTEGER, NUMERIC, JSONB, BOOLEAN) IS
  'Commit MRP-split pick segment. Over-target picks update qty_requested to the picked amount for billing.';
