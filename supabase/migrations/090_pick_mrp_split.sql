-- MRP split at pick: picker confirms qty per MRP band; materializes sibling billing lines.

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS split_from_id BIGINT REFERENCES public.order_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_mrp NUMERIC;

CREATE INDEX IF NOT EXISTS idx_order_items_split_from
  ON public.order_items(split_from_id)
  WHERE split_from_id IS NOT NULL;

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
BEGIN
  IF p_segment_qty IS NULL OR p_segment_qty < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_qty');
  END IF;

  IF p_confirmed_mrp IS NULL OR p_confirmed_mrp < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_mrp');
  END IF;

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
    IF p_segment_qty > v_root.qty_requested THEN
      RETURN jsonb_build_object('success', false, 'error', 'qty_exceeds_line');
    END IF;

    v_po_ratio := CASE
      WHEN COALESCE(v_root.qty_requested, 0) > 0
        THEN COALESCE(v_root.qty_po, 0)::NUMERIC / v_root.qty_requested::NUMERIC
      ELSE 0
    END;
    v_segment_po := FLOOR(p_segment_qty * v_po_ratio)::INT;

    UPDATE public.order_items
    SET
      qty_requested = p_segment_qty,
      qty_shippable = p_segment_qty,
      qty_approved = p_segment_qty,
      qty_po = v_segment_po,
      confirmed_mrp = p_confirmed_mrp,
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
        'is_first_segment', true
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
      'is_new_row', false
    );
  END IF;

  v_po_ratio := CASE
    WHEN COALESCE(v_root.qty_requested, 0) > 0
      THEN COALESCE(v_root.qty_po, 0)::NUMERIC / v_root.qty_requested::NUMERIC
    ELSE 0
  END;
  v_segment_po := FLOOR(p_segment_qty * v_po_ratio)::INT;

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
    scan_result
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
    v_root.price_quoted,
    v_root.price_system,
    'picked',
    v_root.stock_location_code,
    COALESCE(v_root.is_foc, false),
    p_root_order_item_id,
    p_confirmed_mrp,
    p_scan_result
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
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.split_order_item_at_pick(
  BIGINT, BIGINT, BIGINT, BIGINT, INTEGER, NUMERIC, JSONB, BOOLEAN
) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.merge_pick_mrp_segment(
  p_order_id BIGINT,
  p_claim_id BIGINT,
  p_user_id BIGINT,
  p_root_order_item_id BIGINT,
  p_segment_order_item_id BIGINT,
  p_restore_qty INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root public.order_items%ROWTYPE;
  v_segment public.order_items%ROWTYPE;
BEGIN
  IF p_claim_id IS NOT NULL THEN
    PERFORM 1
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
  INTO v_root
  FROM public.order_items
  WHERE id = p_root_order_item_id
    AND order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'root_not_found');
  END IF;

  SELECT *
  INTO v_segment
  FROM public.order_items
  WHERE id = p_segment_order_item_id
    AND order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'segment_not_found');
  END IF;

  IF p_segment_order_item_id = p_root_order_item_id THEN
    UPDATE public.order_items
    SET
      qty_requested = COALESCE(p_restore_qty, v_root.qty_requested),
      qty_shippable = COALESCE(p_restore_qty, v_root.qty_shippable),
      qty_approved = COALESCE(p_restore_qty, v_root.qty_approved),
      state = 'pending',
      scan_result = NULL,
      confirmed_mrp = NULL
    WHERE id = p_root_order_item_id;

    UPDATE public.stock_reservations
    SET qty_reserved = COALESCE(p_restore_qty, v_root.qty_requested)
    WHERE order_item_id = p_root_order_item_id
      AND status IN ('active', 'awaiting_erp_sync');

    RETURN jsonb_build_object('success', true, 'merged_to_root', true);
  END IF;

  IF v_segment.split_from_id IS DISTINCT FROM p_root_order_item_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_split_sibling');
  END IF;

  UPDATE public.order_items
  SET
    qty_requested = v_root.qty_requested + v_segment.qty_requested,
    qty_shippable = v_root.qty_shippable + v_segment.qty_shippable,
    qty_approved = COALESCE(v_root.qty_approved, 0) + COALESCE(v_segment.qty_approved, 0),
    qty_po = COALESCE(v_root.qty_po, 0) + COALESCE(v_segment.qty_po, 0),
    state = 'pending',
    scan_result = NULL,
    confirmed_mrp = NULL
  WHERE id = p_root_order_item_id;

  UPDATE public.stock_reservations
  SET qty_reserved = v_root.qty_requested + v_segment.qty_requested
  WHERE order_item_id = p_root_order_item_id
    AND status IN ('active', 'awaiting_erp_sync');

  UPDATE public.stock_reservations
  SET status = 'cancelled', cancelled_at = now()
  WHERE order_item_id = p_segment_order_item_id
    AND status IN ('active', 'awaiting_erp_sync');

  DELETE FROM public.order_items WHERE id = p_segment_order_item_id;

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

  RETURN jsonb_build_object('success', true, 'merged_to_root', false);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_pick_mrp_segment(
  BIGINT, BIGINT, BIGINT, BIGINT, BIGINT, INTEGER
) TO anon, authenticated;
