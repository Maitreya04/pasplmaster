-- Restore sales_edit in claim_order (regression from 089) and allow sales line edits until
-- a picker is assigned (submitted, or approved with no picker_name).

CREATE OR REPLACE FUNCTION public.sales_line_edit_denial_reason(
  p_workflow_status TEXT,
  p_picker_name TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_workflow_status = 'submitted' THEN
    RETURN NULL;
  END IF;

  IF p_workflow_status = 'approved'
     AND (p_picker_name IS NULL OR btrim(p_picker_name) = '') THEN
    RETURN NULL;
  END IF;

  IF p_picker_name IS NOT NULL AND btrim(p_picker_name) <> '' THEN
    RETURN 'picker_assigned';
  END IF;

  IF p_workflow_status = 'picking' THEN
    RETURN 'picker_assigned';
  END IF;

  RETURN 'not_editable';
END;
$$;

COMMENT ON FUNCTION public.sales_line_edit_denial_reason(TEXT, TEXT) IS
  'NULL when sales may edit lines; otherwise picker_assigned or not_editable.';

CREATE OR REPLACE FUNCTION public.claim_order(
  p_order_id BIGINT,
  p_stage TEXT,
  p_user_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_existing RECORD;
  v_cross RECORD;
  v_claim_id BIGINT;
  v_user_name TEXT;
  v_claimer_name TEXT;
  v_denial TEXT;
  v_stale_threshold INTERVAL := INTERVAL '3 minutes';
BEGIN
  IF p_stage NOT IN ('billing', 'picking', 'sales_edit') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Invalid stage');
  END IF;

  SELECT id, workflow_status, salesperson_user_id, picker_name
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Order not found');
  END IF;

  IF p_stage = 'sales_edit' THEN
    SELECT full_name INTO v_user_name
    FROM public.users
    WHERE id = p_user_id AND is_active = true AND role = 'sales';

    IF v_user_name IS NULL THEN
      RETURN jsonb_build_object('success', false, 'reason', 'User not found or inactive');
    END IF;

    IF v_order.salesperson_user_id IS DISTINCT FROM p_user_id THEN
      RETURN jsonb_build_object('success', false, 'reason', 'not_owner');
    END IF;

    v_denial := public.sales_line_edit_denial_reason(v_order.workflow_status, v_order.picker_name);
    IF v_denial IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'reason', v_denial);
    END IF;

    SELECT wc.id, wc.claimed_by_user_id, wc.claimed_at, wc.last_heartbeat_at, wc.status,
           u.full_name AS claimer_name
    INTO v_cross
    FROM public.work_claims wc
    JOIN public.users u ON u.id = wc.claimed_by_user_id
    WHERE wc.order_id = p_order_id
      AND wc.stage = 'picking'
      AND wc.status = 'active'
      AND (now() - wc.last_heartbeat_at) <= v_stale_threshold;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'picker_assigned',
        'locked_by_name', v_cross.claimer_name,
        'claimed_at', v_cross.claimed_at,
        'last_heartbeat_at', v_cross.last_heartbeat_at
      );
    END IF;

    IF v_order.workflow_status = 'submitted' THEN
      SELECT wc.id, wc.claimed_by_user_id, wc.claimed_at, wc.last_heartbeat_at, wc.status,
             u.full_name AS claimer_name
      INTO v_cross
      FROM public.work_claims wc
      JOIN public.users u ON u.id = wc.claimed_by_user_id
      WHERE wc.order_id = p_order_id
        AND wc.stage = 'billing'
        AND wc.status = 'active';

      IF FOUND THEN
        IF (now() - v_cross.last_heartbeat_at) > v_stale_threshold THEN
          UPDATE public.work_claims
          SET status = 'expired', released_at = now()
          WHERE id = v_cross.id;

          INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
          VALUES (p_order_id, 'claim_expired', p_user_id, 'billing',
                  jsonb_build_object(
                    'expired_claim_id', v_cross.id,
                    'expired_user', v_cross.claimer_name,
                    'reason', 'heartbeat_timeout'
                  ));

          INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
          VALUES (p_order_id, 'claim_takeover', p_user_id, 'sales_edit',
                  jsonb_build_object(
                    'previous_owner', v_cross.claimer_name,
                    'new_owner', v_user_name,
                    'via', 'sales_edit_after_stale_billing'
                  ));
        ELSE
          RETURN jsonb_build_object(
            'success', false,
            'reason', 'locked_by_billing',
            'locked_by_name', v_cross.claimer_name,
            'claimed_at', v_cross.claimed_at,
            'last_heartbeat_at', v_cross.last_heartbeat_at
          );
        END IF;
      END IF;
    END IF;
  ELSE
    SELECT full_name INTO v_user_name FROM public.users WHERE id = p_user_id AND is_active = true;
    IF v_user_name IS NULL THEN
      RETURN jsonb_build_object('success', false, 'reason', 'User not found or inactive');
    END IF;

    IF p_stage = 'billing' THEN
      SELECT wc.id, wc.claimed_by_user_id, wc.claimed_at, wc.last_heartbeat_at, wc.status,
             u.full_name AS claimer_name
      INTO v_cross
      FROM public.work_claims wc
      JOIN public.users u ON u.id = wc.claimed_by_user_id
      WHERE wc.order_id = p_order_id
        AND wc.stage = 'sales_edit'
        AND wc.status = 'active';

      IF FOUND THEN
        IF (now() - v_cross.last_heartbeat_at) > v_stale_threshold THEN
          UPDATE public.work_claims
          SET status = 'expired', released_at = now()
          WHERE id = v_cross.id;

          INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
          VALUES (p_order_id, 'claim_expired', p_user_id, 'sales_edit',
                  jsonb_build_object(
                    'expired_claim_id', v_cross.id,
                    'expired_user', v_cross.claimer_name,
                    'reason', 'heartbeat_timeout'
                  ));

          INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
          VALUES (p_order_id, 'claim_takeover', p_user_id, 'billing',
                  jsonb_build_object(
                    'previous_owner', v_cross.claimer_name,
                    'new_owner', v_user_name,
                    'via', 'billing_after_stale_sales_edit'
                  ));
        ELSE
          RETURN jsonb_build_object(
            'success', false,
            'reason', 'locked_by_sales_edit',
            'locked_by_name', v_cross.claimer_name,
            'claimed_at', v_cross.claimed_at,
            'last_heartbeat_at', v_cross.last_heartbeat_at
          );
        END IF;
      END IF;
    END IF;
  END IF;

  SELECT wc.id, wc.claimed_by_user_id, wc.claimed_at, wc.last_heartbeat_at, wc.status,
         u.full_name AS claimer_name
  INTO v_existing
  FROM public.work_claims wc
  JOIN public.users u ON u.id = wc.claimed_by_user_id
  WHERE wc.order_id = p_order_id
    AND wc.stage = p_stage
    AND wc.status = 'active';

  IF FOUND THEN
    IF v_existing.claimed_by_user_id = p_user_id THEN
      RETURN jsonb_build_object(
        'success', true,
        'claim_id', v_existing.id,
        'claim_version', 1,
        'reclaimed', true
      );
    END IF;

    IF (now() - v_existing.last_heartbeat_at) > v_stale_threshold
       AND (p_stage <> 'picking' OR v_order.workflow_status = 'picking') THEN
      UPDATE public.work_claims
      SET status = 'expired',
          released_at = now()
      WHERE id = v_existing.id;

      INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
      VALUES (p_order_id, 'claim_expired', p_user_id, p_stage,
              jsonb_build_object(
                'expired_claim_id', v_existing.id,
                'expired_user', v_existing.claimer_name,
                'reason', 'heartbeat_timeout'
              ));

      INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
      VALUES (p_order_id, 'claim_takeover', p_user_id, p_stage,
              jsonb_build_object(
                'previous_owner', v_existing.claimer_name,
                'new_owner', v_user_name
              ));
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'already_claimed',
        'claimed_by', v_existing.claimer_name,
        'claimed_at', v_existing.claimed_at,
        'last_heartbeat_at', v_existing.last_heartbeat_at
      );
    END IF;
  END IF;

  INSERT INTO public.work_claims (order_id, stage, claimed_by_user_id)
  VALUES (p_order_id, p_stage, p_user_id)
  RETURNING id INTO v_claim_id;

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage)
  VALUES (
    p_order_id,
    CASE p_stage
      WHEN 'billing' THEN 'billing_claimed'
      WHEN 'picking' THEN 'picking_claimed'
      ELSE 'sales_edit_started'
    END,
    p_user_id,
    p_stage
  );

  IF p_stage = 'picking' THEN
    UPDATE public.orders
    SET picker_name = v_user_name
    WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'claim_id', v_claim_id,
    'claim_version', 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_claim(
  p_claim_id BIGINT,
  p_user_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim RECORD;
BEGIN
  SELECT wc.id, wc.order_id, wc.stage, wc.claimed_by_user_id
  INTO v_claim
  FROM public.work_claims wc
  WHERE wc.id = p_claim_id
    AND wc.claimed_by_user_id = p_user_id
    AND wc.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Claim not found or not active');
  END IF;

  UPDATE public.work_claims
  SET status = 'released',
      released_at = now()
  WHERE id = p_claim_id;

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage)
  VALUES (
    v_claim.order_id,
    CASE v_claim.stage
      WHEN 'billing' THEN 'billing_released'
      WHEN 'picking' THEN 'picking_released'
      ELSE 'sales_edit_released'
    END,
    p_user_id,
    v_claim.stage
  );

  IF v_claim.stage = 'picking' THEN
    UPDATE public.orders
    SET workflow_status = 'approved',
        picker_name = NULL
    WHERE id = v_claim.order_id
      AND workflow_status IN ('picking', 'approved');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Block picker assignment while sales holds a fresh edit lock.
