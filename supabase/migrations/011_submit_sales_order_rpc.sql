-- Atomic sales checkout: lock item rows, split ship vs PO from live stock, decrement stock,
-- insert order + order_items + pending_items in one transaction (prevents two reps overselling).

CREATE OR REPLACE FUNCTION public.submit_sales_order(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_customer_id bigint;
  v_customer_name text;
  v_customer_city text;
  v_transport_id bigint;
  v_transport_name text;
  v_salesperson_name text;
  v_priority text;
  v_notes text;
  v_line_count int;
  v_matched_lines int;
  v_lines jsonb := '[]'::jsonb;
  r record;
  v_item_id bigint;
  v_qty int;
  v_price_quoted numeric;
  v_price_system numeric;
  v_item items%ROWTYPE;
  v_ship int;
  v_po int;
  v_stock numeric;
  v_billing_count int := 0;
  v_billing_total numeric := 0;
  v_order_id bigint;
  v_order_number text;
  v_line jsonb;
BEGIN
  BEGIN
    IF p_payload IS NULL OR p_payload->'lines' IS NULL OR jsonb_array_length(p_payload->'lines') = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'no_lines');
    END IF;

    v_customer_id := NULLIF(TRIM(p_payload->>'customer_id'), '')::bigint;
    v_customer_name := NULLIF(TRIM(p_payload->>'customer_name'), '');
    IF v_customer_id IS NULL OR v_customer_name IS NULL OR length(trim(v_customer_name)) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_customer');
    END IF;

    v_customer_city := NULLIF(TRIM(p_payload->>'customer_city'), '');
    v_transport_id := NULLIF(TRIM(p_payload->>'transport_id'), '')::bigint;
    v_transport_name := NULLIF(TRIM(p_payload->>'transport_name'), '');
    v_salesperson_name := coalesce(nullif(trim(p_payload->>'salesperson_name'), ''), 'Unknown');
    v_priority := coalesce(nullif(trim(p_payload->>'priority'), ''), 'normal');
    IF v_priority NOT IN ('normal', 'urgent') THEN
      v_priority := 'normal';
    END IF;
    v_notes := nullif(trim(p_payload->>'notes'), '');

    SELECT count(*)::int INTO v_line_count
    FROM jsonb_array_elements(p_payload->'lines') AS elem;

    SELECT count(*)::int INTO v_matched_lines
    FROM jsonb_array_elements(p_payload->'lines') AS elem
    JOIN items i ON i.id = (elem->>'item_id')::bigint;

    IF v_matched_lines <> v_line_count THEN
      RETURN jsonb_build_object('success', false, 'error', 'unknown_item');
    END IF;

    FOR r IN
      SELECT elem, ordinality AS cart_pos
      FROM jsonb_array_elements(p_payload->'lines') WITH ORDINALITY AS t(elem, ordinality)
      ORDER BY (elem->>'item_id')::bigint, ordinality
    LOOP
      v_item_id := (r.elem->>'item_id')::bigint;
      v_qty := (r.elem->>'qty_requested')::integer;
      IF v_qty IS NULL OR v_qty < 1 THEN
        RAISE EXCEPTION 'invalid_qty';
      END IF;

      v_price_quoted := (r.elem->>'price_quoted')::numeric;
      v_price_system := (r.elem->>'price_system')::numeric;
      IF v_price_quoted IS NULL OR v_price_quoted < 0 THEN
        v_price_quoted := coalesce(v_price_system, 0);
      END IF;
      IF v_price_system IS NULL OR v_price_system < 0 THEN
        v_price_system := 0;
      END IF;

      SELECT * INTO v_item FROM items WHERE id = v_item_id FOR UPDATE;

      v_stock := v_item.stock_qty;
      IF v_stock IS NULL THEN
        v_ship := v_qty;
      ELSIF v_stock <= 0 THEN
        v_ship := 0;
      ELSE
        v_ship := least(v_qty, floor(greatest(v_stock, 0))::integer);
      END IF;
      v_po := v_qty - v_ship;

      IF v_stock IS NOT NULL THEN
        UPDATE items
        SET stock_qty = stock_qty - (v_ship::numeric),
            updated_at = now()
        WHERE id = v_item_id;
      END IF;

      v_billing_count := v_billing_count + v_ship;
      v_billing_total := v_billing_total + (v_price_quoted * v_ship);

      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'cart_position', r.cart_pos,
          'item_id', v_item_id,
          'item_name', v_item.name,
          'item_alias', v_item.alias,
          'rack_no', v_item.rack_no,
          'qty_requested', v_qty,
          'qty_shippable', v_ship,
          'qty_po', v_po,
          'price_quoted', v_price_quoted,
          'price_system', v_price_system
        )
      );
    END LOOP;

    INSERT INTO orders (
      customer_id,
      customer_name,
      customer_city,
      transport_id,
      transport_name,
      salesperson_name,
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
      'submitted',
      v_priority,
      v_notes,
      v_billing_count,
      v_billing_total
    )
    RETURNING id, order_number INTO v_order_id, v_order_number;

    FOR v_line IN
      SELECT elem FROM jsonb_array_elements(v_lines) AS e(elem)
      ORDER BY (elem->>'cart_position')::integer
    LOOP
      INSERT INTO order_items (
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
        state
      )
      VALUES (
        v_order_id,
        (v_line->>'item_id')::bigint,
        v_line->>'item_name',
        NULLIF(v_line->>'item_alias', ''),
        NULLIF(v_line->>'rack_no', ''),
        (v_line->>'qty_requested')::integer,
        (v_line->>'qty_shippable')::integer,
        (v_line->>'qty_po')::integer,
        (v_line->>'qty_shippable')::integer,
        (v_line->>'price_quoted')::numeric,
        (v_line->>'price_system')::numeric,
        'pending'
      );
    END LOOP;

    FOR v_line IN
      SELECT elem FROM jsonb_array_elements(v_lines) AS e(elem)
    LOOP
      IF (v_line->>'qty_po')::integer > 0 THEN
        INSERT INTO pending_items (
          order_id,
          order_number,
          customer_id,
          customer_name,
          item_id,
          item_name,
          qty_pending,
          source,
          created_by,
          note
        )
        VALUES (
          v_order_id,
          v_order_number,
          v_customer_id,
          v_customer_name,
          (v_line->>'item_id')::bigint,
          v_line->>'item_name',
          (v_line->>'qty_po')::integer,
          'sales',
          v_salesperson_name,
          'Purchase order qty from sales checkout'
        );
      END IF;
    END LOOP;

    RETURN jsonb_build_object(
      'success', true,
      'order_id', v_order_id,
      'order_number', v_order_number,
      'item_count', v_billing_count,
      'total_value', v_billing_total,
      'lines', coalesce(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'name', elem->>'item_name',
              'qty_requested', (elem->>'qty_requested')::integer,
              'qty_ship', (elem->>'qty_shippable')::integer,
              'qty_po', (elem->>'qty_po')::integer
            )
            ORDER BY (elem->>'cart_position')::integer
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
  'Sales checkout: FOR UPDATE items, decrement stock by shippable qty, insert order + lines + pending PO rows atomically.';

GRANT EXECUTE ON FUNCTION public.submit_sales_order(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_sales_order(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_sales_order(jsonb) TO service_role;
