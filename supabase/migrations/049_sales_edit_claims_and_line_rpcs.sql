-- Sales post-submit line edits: sales_edit work_claims stage, mutual exclusion with billing,
-- add_sales_submitted_line / remove_sales_submitted_line RPCs, billing queue snapshot fields.

-- ─── 1. Extend work_claims.stage ───────────────────────────────────────────
ALTER TABLE public.work_claims DROP CONSTRAINT IF EXISTS work_claims_stage_check;
ALTER TABLE public.work_claims
  ADD CONSTRAINT work_claims_stage_check CHECK (stage IN ('billing', 'picking', 'sales_edit'));

-- ─── 2. claim_order — sales_edit + cross-stage locks ───────────────────────
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
  v_stale_threshold INTERVAL := INTERVAL '3 minutes';
BEGIN
  IF p_stage NOT IN ('billing', 'picking', 'sales_edit') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Invalid stage');
  END IF;

  SELECT id, workflow_status, salesperson_user_id INTO v_order
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

    IF v_order.workflow_status IS DISTINCT FROM 'submitted' THEN
      RETURN jsonb_build_object('success', false, 'reason', 'not_submitted');
    END IF;

    IF v_order.salesperson_user_id IS DISTINCT FROM p_user_id THEN
      RETURN jsonb_build_object('success', false, 'reason', 'not_owner');
    END IF;

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

    IF (now() - v_existing.last_heartbeat_at) > v_stale_threshold THEN
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
    SET workflow_status = 'picking',
        picker_name = v_user_name,
        picked_at = COALESCE(picked_at, now())
    WHERE id = p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'claim_id', v_claim_id,
    'claim_version', 1
  );
END;
$$;

-- ─── 3. release_claim — sales_edit event label ─────────────────────────────
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
      AND workflow_status = 'picking';
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─── 4. expire_stale_claims — no workflow change for sales_edit ────────────
-- (Body unchanged from prior revision; re-applied for SET search_path consistency.)
CREATE OR REPLACE FUNCTION public.expire_stale_claims()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_count INTEGER := 0;
  v_claim RECORD;
  v_stale_threshold INTERVAL := INTERVAL '3 minutes';
BEGIN
  FOR v_claim IN
    SELECT wc.id, wc.order_id, wc.stage, wc.claimed_by_user_id, u.full_name
    FROM public.work_claims wc
    JOIN public.users u ON u.id = wc.claimed_by_user_id
    WHERE wc.status = 'active'
      AND (now() - wc.last_heartbeat_at) > v_stale_threshold
  LOOP
    UPDATE public.work_claims
    SET status = 'expired',
        released_at = now()
    WHERE id = v_claim.id;

    INSERT INTO public.order_events (order_id, event_type, stage, payload)
    VALUES (v_claim.order_id, 'claim_expired', v_claim.stage,
            jsonb_build_object(
              'expired_claim_id', v_claim.id,
              'expired_user', v_claim.full_name,
              'reason', 'heartbeat_timeout'
            ));

    IF v_claim.stage = 'picking' THEN
      UPDATE public.orders
      SET workflow_status = 'approved',
          picker_name = NULL
      WHERE id = v_claim.order_id
        AND workflow_status = 'picking';
    END IF;

    v_expired_count := v_expired_count + 1;
  END LOOP;

  RETURN jsonb_build_object('expired_count', v_expired_count);
END;
$$;

-- ─── 5. Billing queue snapshot — sales_edit lock columns ─────────────────
-- Return type changed (extra columns) — drop then recreate.
DROP FUNCTION IF EXISTS public.get_billing_queue_snapshot(text[], timestamptz, timestamptz);