CREATE OR REPLACE FUNCTION public.billing_assign_picker(
  p_order_id BIGINT,
  p_picker_user_id BIGINT,
  p_actor_user_id BIGINT,
  p_actor_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_picker_name TEXT;
  v_actor_name TEXT;
  v_claim_id BIGINT;
  v_existing_claim RECORD;
  v_sales_edit_lock RECORD;
  v_previous_picker TEXT := NULL;
  v_stale_threshold INTERVAL := INTERVAL '3 minutes';
BEGIN
  v_actor_name := COALESCE(NULLIF(TRIM(p_actor_name), ''), 'Billing');

  IF p_order_id IS NULL OR p_picker_user_id IS NULL OR p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_params');
  END IF;

  SELECT full_name INTO v_picker_name
  FROM public.users
  WHERE id = p_picker_user_id
    AND role = 'picking'
    AND is_active = true;

  IF v_picker_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'picker_not_found');
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'order_not_found');
  END IF;

  IF v_order.workflow_status IS DISTINCT FROM 'approved' THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'not_approved',
      'workflow_status', v_order.workflow_status
    );
  END IF;

  IF v_order.fulfillment_path = 'direct_bill' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'direct_bill');
  END IF;

  SELECT wc.id, u.full_name AS editor_name
  INTO v_sales_edit_lock
  FROM public.work_claims wc
  JOIN public.users u ON u.id = wc.claimed_by_user_id
  WHERE wc.order_id = p_order_id
    AND wc.stage = 'sales_edit'
    AND wc.status = 'active'
    AND (now() - wc.last_heartbeat_at) <= v_stale_threshold;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'locked_by_sales_edit',
      'locked_by_name', v_sales_edit_lock.editor_name
    );
  END IF;

  SELECT wc.id
  INTO v_claim_id
  FROM public.work_claims wc
  WHERE wc.order_id = p_order_id
    AND wc.stage = 'picking'
    AND wc.status = 'active'
    AND wc.claimed_by_user_id = p_picker_user_id;

  IF FOUND THEN
    UPDATE public.orders
    SET picker_name = v_picker_name
    WHERE id = p_order_id;

    RETURN jsonb_build_object(
      'success', true,
      'claim_id', v_claim_id,
      'picker_name', v_picker_name,
      'resumed', true
    );
  END IF;

  SELECT wc.id, wc.claimed_by_user_id, wc.last_heartbeat_at, u.full_name AS claimer_name
  INTO v_existing_claim
  FROM public.work_claims wc
  JOIN public.users u ON u.id = wc.claimed_by_user_id
  WHERE wc.order_id = p_order_id
    AND wc.stage = 'picking'
    AND wc.status = 'active';

  IF FOUND THEN
    v_previous_picker := v_existing_claim.claimer_name;

    IF v_order.workflow_status = 'approved' THEN
      UPDATE public.work_claims
      SET status = 'released',
          released_at = now()
      WHERE id = v_existing_claim.id;

      INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
      VALUES (
        p_order_id,
        'picking_released',
        p_actor_user_id,
        'picking',
        jsonb_build_object(
          'released_claim_id', v_existing_claim.id,
          'previous_picker', v_existing_claim.claimer_name,
          'new_picker', v_picker_name,
          'reason', 'billing_reassign',
          'via', 'billing_assign_picker'
        )
      );
    ELSIF (now() - v_existing_claim.last_heartbeat_at) > v_stale_threshold THEN
      UPDATE public.work_claims
      SET status = 'expired',
          released_at = now()
      WHERE id = v_existing_claim.id;

      INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
      VALUES (
        p_order_id,
        'claim_expired',
        p_actor_user_id,
        'picking',
        jsonb_build_object(
          'expired_claim_id', v_existing_claim.id,
          'expired_user', v_existing_claim.claimer_name,
          'reason', 'heartbeat_timeout',
          'via', 'billing_assign_picker'
        )
      );
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'picking_in_progress',
        'claimed_by', v_existing_claim.claimer_name
      );
    END IF;
  END IF;

  INSERT INTO public.work_claims (order_id, stage, claimed_by_user_id)
  VALUES (p_order_id, 'picking', p_picker_user_id)
  RETURNING id INTO v_claim_id;

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
  VALUES (
    p_order_id,
    'picking_claimed',
    p_picker_user_id,
    'picking',
    jsonb_build_object(
      'assigned_by', v_actor_name,
      'assigned_by_user_id', p_actor_user_id,
      'via', 'billing_desk',
      'reassigned_from', v_previous_picker
    )
  );

  UPDATE public.orders
  SET picker_name = v_picker_name
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'claim_id', v_claim_id,
    'picker_name', v_picker_name,
    'resumed', false
  );
