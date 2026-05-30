-- Stable bill line sequence: same order in desk review, Needs Review, Live Queue copy, and Busy paste.

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS bill_line_no INTEGER;

UPDATE public.order_items oi
SET bill_line_no = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY id)::INTEGER AS rn
  FROM public.order_items
) sub
WHERE oi.id = sub.id
  AND oi.bill_line_no IS NULL;

-- Split siblings immediately after parent (by sibling id order).
WITH split_ranked AS (
  SELECT
    oi.id,
    parent.bill_line_no
      + ROW_NUMBER() OVER (PARTITION BY oi.split_from_id ORDER BY oi.id)::INTEGER AS new_no
  FROM public.order_items oi
  JOIN public.order_items parent ON parent.id = oi.split_from_id
  WHERE oi.split_from_id IS NOT NULL
)
UPDATE public.order_items oi
SET bill_line_no = split_ranked.new_no
FROM split_ranked
WHERE oi.id = split_ranked.id;

ALTER TABLE public.order_items
  ALTER COLUMN bill_line_no SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_order_bill_line
  ON public.order_items(order_id, bill_line_no);

CREATE OR REPLACE FUNCTION public.next_order_bill_line_no(p_order_id BIGINT)
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(MAX(bill_line_no), 0) + 1
  FROM public.order_items
  WHERE order_id = p_order_id;
$$;

