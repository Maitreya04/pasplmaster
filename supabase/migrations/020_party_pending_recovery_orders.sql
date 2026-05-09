-- ============================================================
-- PASPL Master — Party-wise pending recovery follow-up
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_kind TEXT;

UPDATE public.orders
SET order_kind = 'standard'
WHERE order_kind IS NULL;

ALTER TABLE public.orders
  ALTER COLUMN order_kind SET DEFAULT 'standard';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_order_kind_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_order_kind_check
      CHECK (order_kind IN ('standard', 'recovery'));
  END IF;
END
$$;

ALTER TABLE public.pending_items
  ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contacted_by TEXT,
  ADD COLUMN IF NOT EXISTS contacted_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_response TEXT,
  ADD COLUMN IF NOT EXISTS recovery_order_id BIGINT REFERENCES public.orders(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.pending_items'::regclass
      AND conname = 'pending_items_customer_response_check'
  ) THEN
    ALTER TABLE public.pending_items
      ADD CONSTRAINT pending_items_customer_response_check
      CHECK (customer_response IS NULL OR customer_response IN ('confirmed', 'not_now', 'declined'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_orders_order_kind
  ON public.orders(order_kind);

CREATE INDEX IF NOT EXISTS idx_pending_items_contacted_at
  ON public.pending_items(contacted_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pending_items_customer_response
  ON public.pending_items(customer_response)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pending_items_recovery_order
  ON public.pending_items(recovery_order_id);

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
  v_ship_qty INTEGER;
  v_remaining_qty INTEGER;
  v_price_quoted NUMERIC;
  v_price_system NUMERIC;
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

    v_ship_qty := LEAST(
      v_pending.qty_pending,
      GREATEST(FLOOR(COALESCE(v_item.stock_qty, 0))::INTEGER, 0)
    );

    IF v_ship_qty <= 0 THEN
      RAISE EXCEPTION 'No stock is available right now for %', v_pending.item_name;
    END IF;

    UPDATE public.items
    SET stock_qty = COALESCE(stock_qty, 0) - v_ship_qty::NUMERIC,
        updated_at = NOW()
    WHERE id = v_pending.item_id;

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
      state
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
      'pending'
    );

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
        recovery_reviewed_by = NULL
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
        recovery_reviewed_by
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
        v_actor_name
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
        recovery_reviewed_by = v_actor_name
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
    'total_value', v_total_value
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.create_pending_recovery_order(BIGINT[], BIGINT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.create_pending_recovery_order(BIGINT[], BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_pending_recovery_order(BIGINT[], BIGINT, TEXT) TO service_role;
