-- Phase 2: promote picker label MRP to billing_verified when billing accepts label price.
-- Still app-owned overlay — never touches stock_mrpwise / Busy sync.

CREATE OR REPLACE FUNCTION public.promote_billing_verified_label_mrp(
  p_order_item_id BIGINT,
  p_accepted_mrp NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.order_items%ROWTYPE;
  v_busy_code BIGINT;
  v_norm_loc TEXT;
  v_label_mrp NUMERIC;
  v_confirmed_by TEXT;
BEGIN
  IF p_order_item_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_line');
  END IF;

  SELECT oi.*
  INTO v_row
  FROM public.order_items oi
  WHERE oi.id = p_order_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF COALESCE(v_row.is_foc, false) THEN
    RETURN jsonb_build_object('success', true, 'action', 'skipped_foc');
  END IF;

  v_label_mrp := NULLIF(p_accepted_mrp, NULL);
  IF v_label_mrp IS NULL THEN
    v_label_mrp := v_row.confirmed_mrp;
  END IF;
  IF v_label_mrp IS NULL AND v_row.scan_result IS NOT NULL THEN
    BEGIN
      v_label_mrp := NULLIF((v_row.scan_result ->> 'confirmedMrp')::NUMERIC, NULL);
    EXCEPTION
      WHEN OTHERS THEN
        v_label_mrp := NULL;
    END;
  END IF;
  IF v_label_mrp IS NULL THEN
    v_label_mrp := v_row.flag_box_price;
  END IF;

  IF v_label_mrp IS NULL OR v_label_mrp < 0 THEN
    RETURN jsonb_build_object('success', true, 'action', 'no_label_mrp');
  END IF;

  SELECT i.busy_code::BIGINT
  INTO v_busy_code
  FROM public.items i
  WHERE i.id = v_row.item_id
    AND i.busy_code IS NOT NULL
    AND i.busy_code > 0;

  IF v_busy_code IS NULL THEN
    RETURN jsonb_build_object('success', true, 'action', 'no_busy_code');
  END IF;

  v_norm_loc := public.normalize_stock_location_code(v_row.stock_location_code);
  IF v_norm_loc IS NULL THEN
    SELECT public.normalize_stock_location_code(o.stock_location_code)
    INTO v_norm_loc
    FROM public.orders o
    WHERE o.id = v_row.order_id;
  END IF;
  v_norm_loc := COALESCE(v_norm_loc, 'main_store');

  v_confirmed_by := NULLIF(trim(COALESCE(v_row.scan_result #>> '{operatorContext,pickerName}', '')), '');

  INSERT INTO public.picker_label_mrp (
    busy_code,
    stock_location_code,
    label_mrp,
    trust_level,
    confirmation_count,
    last_confirmed_at,
    last_confirmed_by,
    last_order_item_id
  )
  VALUES (
    v_busy_code,
    v_norm_loc,
    ROUND(v_label_mrp),
    'billing_verified',
    1,
    now(),
    v_confirmed_by,
    p_order_item_id
  )
  ON CONFLICT ON CONSTRAINT picker_label_mrp_busy_loc_mrp_unique
  DO UPDATE SET
    trust_level = 'billing_verified',
    confirmation_count = GREATEST(public.picker_label_mrp.confirmation_count, 1),
    last_confirmed_at = now(),
    last_confirmed_by = COALESCE(v_confirmed_by, public.picker_label_mrp.last_confirmed_by),
    last_order_item_id = p_order_item_id;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'promoted',
    'busy_code', v_busy_code,
    'stock_location_code', v_norm_loc,
    'label_mrp', ROUND(v_label_mrp)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_billing_verified_label_mrp(BIGINT, NUMERIC) TO anon, authenticated;

COMMENT ON FUNCTION public.promote_billing_verified_label_mrp(BIGINT, NUMERIC) IS
  'Promote accepted label MRP to billing_verified in app overlay (never touches ERP / stock_mrpwise).';
