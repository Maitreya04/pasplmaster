-- Sales unit of selling (kit/set/piece) — distinct from items.selling_unit (piece/packet/box for scan/pick).
-- qty_requested on order_items = qty in sales unit; ship/PO/reservations use EA (qty * ea_multiplier).

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS sales_selling_units JSONB;

COMMENT ON COLUMN public.items.sales_selling_units IS
  'JSON array of { id, label, busy_unit, ea_multiplier } for sales entry and Busy paste. Empty/null => implicit unit.';

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS sales_selling_unit TEXT;

UPDATE public.order_items
SET sales_selling_unit = 'unit'
WHERE sales_selling_unit IS NULL;

ALTER TABLE public.order_items
  ALTER COLUMN sales_selling_unit SET NOT NULL;

ALTER TABLE public.order_items
  ALTER COLUMN sales_selling_unit SET DEFAULT 'unit';

COMMENT ON COLUMN public.order_items.sales_selling_unit IS
  'Sales-facing unit id (kit/set/piece/unit) chosen at order entry; qty_requested is in this unit.';

-- Resolve ea_multiplier from items.sales_selling_units JSON for a unit id.
CREATE OR REPLACE FUNCTION public.sales_unit_ea_multiplier(
  p_sales_selling_units JSONB,
  p_unit_id TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_unit TEXT;
  v_elem JSONB;
  v_mult NUMERIC;
BEGIN
  v_unit := COALESCE(NULLIF(TRIM(p_unit_id), ''), 'unit');
  IF v_unit = 'unit' THEN
    RETURN 1;
  END IF;
  IF p_sales_selling_units IS NULL OR jsonb_typeof(p_sales_selling_units) <> 'array' THEN
    RETURN 1;
  END IF;
  FOR v_elem IN SELECT elem FROM jsonb_array_elements(p_sales_selling_units) AS e(elem)
  LOOP
    IF NULLIF(TRIM(v_elem->>'id'), '') = v_unit THEN
      v_mult := NULLIF(TRIM(v_elem->>'ea_multiplier'), '')::NUMERIC;
      IF v_mult IS NOT NULL AND v_mult > 0 THEN
        RETURN v_mult;
      END IF;
      RETURN 1;
    END IF;
  END LOOP;
  RETURN 1;
END;
$$;

COMMENT ON FUNCTION public.sales_unit_ea_multiplier(JSONB, TEXT) IS
  'EA pieces per one sales unit (e.g. set=4). Default 1 for unit or unknown id.';

-- submit_sales_order: persist sales_selling_unit; split stock using EA qty.
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
  v_qty_ea INT;
  v_sales_unit TEXT;
  v_ea_mult NUMERIC;
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

      v_sales_unit := COALESCE(NULLIF(TRIM(r.elem->>'sales_selling_unit'), ''), 'unit');
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

      v_ea_mult := public.sales_unit_ea_multiplier(v_item.sales_selling_units, v_sales_unit);
      v_qty_ea := GREATEST(1, CEIL(v_qty::NUMERIC * v_ea_mult)::INTEGER);

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

      v_ship := LEAST(v_qty_ea, v_available_qty);
      v_po := v_qty_ea - v_ship;

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
          'sales_selling_unit', v_sales_unit,
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
        bill_line_no,
        sales_selling_unit
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
        (v_line->>'bill_line_no')::INTEGER,
        COALESCE(NULLIF(v_line->>'sales_selling_unit', ''), 'unit')
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
              'sales_selling_unit', elem->>'sales_selling_unit',
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

-- add_sales_submitted_line: sales unit + EA split
DROP FUNCTION IF EXISTS public.add_sales_submitted_line(
  BIGINT, BIGINT, INTEGER, NUMERIC, BIGINT, BIGINT, BOOLEAN
);

CREATE OR REPLACE FUNCTION public.add_sales_submitted_line(
  p_order_id BIGINT,
  p_item_id BIGINT,
  p_qty INTEGER,
  p_price_quoted NUMERIC,
  p_claim_id BIGINT,
  p_user_id BIGINT,
  p_is_foc BOOLEAN DEFAULT false,
  p_sales_selling_unit TEXT DEFAULT 'unit'
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
  v_qty_ea INTEGER;
  v_ea_mult NUMERIC;
  v_sales_unit TEXT;
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

  v_sales_unit := COALESCE(NULLIF(TRIM(p_sales_selling_unit), ''), 'unit');

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

  v_ea_mult := public.sales_unit_ea_multiplier(v_item.sales_selling_units, v_sales_unit);
  v_qty_ea := GREATEST(1, CEIL(p_qty::NUMERIC * v_ea_mult)::INTEGER);

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

  v_ship := LEAST(v_qty_ea, v_available_qty);
  v_po := v_qty_ea - v_ship;

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
    bill_line_no,
    sales_selling_unit
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
    v_bill_line_no,
    v_sales_unit
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
      'sales_selling_unit', v_sales_unit,
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
    'qty_po', v_po,
    'sales_selling_unit', v_sales_unit
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

GRANT EXECUTE ON FUNCTION public.sales_unit_ea_multiplier(JSONB, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_sales_order(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_sales_submitted_line(
  BIGINT, BIGINT, INTEGER, NUMERIC, BIGINT, BIGINT, BOOLEAN, TEXT
) TO anon, authenticated, service_role;