END;
$$;

-- Shared eligibility gate for add/remove line RPCs.
CREATE OR REPLACE FUNCTION public.assert_sales_line_edit_allowed(
  p_workflow_status TEXT,
  p_picker_name TEXT,
  p_salesperson_user_id BIGINT,
  p_user_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_denial TEXT;
BEGIN
  IF p_salesperson_user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_owner');
  END IF;

  v_denial := public.sales_line_edit_denial_reason(p_workflow_status, p_picker_name);
  IF v_denial IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', v_denial);
  END IF;

  RETURN NULL;
END;
$$;

-- Patch add_sales_submitted_line: allow approved + no picker.
CREATE OR REPLACE FUNCTION public.add_sales_submitted_line(
  p_order_id BIGINT,
  p_item_id BIGINT,
  p_qty INTEGER,
  p_price_quoted NUMERIC,
  p_claim_id BIGINT,
  p_user_id BIGINT,
  p_is_foc BOOLEAN DEFAULT false
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
  v_insert_price NUMERIC;
  v_is_foc BOOLEAN := COALESCE(p_is_foc, false);
  v_order_item_id BIGINT;
  v_bill_line_no INTEGER;
  v_gate JSONB;
BEGIN
  IF p_qty IS NULL OR p_qty < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_qty');
  END IF;

  SELECT id, order_id, stage, claimed_by_user_id
  INTO v_claim
  FROM public.work_claims
  WHERE id = p_claim_id
    AND order_id = p_order_id
    AND stage = 'sales_edit'
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

  v_gate := public.assert_sales_line_edit_allowed(
    v_order.workflow_status,
    v_order.picker_name,
    v_order.salesperson_user_id,
    p_user_id
  );
  IF v_gate IS NOT NULL THEN
    RETURN v_gate;
  END IF;

  SELECT full_name INTO v_user_name
  FROM public.users
  WHERE id = p_user_id AND role = 'sales' AND is_active = true;
  IF v_user_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_salesperson');
  END IF;

  v_stock_location_code := COALESCE(v_order.stock_location_code, 'main_store');
  v_bill_line_no := public.next_order_bill_line_no(p_order_id);

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

  IF v_is_foc THEN
    v_insert_price := 0::NUMERIC;
  ELSIF p_price_quoted IS NULL OR p_price_quoted < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_price');
  ELSE
    v_insert_price := p_price_quoted;
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
    stock_location_code,
    is_foc,
    bill_line_no
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
    v_insert_price,
    v_price_system,
    'pending',
    v_stock_location_code,
    v_is_foc,
    v_bill_line_no
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
      'sales_edit_add_line',
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
      'sales',
      v_user_name,
      'Purchase order qty from sales edit',
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
    'sales_line_added',
    p_user_id,
    'sales_edit',
    jsonb_build_object(
      'order_item_id', v_order_item_id,
      'item_id', p_item_id,
      'qty_requested', p_qty,
      'qty_shippable', v_ship,
      'qty_po', v_po,
      'price_quoted', v_insert_price,
      'is_foc', v_is_foc,
      'salesperson', v_user_name
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

CREATE OR REPLACE FUNCTION public.remove_sales_submitted_line(
  p_order_item_id BIGINT,
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
  v_line RECORD;
  v_order RECORD;
  v_user_name TEXT;
  v_now TIMESTAMPTZ := now();
  v_gate JSONB;
BEGIN
  SELECT id, order_id, stage, claimed_by_user_id
  INTO v_claim
  FROM public.work_claims
  WHERE id = p_claim_id
    AND stage = 'sales_edit'
    AND claimed_by_user_id = p_user_id
    AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'claim_lost');
  END IF;

  SELECT oi.id, oi.order_id, oi.item_id, oi.item_name, oi.qty_requested
  INTO v_line
  FROM public.order_items oi
  WHERE oi.id = p_order_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'line_not_found');
  END IF;

  IF v_line.order_id IS DISTINCT FROM v_claim.order_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'line_order_mismatch');
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = v_line.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  v_gate := public.assert_sales_line_edit_allowed(
    v_order.workflow_status,
    v_order.picker_name,
    v_order.salesperson_user_id,
    p_user_id
  );
  IF v_gate IS NOT NULL THEN
    RETURN v_gate;
  END IF;

  SELECT full_name INTO v_user_name
  FROM public.users
  WHERE id = p_user_id AND role = 'sales' AND is_active = true;
  IF v_user_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_salesperson');
  END IF;

  IF (SELECT COUNT(*)::INT FROM public.order_items WHERE order_id = v_line.order_id) <= 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'last_line');
  END IF;

  UPDATE public.stock_reservations sr
  SET status = 'cancelled',
      cancelled_at = COALESCE(sr.cancelled_at, v_now),
      last_reconciled_at = COALESCE(sr.last_reconciled_at, v_now)
  WHERE sr.order_item_id = p_order_item_id
    AND sr.status IN ('active', 'awaiting_erp_sync');

  UPDATE public.pending_items pi
  SET status = 'cancelled',
      resolved_at = v_now,
      resolved_by = v_user_name,
      note = CASE
        WHEN pi.note IS NOT NULL AND length(trim(pi.note)) > 0
          THEN trim(pi.note) || E'\nLine removed by sales edit'
        ELSE 'Line removed by sales edit'
      END
  WHERE pi.order_id = v_line.order_id
    AND pi.item_id = v_line.item_id
    AND pi.status = 'pending';

  DELETE FROM public.order_items WHERE id = p_order_item_id;

  UPDATE public.orders o
  SET
    item_count = sub.cnt,
    total_value = sub.tval
  FROM (
    SELECT
      COUNT(*)::INT AS cnt,
      COALESCE(SUM(COALESCE(oi.price_quoted, 0) * GREATEST(COALESCE(oi.qty_shippable, 0), 0)), 0)::NUMERIC AS tval
    FROM public.order_items oi
    WHERE oi.order_id = v_line.order_id
  ) sub
  WHERE o.id = v_line.order_id;

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
  VALUES (
    v_line.order_id,
    'sales_line_removed',
    p_user_id,
    'sales_edit',
    jsonb_build_object(
      'order_item_id', p_order_item_id,
      'item_id', v_line.item_id,
      'item_name', v_line.item_name,
      'qty_requested', v_line.qty_requested,
      'salesperson', v_user_name
    )
  );

  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'submit_failed',
      'detail', SQLERRM
    );
