-- Atomic add-line during billing live queue: mirrors submit_sales_order per-line allocation + reservations.

CREATE OR REPLACE FUNCTION public.add_billing_line(
  p_order_id BIGINT,
  p_item_id BIGINT,
  p_qty INTEGER,
  p_price_quoted NUMERIC,
  p_claim_id BIGINT,
  p_user_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim RECORD;
  v_order RECORD;
  v_user_name TEXT;
  v_stock_location_code TEXT;
  v_item public.items%ROWTYPE;
  v_busy_code NUMERIC;
  v_physical_qty NUMERIC;
  v_reserved_qty NUMERIC;
  v_available_qty INTEGER;
  v_ship INTEGER;
  v_po INTEGER;
  v_price_system NUMERIC;
  v_order_item_id BIGINT;
BEGIN
  IF p_qty IS NULL OR p_qty < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_qty');
  END IF;

  SELECT id, order_id, stage, claimed_by_user_id
  INTO v_claim
  FROM public.work_claims
  WHERE id = p_claim_id
    AND order_id = p_order_id
    AND stage = 'billing'
    AND claimed_by_user_id = p_user_id
    AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'claim_lost');
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  IF v_order.workflow_status IS DISTINCT FROM 'submitted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_submitted');
  END IF;

  SELECT full_name INTO v_user_name FROM public.users WHERE id = p_user_id;
  IF v_user_name IS NULL THEN
    v_user_name := 'Billing';
  END IF;

  v_stock_location_code := COALESCE(v_order.stock_location_code, 'main_store');

  SELECT * INTO v_item FROM public.items WHERE id = p_item_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'unknown_item');
  END IF;

  v_busy_code := v_item.busy_code;
  v_available_qty := 0;

  IF v_busy_code IS NOT NULL THEN
    PERFORM 1
    FROM public.stock_locationwise sl
    WHERE sl.busy_code::NUMERIC IS NOT DISTINCT FROM v_busy_code
      AND public.normalize_stock_location_code(sl.stock_location) = v_stock_location_code
    FOR UPDATE;

    PERFORM 1
    FROM public.stock_reservations sr
    WHERE sr.busy_code IS NOT DISTINCT FROM v_busy_code
      AND sr.stock_location_code = v_stock_location_code
      AND sr.status IN ('active', 'awaiting_erp_sync')
    FOR UPDATE;

    SELECT COALESCE(SUM(sl.stock_qty), 0)
    INTO v_physical_qty
    FROM public.stock_locationwise sl
    WHERE sl.busy_code::NUMERIC IS NOT DISTINCT FROM v_busy_code
      AND public.normalize_stock_location_code(sl.stock_location) = v_stock_location_code;

    SELECT COALESCE(SUM(sr.qty_reserved), 0)
    INTO v_reserved_qty
    FROM public.stock_reservations sr
    WHERE sr.busy_code IS NOT DISTINCT FROM v_busy_code
      AND sr.stock_location_code = v_stock_location_code
      AND sr.status IN ('active', 'awaiting_erp_sync');

    v_available_qty := FLOOR(GREATEST(COALESCE(v_physical_qty, 0) - COALESCE(v_reserved_qty, 0), 0))::INT;
  END IF;

  v_ship := LEAST(p_qty, v_available_qty);
  v_po := p_qty - v_ship;

  v_price_system := COALESCE(v_item.sales_price, 0)::NUMERIC;
  IF p_price_quoted IS NULL OR p_price_quoted < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_price');
  END IF;

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
    stock_location_code
  )
  VALUES (
    p_order_id,
    p_item_id,
    v_item.name,
    NULLIF(v_item.alias, ''),
    NULLIF(v_item.rack_no, ''),
    p_qty,
    v_ship,
    v_po,
    v_ship,
    p_price_quoted,
    v_price_system,
    'pending',
    v_stock_location_code
  )
  RETURNING id INTO v_order_item_id;

  IF v_ship > 0 AND v_busy_code IS NOT NULL THEN
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
    VALUES (
      p_order_id,
      v_order_item_id,
      p_item_id,
      v_busy_code,
      v_stock_location_code,
      v_ship,
      'active',
      'billing_add_line',
      p_user_id,
      v_user_name
    );
  END IF;

  IF v_po > 0 THEN
    INSERT INTO public.pending_items (
      order_id,
      order_number,
      customer_id,
      customer_name,
      item_id,
      item_name,
      qty_pending,
      source,
      created_by,
      note,
      stock_location_code
    )
    VALUES (
      p_order_id,
      v_order.order_number,
      v_order.customer_id,
      v_order.customer_name,
      p_item_id,
      v_item.name,
      v_po,
      'billing',
      v_user_name,
      'Purchase order qty from billing add line',
      v_stock_location_code
    );
  END IF;

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

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
  VALUES (
    p_order_id,
    'billing_line_added',
    p_user_id,
    'billing',
    jsonb_build_object(
      'order_item_id', v_order_item_id,
      'item_id', p_item_id,
      'qty_requested', p_qty,
      'qty_shippable', v_ship,
      'qty_po', v_po,
      'price_quoted', p_price_quoted,
      'reviewer', v_user_name
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_item_id', v_order_item_id,
    'qty_shippable', v_ship,
    'qty_po', v_po
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'submit_failed',
      'detail', SQLERRM
    );
END;
$$;

COMMENT ON FUNCTION public.add_billing_line(BIGINT, BIGINT, INTEGER, NUMERIC, BIGINT, BIGINT) IS
  'Billing live queue: add one order line with location-wise allocation + reservation + optional PO pending row. Requires active billing claim.';

GRANT EXECUTE ON FUNCTION public.add_billing_line(BIGINT, BIGINT, INTEGER, NUMERIC, BIGINT, BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION public.add_billing_line(BIGINT, BIGINT, INTEGER, NUMERIC, BIGINT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_billing_line(BIGINT, BIGINT, INTEGER, NUMERIC, BIGINT, BIGINT) TO service_role;
