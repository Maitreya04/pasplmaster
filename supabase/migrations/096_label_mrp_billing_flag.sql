-- Auto-flag billing when picker-confirmed label MRP differs from sales/billing rate.

CREATE OR REPLACE FUNCTION public.sync_order_item_label_mrp_flag(p_order_item_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.order_items%ROWTYPE;
  v_label_mrp NUMERIC;
  v_billing_rate NUMERIC;
  v_notes TEXT;
  v_existing_notes TEXT;
BEGIN
  SELECT *
  INTO v_row
  FROM public.order_items
  WHERE id = p_order_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF COALESCE(v_row.is_foc, false) THEN
    RETURN jsonb_build_object('success', true, 'action', 'skipped_foc');
  END IF;

  v_label_mrp := v_row.confirmed_mrp;
  IF v_label_mrp IS NULL AND v_row.scan_result IS NOT NULL THEN
    BEGIN
      v_label_mrp := NULLIF((v_row.scan_result ->> 'confirmedMrp')::NUMERIC, NULL);
    EXCEPTION
      WHEN OTHERS THEN
        v_label_mrp := NULL;
    END;
  END IF;

  IF v_label_mrp IS NULL OR v_label_mrp < 0 THEN
    IF v_row.state = 'flagged'
      AND v_row.flag_reason = 'Price Mismatch'
      AND COALESCE(v_row.flag_notes, '') LIKE 'Label MRP at pick%'
    THEN
      UPDATE public.order_items
      SET
        state = 'picked',
        flag_reason = NULL,
        flag_notes = NULL,
        flag_box_price = NULL
      WHERE id = p_order_item_id;
      RETURN jsonb_build_object('success', true, 'action', 'cleared_auto');
    END IF;
    RETURN jsonb_build_object('success', true, 'action', 'no_label');
  END IF;

  v_billing_rate := ROUND(COALESCE(v_row.price_quoted, v_row.price_system, 0));

  IF ROUND(v_label_mrp) = v_billing_rate THEN
    IF v_row.state = 'flagged'
      AND v_row.flag_reason = 'Price Mismatch'
      AND COALESCE(v_row.flag_notes, '') LIKE 'Label MRP at pick%'
    THEN
      UPDATE public.order_items
      SET
        state = 'picked',
        flag_reason = NULL,
        flag_notes = NULL,
        flag_box_price = NULL
      WHERE id = p_order_item_id;
      RETURN jsonb_build_object('success', true, 'action', 'cleared_matched');
    END IF;
    RETURN jsonb_build_object('success', true, 'action', 'matched');
  END IF;

  v_existing_notes := COALESCE(v_row.flag_notes, '');

  IF v_row.flag_reason = 'Price Mismatch'
    AND v_existing_notes LIKE '%Price mismatch detected at picking%'
    AND v_existing_notes NOT LIKE 'Label MRP at pick%'
  THEN
    RETURN jsonb_build_object('success', true, 'action', 'skipped_manual_price');
  END IF;

  IF v_row.flag_reason IS NOT NULL
    AND v_row.flag_reason NOT IN ('Price Mismatch', 'Out of Stock', 'Out of Stock (Billing)')
  THEN
    UPDATE public.order_items
    SET confirmed_mrp = v_label_mrp
    WHERE id = p_order_item_id;
    RETURN jsonb_build_object('success', true, 'action', 'label_persisted_only');
  END IF;

  v_notes := format(
    'Label MRP at pick (₹%s vs billing ₹%s)',
    ROUND(v_label_mrp)::TEXT,
    v_billing_rate::TEXT
  );

  IF v_row.flag_reason IN ('Out of Stock', 'Out of Stock (Billing)') THEN
    UPDATE public.order_items
    SET
      confirmed_mrp = v_label_mrp,
      flag_box_price = ROUND(v_label_mrp),
      flag_notes = CASE
        WHEN v_existing_notes LIKE '%Label MRP at pick%' THEN v_existing_notes
        WHEN v_existing_notes = '' THEN v_notes
        ELSE v_existing_notes || ' · ' || v_notes
      END
    WHERE id = p_order_item_id;
    RETURN jsonb_build_object('success', true, 'action', 'oos_price_hint');
  END IF;

  UPDATE public.order_items
  SET
    confirmed_mrp = ROUND(v_label_mrp),
    state = CASE
      WHEN v_row.state = 'picked' THEN 'flagged'
      ELSE v_row.state
    END,
    flag_reason = 'Price Mismatch',
    flag_box_price = ROUND(v_label_mrp),
    flag_notes = v_notes
  WHERE id = p_order_item_id
    AND v_row.state IN ('picked', 'flagged', 'pending');

  RETURN jsonb_build_object('success', true, 'action', 'price_mismatch_flagged');
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_order_item_label_mrp_flag(BIGINT) TO anon, authenticated;

COMMENT ON FUNCTION public.sync_order_item_label_mrp_flag(BIGINT) IS
  'When picker label MRP differs from price_quoted/system, flag line for billing (Price Mismatch) or attach hint on OOS lines.';