END;
$$;

-- Skip orders sales is actively editing when auto-assigning from the pick queue.
CREATE OR REPLACE FUNCTION public.assign_next_picking_order(p_user_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name text;
  v_claim_id bigint;
  v_order_id bigint;
  v_existing_claim record;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_user_id');
  END IF;

  SELECT full_name INTO v_user_name
  FROM public.users
  WHERE id = p_user_id AND is_active = true;

  IF v_user_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'user_not_found');
  END IF;

  SELECT wc.id, wc.order_id, o.workflow_status
  INTO v_existing_claim
  FROM public.work_claims wc
  JOIN public.orders o ON o.id = wc.order_id
  WHERE wc.claimed_by_user_id = p_user_id
    AND wc.stage = 'picking'
    AND wc.status = 'active'
  ORDER BY wc.claimed_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'order_id', v_existing_claim.order_id,
      'claim_id', v_existing_claim.id,
      'resumed', true,
      'started', v_existing_claim.workflow_status = 'picking'
    );
  END IF;

  PERFORM public.expire_stale_claims();

  SELECT o.id
  INTO v_order_id
  FROM public.orders o
  WHERE o.workflow_status = 'approved'
    AND o.fulfillment_path IS DISTINCT FROM 'direct_bill'
    AND o.stock_location_code IS DISTINCT FROM 'jabalpur'
    AND public.order_has_pickable_lines(o.id)
    AND (o.picker_name IS NULL OR btrim(o.picker_name) = '')
    AND NOT EXISTS (
      SELECT 1
      FROM public.work_claims wc
      WHERE wc.order_id = o.id
        AND wc.stage = 'picking'
        AND wc.status = 'active'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.work_claims wc
      WHERE wc.order_id = o.id
        AND wc.stage = 'sales_edit'
        AND wc.status = 'active'
        AND (now() - wc.last_heartbeat_at) <= INTERVAL '3 minutes'
    )
  ORDER BY
    (o.priority = 'urgent') DESC,
    o.approved_at DESC NULLS LAST,
    o.id DESC
  LIMIT 1
  FOR UPDATE OF o SKIP LOCKED;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'queue_empty');
  END IF;

  INSERT INTO public.work_claims (order_id, stage, claimed_by_user_id)
  VALUES (v_order_id, 'picking', p_user_id)
  RETURNING id INTO v_claim_id;

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage)
  VALUES (v_order_id, 'picking_claimed', p_user_id, 'picking');

  UPDATE public.orders
  SET picker_name = v_user_name
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'claim_id', v_claim_id,
    'resumed', false,
    'started', false
  );
