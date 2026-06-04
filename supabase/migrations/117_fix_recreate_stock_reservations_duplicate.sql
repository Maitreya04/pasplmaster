-- Fix: "function recreate_stock_reservations_for_order(bigint, bigint, text) is not unique"
-- Drop every overload, then install a single canonical definition.

DO $drop$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_catalog.pg_proc p
    INNER JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'recreate_stock_reservations_for_order'
  LOOP
    EXECUTE format(
      'DROP FUNCTION IF EXISTS public.recreate_stock_reservations_for_order(%s)',
      r.args
    );
  END LOOP;
END;
$drop$;

CREATE OR REPLACE FUNCTION public.recreate_stock_reservations_for_order(
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
  v_line RECORD;
  v_item public.items%ROWTYPE;
  v_stock_location_code TEXT;
  v_busy_code NUMERIC;
  v_available_qty INTEGER;
  v_ship INTEGER;
  v_po INTEGER;
  v_prev_ship INTEGER;
  v_batch_reserved_qty NUMERIC;
  v_plans JSONB := '[]'::jsonb;
  v_plan JSONB;
  v_warnings JSONB := '[]'::jsonb;
  v_total_value NUMERIC := 0;
  v_line_count INTEGER := 0;
  v_price NUMERIC;
BEGIN
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  PERFORM public.cancel_active_stock_reservations_for_order(p_order_id);

  FOR v_line IN
    SELECT oi.*
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    ORDER BY oi.id ASC
  LOOP
    v_stock_location_code := COALESCE(
      v_line.stock_location_code,
      v_order.stock_location_code,
      'main_store'
    );
    v_prev_ship := COALESCE(v_line.qty_shippable, 0);
    v_ship := 0;
    v_po := v_line.qty_requested;
    v_busy_code := NULL;

    SELECT * INTO v_item
    FROM public.items
    WHERE id = v_line.item_id
    FOR UPDATE;

    IF FOUND THEN
      v_busy_code := v_item.busy_code;
    END IF;

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

      SELECT COALESCE(SUM((elem->>'qty_shippable')::INTEGER), 0)
      INTO v_batch_reserved_qty
      FROM jsonb_array_elements(v_plans) AS e(elem)
      WHERE NULLIF(elem->>'busy_code', '')::NUMERIC IS NOT DISTINCT FROM v_busy_code
        AND elem->>'stock_location_code' = v_stock_location_code;

      v_available_qty := public.guarded_locationwise_available_qty(
        v_busy_code,
        v_stock_location_code,
        v_batch_reserved_qty
      );

      v_ship := LEAST(v_line.qty_requested, v_available_qty);
      v_po := v_line.qty_requested - v_ship;
    ELSIF v_prev_ship > 0 THEN
      v_ship := LEAST(v_line.qty_requested, v_prev_ship);
      v_po := v_line.qty_requested - v_ship;
    END IF;

    IF v_prev_ship > 0 AND v_ship = 0 THEN
      v_warnings := v_warnings || jsonb_build_array(
        jsonb_build_object(
          'order_item_id', v_line.id,
          'item_name', v_line.item_name,
          'prev_qty_shippable', v_prev_ship,
          'new_qty_shippable', 0,
          'reason', 'insufficient_stock'
        )
      );
    ELSIF v_prev_ship > 0 AND v_ship > 0 AND v_ship < v_prev_ship THEN
      v_warnings := v_warnings || jsonb_build_array(
        jsonb_build_object(
          'order_item_id', v_line.id,
          'item_name', v_line.item_name,
          'prev_qty_shippable', v_prev_ship,
          'new_qty_shippable', v_ship
        )
      );
    END IF;

    v_plans := v_plans || jsonb_build_array(
      jsonb_build_object(
        'order_item_id', v_line.id,
        'item_id', v_line.item_id,
        'item_name', v_line.item_name,
        'busy_code', v_busy_code,
        'stock_location_code', v_stock_location_code,
        'qty_shippable', v_ship,
        'qty_po', v_po,
        'price_quoted', v_line.price_quoted,
        'price_system', v_line.price_system,
        'is_foc', COALESCE(v_line.is_foc, false)
      )
    );
  END LOOP;

  FOR v_plan IN
    SELECT elem
    FROM jsonb_array_elements(v_plans) AS e(elem)
  LOOP
    UPDATE public.order_items oi
    SET
      qty_shippable = (v_plan->>'qty_shippable')::INTEGER,
      qty_po = (v_plan->>'qty_po')::INTEGER,
      qty_approved = (v_plan->>'qty_shippable')::INTEGER,
      stock_location_code = v_plan->>'stock_location_code'
    WHERE oi.id = (v_plan->>'order_item_id')::BIGINT;

    IF (v_plan->>'qty_shippable')::INTEGER > 0
       AND NULLIF(v_plan->>'busy_code', '') IS NOT NULL THEN
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
        (v_plan->>'order_item_id')::BIGINT,
        (v_plan->>'item_id')::BIGINT,
        (v_plan->>'busy_code')::NUMERIC,
        v_plan->>'stock_location_code',
        (v_plan->>'qty_shippable')::INTEGER,
        'active',
        'order_revive',
        p_actor_user_id,
        COALESCE(NULLIF(TRIM(p_actor_name), ''), 'Billing')
      );
    END IF;

    v_line_count := v_line_count + 1;

    IF COALESCE((v_plan->>'is_foc')::BOOLEAN, false) THEN
      v_price := 0;
    ELSE
      v_price := COALESCE(
        NULLIF((v_plan->>'price_quoted')::NUMERIC, NULL),
        NULLIF((v_plan->>'price_system')::NUMERIC, NULL),
        0
      );
    END IF;

    v_total_value := v_total_value + (v_price * (v_plan->>'qty_shippable')::INTEGER);
  END LOOP;

  UPDATE public.orders
  SET
    item_count = v_line_count,
    total_value = v_total_value
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'warnings', v_warnings
  );
END;
$$;

COMMENT ON FUNCTION public.recreate_stock_reservations_for_order(BIGINT, BIGINT, TEXT) IS
  'Account-hold revive: re-split ship/PO from Busy stock; stock shortfalls become warnings, not hard failures.';

GRANT EXECUTE ON FUNCTION public.recreate_stock_reservations_for_order(BIGINT, BIGINT, TEXT) TO service_role;

-- Disambiguate internal call if any integer overloads remain elsewhere.
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

GRANT EXECUTE ON FUNCTION public.revive_billing_order(BIGINT, BIGINT, TEXT) TO anon, authenticated, service_role;
