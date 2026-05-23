-- Fix PL/pgSQL "record v_pref is not assigned yet" when no preferred layer is passed.
-- Compound IF conditions still resolve RECORD field references even when guarded by NULL checks.

CREATE OR REPLACE FUNCTION public.wms_consume_bin_layer_for_pick(
  p_order_item_id BIGINT,
  p_qty_ea INTEGER,
  p_user_id BIGINT DEFAULT NULL,
  p_preferred_layer_id BIGINT DEFAULT NULL,
  p_override_reason TEXT DEFAULT NULL,
  p_bin_id TEXT DEFAULT NULL,
  p_order_item_pick_scan_id BIGINT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_oi RECORD;
  v_bin TEXT;
  v_busy NUMERIC;
  v_need INTEGER := p_qty_ea;
  v_head RECORD;
  v_pref RECORD;
  v_has_head BOOLEAN := false;
  v_take INTEGER;
  v_skipped BOOLEAN := false;
  v_events JSONB := '[]'::JSONB;
BEGIN
  IF p_qty_ea IS NULL OR p_qty_ea <= 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'qty_invalid');
  END IF;

  SELECT
    oi.id,
    oi.item_id,
    i.busy_code::NUMERIC AS busy_num,
    oi.rack_no
  INTO v_oi
  FROM public.order_items oi
  JOIN public.items i ON i.id = oi.item_id
  WHERE oi.id = p_order_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'order_item_not_found');
  END IF;

  v_busy := v_oi.busy_num;
  v_bin := public.wms_normalize_bin_id(coalesce(p_bin_id, v_oi.rack_no));

  IF v_bin = '' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'bin_required');
  END IF;

  SELECT * INTO v_head
  FROM public.bin_inventory_layers
  WHERE bin_id = v_bin AND sku_busy_code = v_busy AND qty_ea > 0
  ORDER BY fifo_received_at ASC, id ASC
  LIMIT 1;
  v_has_head := FOUND;

  IF p_preferred_layer_id IS NOT NULL THEN
    SELECT * INTO v_pref
    FROM public.bin_inventory_layers
    WHERE id = p_preferred_layer_id
      AND bin_id = v_bin
      AND sku_busy_code = v_busy
      AND qty_ea > 0;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'reason', 'preferred_layer_not_found');
    END IF;

    IF v_has_head AND v_head.id IS DISTINCT FROM v_pref.id THEN
      IF p_override_reason IS NULL OR length(trim(p_override_reason)) < 3 THEN
        RETURN jsonb_build_object(
          'success', false,
          'reason', 'override_reason_required',
          'fifo_head_layer_id', v_head.id
        );
      END IF;
      v_skipped := true;
    END IF;

    v_take := LEAST(v_need, v_pref.qty_ea);
    IF v_take > 0 THEN
      UPDATE public.bin_inventory_layers
      SET qty_ea = qty_ea - v_take
      WHERE id = v_pref.id;

      INSERT INTO public.bin_layer_pick_events (
        order_item_id,
        order_item_pick_scan_id,
        bin_inventory_layer_id,
        qty_ea,
        mrp_per_ea,
        fifo_skipped,
        override_reason,
        picker_user_id
      ) VALUES (
        p_order_item_id,
        p_order_item_pick_scan_id,
        v_pref.id,
        v_take,
        v_pref.mrp_per_ea,
        v_skipped,
        CASE WHEN v_skipped THEN trim(p_override_reason) ELSE NULL END,
        p_user_id
      );

      v_events := v_events || jsonb_build_object(
        'layer_id', v_pref.id,
        'qty_ea', v_take,
        'fifo_skipped', v_skipped
      );
      v_need := v_need - v_take;
    END IF;
  END IF;

  WHILE v_need > 0 LOOP
    SELECT * INTO v_head
    FROM public.bin_inventory_layers
    WHERE bin_id = v_bin AND sku_busy_code = v_busy AND qty_ea > 0
    ORDER BY fifo_received_at ASC, id ASC
    LIMIT 1;

    EXIT WHEN NOT FOUND;

    v_take := LEAST(v_need, v_head.qty_ea);
    UPDATE public.bin_inventory_layers
    SET qty_ea = qty_ea - v_take
    WHERE id = v_head.id;

    INSERT INTO public.bin_layer_pick_events (
      order_item_id,
      order_item_pick_scan_id,
      bin_inventory_layer_id,
      qty_ea,
      mrp_per_ea,
      fifo_skipped,
      override_reason,
      picker_user_id
    ) VALUES (
      p_order_item_id,
      p_order_item_pick_scan_id,
      v_head.id,
      v_take,
      v_head.mrp_per_ea,
      false,
      NULL,
      p_user_id
    );

    v_events := v_events || jsonb_build_object(
      'layer_id', v_head.id,
      'qty_ea', v_take,
      'fifo_skipped', false
    );
    v_need := v_need - v_take;
  END LOOP;

  IF v_need > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'insufficient_layer_stock',
      'short_by', v_need,
      'events', v_events
    );
  END IF;

  DELETE FROM public.bin_inventory_layers
  WHERE bin_id = v_bin AND sku_busy_code = v_busy AND qty_ea <= 0;

  PERFORM public.wms_recompute_bin_inventory_rollup(v_bin, v_busy);

  RETURN jsonb_build_object('success', true, 'events', v_events, 'bin_id', v_bin);
END;
$$;

GRANT EXECUTE ON FUNCTION public.wms_consume_bin_layer_for_pick(BIGINT, INTEGER, BIGINT, BIGINT, TEXT, TEXT, BIGINT) TO anon, authenticated;