END;
$$;

-- Skip orders sales is actively editing when auto-assigning from the pick queue.
CREATE OR REPLACE FUNCTION public.assign_next_picking_order(p_user_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_name text;
  v_claim_id bigint;
  v_order_id bigint;
  v_existing_claim record;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_user_id');
  END IF;

  SELECT full_name INTO v_user_name
  FROM public.users
  WHERE id = p_user_id AND is_active = true;

  IF v_user_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'user_not_found');
  END IF;

  SELECT wc.id, wc.order_id, o.workflow_status
  INTO v_existing_claim
  FROM public.work_claims wc
  JOIN public.orders o ON o.id = wc.order_id
  WHERE wc.claimed_by_user_id = p_user_id
    AND wc.stage = 'picking'
    AND wc.status = 'active'
  ORDER BY wc.claimed_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'order_id', v_existing_claim.order_id,
      'claim_id', v_existing_claim.id,
      'resumed', true,
      'started', v_existing_claim.workflow_status = 'picking'
    );
  END IF;

  PERFORM public.expire_stale_claims();

  SELECT o.id
  INTO v_order_id
  FROM public.orders o
  WHERE o.workflow_status = 'approved'
    AND o.fulfillment_path IS DISTINCT FROM 'direct_bill'
    AND o.stock_location_code IS DISTINCT FROM 'jabalpur'
    AND public.order_has_pickable_lines(o.id)
    AND (o.picker_name IS NULL OR btrim(o.picker_name) = '')
    AND NOT EXISTS (
      SELECT 1
      FROM public.work_claims wc
      WHERE wc.order_id = o.id
        AND wc.stage = 'picking'
        AND wc.status = 'active'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.work_claims wc
      WHERE wc.order_id = o.id
        AND wc.stage = 'sales_edit'
        AND wc.status = 'active'
        AND (now() - wc.last_heartbeat_at) <= INTERVAL '3 minutes'
    )
  ORDER BY
    (o.priority = 'urgent') DESC,
    o.approved_at DESC NULLS LAST,
    o.id DESC
  LIMIT 1
  FOR UPDATE OF o SKIP LOCKED;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'queue_empty');
  END IF;

  INSERT INTO public.work_claims (order_id, stage, claimed_by_user_id)
  VALUES (v_order_id, 'picking', p_user_id)
  RETURNING id INTO v_claim_id;

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage)
  VALUES (v_order_id, 'picking_claimed', p_user_id, 'picking');

  UPDATE public.orders
  SET picker_name = v_user_name
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'claim_id', v_claim_id,
    'resumed', false,
    'started', false
  );
END;
$$;
