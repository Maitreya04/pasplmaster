-- PASPL Master - guard stale location-wise stock from being sold
--
-- Production finding:
--   items.stock_qty can be refreshed by the item master sync while an older
--   stock_locationwise row remains positive. The sales UI and order submit
--   paths must not sell from that stale location row when the newer item
--   master says total stock is zero.
--
-- This is a conservative safety guard. The long-term fix is a single
-- snapshot-based stock sync that replaces every location vector per busy_code
-- and marks rows verified by sync_run_id / last_verified_at.

CREATE OR REPLACE FUNCTION public.guarded_locationwise_available_qty(
  p_busy_code NUMERIC,
  p_stock_location_code TEXT,
  p_payload_reserved_qty NUMERIC DEFAULT 0
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock_location_code TEXT;
  v_item_stock_qty NUMERIC;
  v_item_updated_at TIMESTAMPTZ;
  v_physical_qty NUMERIC := 0;
  v_latest_stock_updated_at TIMESTAMPTZ;
  v_reserved_qty NUMERIC := 0;
BEGIN
  IF p_busy_code IS NULL THEN
    RETURN 0;
  END IF;

  v_stock_location_code := CASE p_stock_location_code
    WHEN 'jabalpur' THEN 'jabalpur'
    ELSE 'main_store'
  END;

  SELECT i.stock_qty, i.updated_at
  INTO v_item_stock_qty, v_item_updated_at
  FROM public.items i
  WHERE i.busy_code IS NOT DISTINCT FROM p_busy_code
    AND COALESCE(i.is_active, true) = true
  ORDER BY i.id
  LIMIT 1;

  SELECT COALESCE(SUM(sl.stock_qty), 0), MAX(sl.updated_at)
  INTO v_physical_qty, v_latest_stock_updated_at
  FROM public.stock_locationwise sl
  WHERE sl.busy_code::NUMERIC IS NOT DISTINCT FROM p_busy_code
    AND public.normalize_stock_location_code(sl.stock_location) = v_stock_location_code;

  -- If the item master has newer evidence that total stock is zero/negative,
  -- the older positive location row is unsafe. Hide it from availability and
  -- from backend reservation math.
  IF COALESCE(v_item_stock_qty, 0) <= 0
     AND v_item_updated_at IS NOT NULL
     AND (
       v_latest_stock_updated_at IS NULL
       OR v_item_updated_at >= v_latest_stock_updated_at
     ) THEN
    v_physical_qty := 0;
  END IF;

  SELECT COALESCE(SUM(sr.qty_reserved), 0)
  INTO v_reserved_qty
  FROM public.stock_reservations sr
  WHERE sr.busy_code IS NOT DISTINCT FROM p_busy_code
    AND sr.stock_location_code = v_stock_location_code
    AND sr.status IN ('active', 'awaiting_erp_sync');

  RETURN FLOOR(
    GREATEST(
      COALESCE(v_physical_qty, 0)
        - COALESCE(v_reserved_qty, 0)
        - COALESCE(p_payload_reserved_qty, 0),
      0
    )
  )::INTEGER;
END;
$$;

COMMENT ON FUNCTION public.guarded_locationwise_available_qty(NUMERIC, TEXT, NUMERIC) IS
  'Conservative sellable stock guard: location stock minus reservations, zeroed when a newer item-master zero makes the location row stale.';

GRANT EXECUTE ON FUNCTION public.guarded_locationwise_available_qty(NUMERIC, TEXT, NUMERIC) TO anon;
GRANT EXECUTE ON FUNCTION public.guarded_locationwise_available_qty(NUMERIC, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guarded_locationwise_available_qty(NUMERIC, TEXT, NUMERIC) TO service_role;

CREATE OR REPLACE VIEW public.locationwise_stock_available AS
WITH physical AS (
  SELECT
    sl.busy_code::NUMERIC AS busy_code,
    public.normalize_stock_location_code(sl.stock_location) AS stock_location_code,
    SUM(COALESCE(sl.stock_qty, 0))::NUMERIC AS raw_physical_qty,
    MAX(sl.updated_at) AS latest_stock_updated_at
  FROM public.stock_locationwise sl
  WHERE public.normalize_stock_location_code(sl.stock_location) IS NOT NULL
  GROUP BY sl.busy_code::NUMERIC, public.normalize_stock_location_code(sl.stock_location)
),
reserved AS (
  SELECT
    sr.busy_code,
    sr.stock_location_code,
    SUM(sr.qty_reserved)::NUMERIC AS reserved_qty
  FROM public.stock_reservations sr
  WHERE sr.status IN ('active', 'awaiting_erp_sync')
  GROUP BY sr.busy_code, sr.stock_location_code
),
item_master AS (
  SELECT DISTINCT ON (i.busy_code)
    i.busy_code,
    i.stock_qty,
    i.updated_at
  FROM public.items i
  WHERE i.busy_code IS NOT NULL
    AND COALESCE(i.is_active, true) = true
  ORDER BY i.busy_code, i.id
),
guarded AS (
  SELECT
    p.busy_code,
    p.stock_location_code,
    p.raw_physical_qty,
    CASE
      WHEN COALESCE(i.stock_qty, 0) <= 0
       AND i.updated_at IS NOT NULL
       AND (p.latest_stock_updated_at IS NULL OR i.updated_at >= p.latest_stock_updated_at)
      THEN 0::NUMERIC
      ELSE p.raw_physical_qty
    END AS physical_qty,
    p.latest_stock_updated_at
  FROM physical p
  LEFT JOIN item_master i
    ON i.busy_code IS NOT DISTINCT FROM p.busy_code
)
SELECT
  g.busy_code,
  g.stock_location_code,
  public.stock_location_label(g.stock_location_code) AS stock_location_label,
  g.physical_qty,
  COALESCE(r.reserved_qty, 0)::NUMERIC AS reserved_qty,
  GREATEST(g.physical_qty - COALESCE(r.reserved_qty, 0), 0)::NUMERIC AS available_qty,
  g.latest_stock_updated_at
FROM guarded g
LEFT JOIN reserved r
  ON r.busy_code IS NOT DISTINCT FROM g.busy_code
 AND r.stock_location_code = g.stock_location_code;

GRANT SELECT ON public.locationwise_stock_available TO anon, authenticated, service_role;

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

      v_price_quoted := (r.elem->>'price_quoted')::NUMERIC;
      v_price_system := (r.elem->>'price_system')::NUMERIC;
      IF v_price_quoted IS NULL OR v_price_quoted < 0 THEN
        v_price_quoted := COALESCE(v_price_system, 0);
      END IF;
      IF v_price_system IS NULL OR v_price_system < 0 THEN
        v_price_system := 0;
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
          'stock_location_code', v_stock_location_code
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
        stock_location_code
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
        v_line->>'stock_location_code'
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
              'stock_location_code', elem->>'stock_location_code'
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

COMMENT ON FUNCTION public.submit_sales_order(jsonb) IS
  'Sales checkout: splits by guarded location-wise availability minus reservations; creates active stock_reservations.';

GRANT EXECUTE ON FUNCTION public.submit_sales_order(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_sales_order(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_sales_order(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.create_pending_recovery_order(
  p_pending_item_ids BIGINT[],
  p_actor_user_id BIGINT DEFAULT NULL,
  p_actor_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_actor_name TEXT;
  v_salesperson_user_id BIGINT;
  v_stock_location_code TEXT;
  v_order_id BIGINT;
  v_order_number TEXT;
  v_customer_id BIGINT;
  v_customer_name TEXT;
  v_customer_city TEXT;
  v_transport_id BIGINT;
  v_transport_name TEXT;
  v_priority TEXT := 'normal';
  v_line_count INTEGER := 0;
  v_total_value NUMERIC := 0;
  v_source_orders TEXT[] := ARRAY[]::TEXT[];
  v_pending RECORD;
  v_order_row RECORD;
  v_item RECORD;
  v_busy_code NUMERIC;
  v_available_qty INTEGER;
  v_ship_qty INTEGER;
  v_remaining_qty INTEGER;
  v_price_quoted NUMERIC;
  v_price_system NUMERIC;
  v_order_item_id BIGINT;
BEGIN
  IF p_pending_item_ids IS NULL OR array_length(p_pending_item_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No pending items selected';
  END IF;

  v_actor_name := NULLIF(TRIM(COALESCE(p_actor_name, '')), '');
  IF p_actor_user_id IS NOT NULL THEN
    SELECT full_name
    INTO v_actor_name
    FROM public.users
    WHERE id = p_actor_user_id
      AND role = 'sales'
      AND is_active = true;

    IF v_actor_name IS NULL THEN
      RAISE EXCEPTION 'Invalid salesperson';
    END IF;
    v_salesperson_user_id := p_actor_user_id;
  ELSE
    v_actor_name := COALESCE(v_actor_name, 'Sales');
    SELECT id
    INTO v_salesperson_user_id
    FROM public.users
    WHERE role = 'sales'
      AND is_active = true
      AND public.normalize_salesperson_key(full_name) = public.normalize_salesperson_key(v_actor_name)
    LIMIT 1;
  END IF;

  v_stock_location_code := public.stock_location_for_user(v_salesperson_user_id, v_actor_name);

  FOR v_pending IN
    SELECT pi.*
    FROM public.pending_items pi
    WHERE pi.id = ANY(p_pending_item_ids)
    ORDER BY pi.created_at ASC, pi.id ASC
    FOR UPDATE
  LOOP
    IF v_pending.status <> 'pending' THEN
      RAISE EXCEPTION 'Pending item % is already closed', v_pending.id;
    END IF;

    IF v_pending.recovery_order_id IS NOT NULL THEN
      RAISE EXCEPTION 'Pending item % already has a recovery order', v_pending.id;
    END IF;

    IF v_pending.item_id IS NULL THEN
      RAISE EXCEPTION 'Pending item % is missing an item_id', v_pending.id;
    END IF;

    IF v_customer_name IS NULL THEN
      v_customer_id := v_pending.customer_id;
      v_customer_name := v_pending.customer_name;
    ELSIF COALESCE(v_customer_id, -1) <> COALESCE(v_pending.customer_id, -1)
      OR v_customer_name IS DISTINCT FROM v_pending.customer_name THEN
      RAISE EXCEPTION 'Selected pending items must belong to the same party';
    END IF;

    SELECT
      o.customer_city,
      o.transport_id,
      o.transport_name,
      o.priority,
      o.order_number
    INTO v_order_row
    FROM public.orders o
    WHERE o.id = v_pending.order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order % not found for pending item %', v_pending.order_id, v_pending.id;
    END IF;

    IF v_customer_city IS NULL THEN
      v_customer_city := v_order_row.customer_city;
    END IF;

    IF v_transport_id IS NULL THEN
      v_transport_id := v_order_row.transport_id;
      v_transport_name := v_order_row.transport_name;
    ELSIF COALESCE(v_transport_id, -1) <> COALESCE(v_order_row.transport_id, -1)
      OR COALESCE(v_transport_name, '') <> COALESCE(v_order_row.transport_name, '') THEN
      RAISE EXCEPTION 'Selected lines need different transport settings. Create separate billing orders.';
    END IF;

    IF v_order_row.priority = 'urgent' THEN
      v_priority := 'urgent';
    END IF;

    IF NOT (v_order_row.order_number = ANY(v_source_orders)) THEN
      v_source_orders := array_append(v_source_orders, v_order_row.order_number);
    END IF;
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
    order_kind,
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
    v_actor_name,
    v_salesperson_user_id,
    v_stock_location_code,
    'recovery',
    'submitted',
    v_priority,
    FORMAT('Recovery order for pending follow-up from %s', array_to_string(v_source_orders, ', ')),
    0,
    0
  )
  RETURNING id, order_number
  INTO v_order_id, v_order_number;

  FOR v_pending IN
    SELECT pi.*
    FROM public.pending_items pi
    WHERE pi.id = ANY(p_pending_item_ids)
    ORDER BY pi.created_at ASC, pi.id ASC
    FOR UPDATE
  LOOP
    SELECT *
    INTO v_item
    FROM public.items
    WHERE id = v_pending.item_id
    FOR UPDATE;

    SELECT
      oi.price_quoted,
      oi.price_system
    INTO v_price_quoted, v_price_system
    FROM public.order_items oi
    WHERE oi.order_id = v_pending.order_id
      AND oi.item_id = v_pending.item_id
    ORDER BY COALESCE(oi.qty_po, 0) DESC, oi.id ASC
    LIMIT 1;

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

      v_available_qty := public.guarded_locationwise_available_qty(
        v_busy_code,
        v_stock_location_code,
        0
      );
    END IF;

    v_ship_qty := LEAST(v_pending.qty_pending, v_available_qty);

    IF v_ship_qty <= 0 THEN
      RAISE EXCEPTION 'No stock is available right now for %', v_pending.item_name;
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
      v_order_id,
      v_pending.item_id,
      v_pending.item_name,
      NULLIF(v_item.alias, ''),
      NULLIF(v_item.rack_no, ''),
      v_ship_qty,
      v_ship_qty,
      0,
      v_ship_qty,
      COALESCE(v_price_quoted, v_price_system, v_item.sales_price, 0),
      COALESCE(v_price_system, v_item.sales_price, 0),
      'pending',
      v_stock_location_code
    )
    RETURNING id INTO v_order_item_id;

    IF v_busy_code IS NOT NULL THEN
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
        v_pending.item_id,
        v_busy_code,
        v_stock_location_code,
        v_ship_qty,
        'active',
        'pending_recovery',
        v_salesperson_user_id,
        v_actor_name
      );
    END IF;

    v_line_count := v_line_count + 1;
    v_total_value := v_total_value + (
      COALESCE(v_price_quoted, v_price_system, v_item.sales_price, 0) * v_ship_qty
    );

    v_remaining_qty := GREATEST(v_pending.qty_pending - v_ship_qty, 0);

    IF v_remaining_qty > 0 THEN
      UPDATE public.pending_items
      SET
        qty_pending = v_remaining_qty,
        contacted_at = NULL,
        contacted_by = NULL,
        contacted_by_user_id = NULL,
        customer_response = NULL,
        recovery_reviewed_at = NULL,
        recovery_reviewed_by = NULL,
        stock_location_code = COALESCE(stock_location_code, v_stock_location_code)
      WHERE id = v_pending.id;

      PERFORM public.recompute_pending_recovery_status(v_pending.id, false);

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
        created_at,
        note,
        status,
        recovery_status,
        contacted_at,
        contacted_by,
        contacted_by_user_id,
        customer_response,
        recovery_order_id,
        recovery_reviewed_at,
        recovery_reviewed_by,
        stock_location_code
      )
      VALUES (
        v_pending.order_id,
        v_pending.order_number,
        v_pending.customer_id,
        v_pending.customer_name,
        v_pending.item_id,
        v_pending.item_name,
        v_ship_qty,
        v_pending.source,
        COALESCE(v_pending.created_by, v_actor_name),
        v_pending.created_at,
        v_pending.note,
        'pending',
        'reviewed',
        NOW(),
        v_actor_name,
        v_salesperson_user_id,
        'confirmed',
        v_order_id,
        NOW(),
        v_actor_name,
        v_stock_location_code
      );
    ELSE
      UPDATE public.pending_items
      SET
        contacted_at = COALESCE(contacted_at, NOW()),
        contacted_by = COALESCE(contacted_by, v_actor_name),
        contacted_by_user_id = COALESCE(contacted_by_user_id, v_salesperson_user_id),
        customer_response = 'confirmed',
        recovery_order_id = v_order_id,
        recovery_status = 'reviewed',
        recovery_reviewed_at = NOW(),
        recovery_reviewed_by = v_actor_name,
        stock_location_code = COALESCE(stock_location_code, v_stock_location_code)
      WHERE id = v_pending.id;
    END IF;
  END LOOP;

  UPDATE public.orders
  SET
    item_count = v_line_count,
    total_value = v_total_value
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'item_count', v_line_count,
    'total_value', v_total_value,
    'stock_location_code', v_stock_location_code
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.create_pending_recovery_order(BIGINT[], BIGINT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.create_pending_recovery_order(BIGINT[], BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_pending_recovery_order(BIGINT[], BIGINT, TEXT) TO service_role;
