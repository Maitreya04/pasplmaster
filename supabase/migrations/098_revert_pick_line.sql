-- Picker undo: reset qty and/or MRP on a pick line (including MRP-split siblings).

CREATE OR REPLACE FUNCTION public.revert_pick_line(
  p_order_id BIGINT,
  p_claim_id BIGINT,
  p_user_id BIGINT,
  p_order_item_id BIGINT,
  p_mode TEXT DEFAULT 'full',
  p_restore_qty INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item public.order_items%ROWTYPE;
  v_root_id BIGINT;
  v_root public.order_items%ROWTYPE;
  v_sibling RECORD;
  v_merged_qty INTEGER;
  v_merged_po INTEGER;
  v_restore_qty INTEGER;
  v_restore_po INTEGER;
  v_po_ratio NUMERIC;
BEGIN
  IF p_order_item_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_line');
  END IF;

  IF p_mode NOT IN ('full', 'qty_only') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_mode');
  END IF;

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
  INTO v_item
  FROM public.order_items
  WHERE id = p_order_item_id
    AND order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'line_not_found');
  END IF;

  v_root_id := COALESCE(v_item.split_from_id, v_item.id);

  SELECT *
  INTO v_root
  FROM public.order_items
  WHERE id = v_root_id
    AND order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'root_not_found');
  END IF;

  IF p_mode = 'qty_only' THEN
    IF v_item.id IS DISTINCT FROM v_root_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'qty_only_on_root');
    END IF;

    v_restore_qty := COALESCE(p_restore_qty, v_root.qty_requested);

    UPDATE public.order_items
    SET
      state = 'pending',
      scan_result = NULL
    WHERE id = v_root_id;

    UPDATE public.stock_reservations
    SET qty_reserved = v_restore_qty
    WHERE order_item_id = v_root_id
      AND status IN ('active', 'awaiting_erp_sync');

    INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
    VALUES (
      p_order_id,
      'pick_line_reverted',
      p_user_id,
      'picking',
      jsonb_build_object(
        'order_item_id', v_root_id,
        'mode', 'qty_only',
        'restore_qty', v_restore_qty
      )
    );

    RETURN jsonb_build_object('success', true, 'order_item_id', v_root_id, 'mode', 'qty_only');
  END IF;

  SELECT
    COALESCE(SUM(qty_requested), 0)::INT,
    COALESCE(SUM(qty_po), 0)::INT
  INTO v_merged_qty, v_merged_po
  FROM public.order_items
  WHERE order_id = p_order_id
    AND (id = v_root_id OR split_from_id = v_root_id);

  IF p_restore_qty IS NOT NULL AND p_restore_qty > 0 THEN
    v_restore_qty := p_restore_qty;
    IF v_merged_qty > 0 THEN
      v_po_ratio := v_merged_po::NUMERIC / v_merged_qty::NUMERIC;
      v_restore_po := FLOOR(v_restore_qty * v_po_ratio)::INT;
    ELSE
      v_restore_po := COALESCE(v_root.qty_po, 0);
    END IF;
  ELSE
    v_restore_qty := v_merged_qty;
    v_restore_po := v_merged_po;
  END IF;

  FOR v_sibling IN
    SELECT id
    FROM public.order_items
    WHERE order_id = p_order_id
      AND split_from_id = v_root_id
  LOOP
    UPDATE public.stock_reservations
    SET status = 'cancelled', cancelled_at = now()
    WHERE order_item_id = v_sibling.id
      AND status IN ('active', 'awaiting_erp_sync');

    DELETE FROM public.order_items
    WHERE id = v_sibling.id;
  END LOOP;

  UPDATE public.order_items
  SET
    qty_requested = v_restore_qty,
    qty_shippable = v_restore_qty,
    qty_approved = v_restore_qty,
    qty_po = v_restore_po,
    state = 'pending',
    scan_result = NULL,
    confirmed_mrp = NULL
  WHERE id = v_root_id;

  UPDATE public.stock_reservations
  SET qty_reserved = v_restore_qty
  WHERE order_item_id = v_root_id
    AND status IN ('active', 'awaiting_erp_sync');

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
  VALUES (
    p_order_id,
    'pick_line_reverted',
    p_user_id,
    'picking',
    jsonb_build_object(
      'order_item_id', v_root_id,
      'mode', 'full',
      'restore_qty', v_restore_qty,
      'merged_qty_before', v_merged_qty
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
    'order_item_id', v_root_id,
    'mode', 'full',
    'restore_qty', v_restore_qty
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_pick_line(
  BIGINT, BIGINT, BIGINT, BIGINT, TEXT, INTEGER
) TO anon, authenticated;