CREATE FUNCTION public.get_billing_queue_snapshot(
  p_statuses text[] DEFAULT NULL,
  p_created_from timestamptz DEFAULT NULL,
  p_created_to timestamptz DEFAULT NULL
) RETURNS TABLE (
  id BIGINT,
  order_number TEXT,
  order_kind TEXT,
  customer_id BIGINT,
  customer_name TEXT,
  customer_city TEXT,
  transport_id BIGINT,
  transport_name TEXT,
  salesperson_name TEXT,
  salesperson_user_id BIGINT,
  reviewer_name TEXT,
  picker_name TEXT,
  workflow_status TEXT,
  priority TEXT,
  notes TEXT,
  item_count INTEGER,
  ask_line_count INTEGER,
  special_rate_line_count INTEGER,
  special_rate_qty INTEGER,
  total_value NUMERIC,
  created_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  picked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  claim_id BIGINT,
  claimed_by_user_id BIGINT,
  claimed_by_name TEXT,
  claimed_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  claim_is_stale BOOLEAN,
  sales_edit_claim_id BIGINT,
  sales_edit_claimed_by_user_id BIGINT,
  sales_edit_claimed_by_name TEXT,
  sales_edit_claimed_at TIMESTAMPTZ,
  sales_edit_last_heartbeat_at TIMESTAMPTZ,
  sales_edit_claim_is_stale BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered_orders AS (
    SELECT
      id,
      order_number,
      order_kind,
      customer_id,
      customer_name,
      customer_city,
      transport_id,
      transport_name,
      salesperson_name,
      salesperson_user_id,
      reviewer_name,
      picker_name,
      workflow_status,
      priority,
      notes,
      item_count,
      total_value,
      created_at,
      approved_at,
      picked_at,
      completed_at,
      dispatched_at
    FROM public.orders
    WHERE (p_statuses IS NULL OR workflow_status = ANY(p_statuses))
      AND (p_created_from IS NULL OR created_at >= p_created_from)
      AND (p_created_to IS NULL OR created_at <= p_created_to)
  ),
  line_summary AS (
    SELECT
      oi.order_id,
      COUNT(*)::INTEGER AS live_item_count,
      COUNT(*) FILTER (
        WHERE public.is_ask_line(i.main_group, i.parent_group, oi.item_name)
      )::INTEGER AS ask_line_count,
      COUNT(*) FILTER (
        WHERE oi.price_quoted IS NOT NULL
          AND oi.price_system IS NOT NULL
          AND oi.price_quoted IS DISTINCT FROM oi.price_system
      )::INTEGER AS special_rate_line_count,
      COALESCE(
        SUM(
          CASE
            WHEN oi.price_quoted IS NOT NULL
              AND oi.price_system IS NOT NULL
              AND oi.price_quoted IS DISTINCT FROM oi.price_system
            THEN GREATEST(COALESCE(oi.qty_requested, 0), 0)
            ELSE 0
          END
        ),
        0
      )::INTEGER AS special_rate_qty
    FROM public.order_items oi
    INNER JOIN filtered_orders fo ON fo.id = oi.order_id
    LEFT JOIN public.items i ON i.id = oi.item_id
    GROUP BY oi.order_id
  ),
  active_billing_claims AS (
    SELECT DISTINCT ON (wc.order_id)
      wc.order_id,
      wc.id AS claim_id,
      wc.claimed_by_user_id,
      u.full_name AS claimed_by_name,
      wc.claimed_at,
      wc.last_heartbeat_at,
      ((now() - wc.last_heartbeat_at) > INTERVAL '3 minutes') AS claim_is_stale
    FROM public.work_claims wc
    LEFT JOIN public.users u ON u.id = wc.claimed_by_user_id
    WHERE wc.stage = 'billing'
      AND wc.status = 'active'
    ORDER BY wc.order_id, wc.claimed_at DESC
  ),
  active_sales_edit_claims AS (
    SELECT DISTINCT ON (wc.order_id)
      wc.order_id,
      wc.id AS sales_edit_claim_id,
      wc.claimed_by_user_id AS sales_edit_claimed_by_user_id,
      u.full_name AS sales_edit_claimed_by_name,
      wc.claimed_at AS sales_edit_claimed_at,
      wc.last_heartbeat_at AS sales_edit_last_heartbeat_at,
      ((now() - wc.last_heartbeat_at) > INTERVAL '3 minutes') AS sales_edit_claim_is_stale
    FROM public.work_claims wc
    LEFT JOIN public.users u ON u.id = wc.claimed_by_user_id
    WHERE wc.stage = 'sales_edit'
      AND wc.status = 'active'
    ORDER BY wc.order_id, wc.claimed_at DESC
  )
  SELECT
    o.id,
    o.order_number,
    o.order_kind,
    o.customer_id,
    o.customer_name,
    o.customer_city,
    o.transport_id,
    o.transport_name,
    o.salesperson_name,
    o.salesperson_user_id,
    o.reviewer_name,
    o.picker_name,
    o.workflow_status,
    o.priority,
    o.notes,
    COALESCE(ls.live_item_count, o.item_count, 0)::INTEGER AS item_count,
    COALESCE(ls.ask_line_count, 0)::INTEGER AS ask_line_count,
    COALESCE(ls.special_rate_line_count, 0)::INTEGER AS special_rate_line_count,
    COALESCE(ls.special_rate_qty, 0)::INTEGER AS special_rate_qty,
    COALESCE(o.total_value, 0) AS total_value,
    o.created_at,
    o.approved_at,
    o.picked_at,
    o.completed_at,
    o.dispatched_at,
    abc.claim_id,
    abc.claimed_by_user_id,
    abc.claimed_by_name,
    abc.claimed_at,
    abc.last_heartbeat_at,
    abc.claim_is_stale,
    asec.sales_edit_claim_id,
    asec.sales_edit_claimed_by_user_id,
    asec.sales_edit_claimed_by_name,
    asec.sales_edit_claimed_at,
    asec.sales_edit_last_heartbeat_at,
    asec.sales_edit_claim_is_stale
  FROM filtered_orders o
  LEFT JOIN line_summary ls ON ls.order_id = o.id
  LEFT JOIN active_billing_claims abc ON abc.order_id = o.id
  LEFT JOIN active_sales_edit_claims asec ON asec.order_id = o.id
  ORDER BY o.created_at DESC;
$$;

COMMENT ON FUNCTION public.get_billing_queue_snapshot(TEXT[], TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Billing queue snapshot + optional active sales_edit lock row per order.';

GRANT EXECUTE ON FUNCTION public.get_billing_queue_snapshot(TEXT[], TIMESTAMPTZ, TIMESTAMPTZ)
  TO PUBLIC;

-- ─── 6. add_billing_line — block when sales is editing ─────────────────────
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
  v_se_lock RECORD;
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

  SELECT wc.id, u.full_name AS locked_by_name
  INTO v_se_lock
  FROM public.work_claims wc
  JOIN public.users u ON u.id = wc.claimed_by_user_id
  WHERE wc.order_id = p_order_id
    AND wc.stage = 'sales_edit'
    AND wc.status = 'active'
    AND (now() - wc.last_heartbeat_at) <= INTERVAL '3 minutes';

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'locked_by_sales_edit',
      'detail', v_se_lock.locked_by_name
    );
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

-- ─── 7. add_sales_submitted_line ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_sales_submitted_line(
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

  IF v_order.workflow_status IS DISTINCT FROM 'submitted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_submitted');
  END IF;

  IF v_order.salesperson_user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_owner');
  END IF;

  SELECT full_name INTO v_user_name
  FROM public.users
  WHERE id = p_user_id AND role = 'sales' AND is_active = true;
  IF v_user_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_salesperson');
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
      'price_quoted', p_price_quoted,
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

COMMENT ON FUNCTION public.add_sales_submitted_line(BIGINT, BIGINT, INTEGER, NUMERIC, BIGINT, BIGINT) IS
  'Sales edit on submitted order: add line with allocation + reservation + optional PO pending row. Requires active sales_edit claim.';

GRANT EXECUTE ON FUNCTION public.add_sales_submitted_line(BIGINT, BIGINT, INTEGER, NUMERIC, BIGINT, BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION public.add_sales_submitted_line(BIGINT, BIGINT, INTEGER, NUMERIC, BIGINT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_sales_submitted_line(BIGINT, BIGINT, INTEGER, NUMERIC, BIGINT, BIGINT) TO service_role;

-- ─── 8. remove_sales_submitted_line ─────────────────────────────────────────
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

  IF v_order.workflow_status IS DISTINCT FROM 'submitted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_submitted');
  END IF;

  IF v_order.salesperson_user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_owner');
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

COMMENT ON FUNCTION public.remove_sales_submitted_line(BIGINT, BIGINT, BIGINT) IS
  'Sales edit: remove one order line; cancels reservations + pending rows for that SKU; recomputes order totals.';

GRANT EXECUTE ON FUNCTION public.remove_sales_submitted_line(BIGINT, BIGINT, BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION public.remove_sales_submitted_line(BIGINT, BIGINT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_sales_submitted_line(BIGINT, BIGINT, BIGINT) TO service_role;