CREATE OR REPLACE FUNCTION public.allocate_split_bill_line_no(
  p_order_id BIGINT,
  p_root_order_item_id BIGINT
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_root public.order_items%ROWTYPE;
  v_insert_at INTEGER;
BEGIN
  SELECT *
  INTO v_root
  FROM public.order_items
  WHERE id = p_root_order_item_id
    AND order_id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'root line not found';
  END IF;

  v_insert_at := v_root.bill_line_no + (
    SELECT COUNT(*)::INTEGER
    FROM public.order_items
    WHERE order_id = p_order_id
      AND split_from_id = p_root_order_item_id
  ) + 1;

  UPDATE public.order_items
  SET bill_line_no = bill_line_no + 1
  WHERE order_id = p_order_id
    AND bill_line_no >= v_insert_at;

  RETURN v_insert_at;
END;
$$;

-- submit_sales_order: set bill_line_no from cart_position on insert.
CREATE OR REPLACE FUNCTION public.submit_sales_order(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_customer_id BIGINT;
  v_customer_name TEXT;
  v_customer_city TEXT;
  v_transport_id BIGINT;
  v_transport_name TEXT;
  v_salesperson_name TEXT;
  v_salesperson_user_id BIGINT;
  v_stock_location_code TEXT;
  v_priority TEXT;
  v_notes TEXT;
  v_line_count INT;
  v_matched_lines INT;
  v_lines JSONB := '[]'::jsonb;
  r RECORD;
  v_item_id BIGINT;
  v_qty INT;
  v_price_quoted NUMERIC;
  v_price_system NUMERIC;
  v_is_foc BOOLEAN;
  v_item public.items%ROWTYPE;
  v_busy_code NUMERIC;
  v_payload_reserved_qty NUMERIC;
  v_available_qty INT;
  v_ship INT;
  v_po INT;
  v_total_qty INT := 0;
  v_total_value NUMERIC := 0;
  v_order_id BIGINT;
  v_order_number TEXT;
  v_line JSONB;
  v_order_item_id BIGINT;
BEGIN
  BEGIN
    IF p_payload IS NULL OR p_payload->'lines' IS NULL OR jsonb_array_length(p_payload->'lines') = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'no_lines');
    END IF;

    v_customer_id := NULLIF(TRIM(p_payload->>'customer_id'), '')::BIGINT;
    v_customer_name := NULLIF(TRIM(p_payload->>'customer_name'), '');
    IF v_customer_id IS NULL OR v_customer_name IS NULL OR length(trim(v_customer_name)) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_customer');
    END IF;

    v_customer_city := NULLIF(TRIM(p_payload->>'customer_city'), '');
    v_transport_id := NULLIF(TRIM(p_payload->>'transport_id'), '')::BIGINT;
    v_transport_name := NULLIF(TRIM(p_payload->>'transport_name'), '');
    v_salesperson_name := COALESCE(NULLIF(TRIM(p_payload->>'salesperson_name'), ''), 'Unknown');
    v_salesperson_user_id := NULLIF(TRIM(p_payload->>'salesperson_user_id'), '')::BIGINT;

    IF v_salesperson_user_id IS NOT NULL THEN
      SELECT u.full_name
      INTO v_salesperson_name
      FROM public.users u
      WHERE u.id = v_salesperson_user_id
        AND u.role = 'sales'
        AND u.is_active = true;

      IF v_salesperson_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'invalid_salesperson');
      END IF;
    ELSE
      SELECT u.id, u.full_name
      INTO v_salesperson_user_id, v_salesperson_name
      FROM public.users u
      WHERE u.role = 'sales'
        AND u.is_active = true
        AND public.normalize_salesperson_key(u.full_name) = public.normalize_salesperson_key(v_salesperson_name)
      LIMIT 1;
    END IF;

    v_stock_location_code := public.stock_location_for_user(v_salesperson_user_id, v_salesperson_name);

    v_priority := COALESCE(NULLIF(TRIM(p_payload->>'priority'), ''), 'normal');
    IF v_priority NOT IN ('normal', 'urgent') THEN
      v_priority := 'normal';
    END IF;
    v_notes := NULLIF(TRIM(p_payload->>'notes'), '');

    SELECT count(*)::INT INTO v_line_count
    FROM jsonb_array_elements(p_payload->'lines') AS elem;

    SELECT count(*)::INT INTO v_matched_lines
    FROM jsonb_array_elements(p_payload->'lines') AS elem
    JOIN public.items i ON i.id = (elem->>'item_id')::BIGINT;

    IF v_matched_lines <> v_line_count THEN
      RETURN jsonb_build_object('success', false, 'error', 'unknown_item');
    END IF;

    FOR r IN
      SELECT elem, ordinality AS cart_pos
      FROM jsonb_array_elements(p_payload->'lines') WITH ORDINALITY AS t(elem, ordinality)
      ORDER BY (elem->>'item_id')::BIGINT, ordinality
    LOOP
      v_item_id := (r.elem->>'item_id')::BIGINT;
      v_qty := (r.elem->>'qty_requested')::INTEGER;
      IF v_qty IS NULL OR v_qty < 1 THEN
        RAISE EXCEPTION 'invalid_qty';
      END IF;

      v_is_foc := COALESCE((r.elem->>'is_foc')::BOOLEAN, false);

      v_price_quoted := (r.elem->>'price_quoted')::NUMERIC;
      v_price_system := (r.elem->>'price_system')::NUMERIC;

      IF v_is_foc THEN
        v_price_quoted := 0;
        IF v_price_system IS NULL OR v_price_system < 0 THEN
          v_price_system := 0;
        END IF;
      ELSE
        IF v_price_quoted IS NULL OR v_price_quoted < 0 THEN
          v_price_quoted := COALESCE(v_price_system, 0);
        END IF;
        IF v_price_system IS NULL OR v_price_system < 0 THEN
          v_price_system := 0;
        END IF;
      END IF;

      SELECT * INTO v_item
      FROM public.items
      WHERE id = v_item_id
      FOR UPDATE;

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

        SELECT COALESCE(SUM((elem->>'qty_shippable')::INTEGER), 0)
        INTO v_payload_reserved_qty
        FROM jsonb_array_elements(v_lines) AS e(elem)
        WHERE NULLIF(elem->>'busy_code', '')::NUMERIC IS NOT DISTINCT FROM v_busy_code
          AND elem->>'stock_location_code' = v_stock_location_code;

        v_available_qty := public.guarded_locationwise_available_qty(
          v_busy_code,
          v_stock_location_code,
          v_payload_reserved_qty
        );
      END IF;

      v_ship := LEAST(v_qty, v_available_qty);
      v_po := v_qty - v_ship;

      v_total_qty := v_total_qty + v_ship;
      v_total_value := v_total_value + (v_price_quoted * v_ship);

      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'cart_position', r.cart_pos,
          'bill_line_no', r.cart_pos,
          'item_id', v_item_id,
          'busy_code', v_busy_code,
          'item_name', v_item.name,
          'item_alias', v_item.alias,
          'rack_no', v_item.rack_no,
          'qty_requested', v_qty,
          'qty_shippable', v_ship,
          'qty_po', v_po,
          'price_quoted', v_price_quoted,
          'price_system', v_price_system,
          'stock_location_code', v_stock_location_code,
          'is_foc', v_is_foc
        )
      );
    END LOOP;

    INSERT INTO public.orders (
      customer_id,
      customer_name,
      customer_city,
      transport_id,
      transport_name,
      salesperson_name,
      salesperson_user_id,
      stock_location_code,
      workflow_status,
      priority,
      notes,
      item_count,
      total_value
    )
    VALUES (
      v_customer_id,
      v_customer_name,
      v_customer_city,
      v_transport_id,
      v_transport_name,
      v_salesperson_name,
      v_salesperson_user_id,
      v_stock_location_code,
      'submitted',
      v_priority,
      v_notes,
      v_line_count,
      v_total_value
    )
    RETURNING id, order_number INTO v_order_id, v_order_number;

    FOR v_line IN
      SELECT elem FROM jsonb_array_elements(v_lines) AS e(elem)
      ORDER BY (elem->>'cart_position')::INTEGER
    LOOP
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
        v_order_id,
        (v_line->>'item_id')::BIGINT,
        v_line->>'item_name',
        NULLIF(v_line->>'item_alias', ''),
        NULLIF(v_line->>'rack_no', ''),
        (v_line->>'qty_requested')::INTEGER,
        (v_line->>'qty_shippable')::INTEGER,
        (v_line->>'qty_po')::INTEGER,
        (v_line->>'qty_shippable')::INTEGER,
        (v_line->>'price_quoted')::NUMERIC,
        (v_line->>'price_system')::NUMERIC,
        'pending',
        v_line->>'stock_location_code',
        COALESCE((v_line->>'is_foc')::BOOLEAN, false),
        (v_line->>'bill_line_no')::INTEGER
      )
      RETURNING id INTO v_order_item_id;

      IF (v_line->>'qty_shippable')::INTEGER > 0 AND NULLIF(v_line->>'busy_code', '') IS NOT NULL THEN
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
          v_order_id,
          v_order_item_id,
          (v_line->>'item_id')::BIGINT,
          (v_line->>'busy_code')::NUMERIC,
          v_line->>'stock_location_code',
          (v_line->>'qty_shippable')::INTEGER,
          'active',
          'order_submit',
          v_salesperson_user_id,
          v_salesperson_name
        );
      END IF;
    END LOOP;

    FOR v_line IN
      SELECT elem FROM jsonb_array_elements(v_lines) AS e(elem)
    LOOP
      IF (v_line->>'qty_po')::INTEGER > 0 THEN
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
          v_order_id,
          v_order_number,
          v_customer_id,
          v_customer_name,
          (v_line->>'item_id')::BIGINT,
          v_line->>'item_name',
          (v_line->>'qty_po')::INTEGER,
          'sales',
          v_salesperson_name,
          'Purchase order qty from sales checkout',
          v_line->>'stock_location_code'
        );
      END IF;
    END LOOP;

    RETURN jsonb_build_object(
      'success', true,
      'order_id', v_order_id,
      'order_number', v_order_number,
      'item_count', v_line_count,
      'total_qty', v_total_qty,
      'total_value', v_total_value,
      'stock_location_code', v_stock_location_code,
      'lines', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'name', elem->>'item_name',
              'qty_requested', (elem->>'qty_requested')::INTEGER,
              'qty_ship', (elem->>'qty_shippable')::INTEGER,
              'qty_po', (elem->>'qty_po')::INTEGER,
              'stock_location_code', elem->>'stock_location_code',
              'is_foc', COALESCE((elem->>'is_foc')::BOOLEAN, false)
            )
            ORDER BY (elem->>'cart_position')::INTEGER
          )
          FROM jsonb_array_elements(v_lines) AS e(elem)
        ),
        '[]'::jsonb
      )
    );
  EXCEPTION
    WHEN OTHERS THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'submit_failed',
        'detail', SQLERRM
      );
  END;
END;
$func$;

-- Patch add_billing_line: append bill_line_no at end.
CREATE OR REPLACE FUNCTION public.add_billing_line(
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
      'price_quoted', v_insert_price,
      'is_foc', v_is_foc,
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

-- Patch add_sales_submitted_line: append bill_line_no at end.
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

-- Patch split_order_item_at_pick: insert sibling with bill_line_no after parent.
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
    v_root.price_quoted,
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
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_order_bill_line_no(BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.allocate_split_bill_line_no(BIGINT, BIGINT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.split_order_item_at_pick(
  BIGINT, BIGINT, BIGINT, BIGINT, INTEGER, NUMERIC, JSONB, BOOLEAN
) TO anon, authenticated, service_role;
