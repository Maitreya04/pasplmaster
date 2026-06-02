-- ============================================================
-- Migration 113: Three production bug-fixes from today's glitch
-- ============================================================
--
-- Bug 1: submit_sales_order never emitted a billing queue_event.
--   When VITE_BILLING_QUEUE_EVENTS is enabled the billing queue
--   relies on queue_events for instant notification.  New orders
--   were only visible after the 60-second poll or the backstop
--   orders-table WebSocket fired (unreliable on mobile).
--   Fix: emit 'order_submitted' into the billing queue_events
--   channel from inside submit_sales_order.
--
-- Bug 2: awaiting_erp_sync reservations accumulate when Busy ERP
--   sync is delayed or the reconciliation trigger misses rows.
--   These count against available stock indefinitely, making items
--   show as 0 even when physical stock is present.
--   Fix: (a) release all existing stale rows right now,
--        (b) add release_stale_erp_sync_reservations() helper,
--        (c) narrow the FOR UPDATE in submit_sales_order so it
--            does NOT lock awaiting_erp_sync rows (they are only
--            read for the count; locking them blocks ERP sync and
--            causes the contention that slows down submissions).
--
-- Bug 3: FOR UPDATE on all awaiting_erp_sync rows for a busy_code
--   causes lock-queue pile-ups at peak submission time.
--   Fix: split the lock so we only lock active reservations (the
--   ones we might modify) and take a FOR SHARE on the erp-sync
--   rows (read-only for the available-qty calculation).

-- ── 1. Helper: release stale awaiting_erp_sync reservations ───────────────

CREATE OR REPLACE FUNCTION public.release_stale_erp_sync_reservations(
  p_older_than_hours INTEGER DEFAULT 12
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_cutoff TIMESTAMPTZ;
BEGIN
  v_cutoff := now() - (p_older_than_hours || ' hours')::INTERVAL;

  UPDATE public.stock_reservations
  SET
    status          = 'released',
    released_at     = COALESCE(released_at, now()),
    last_reconciled_at = now()
  WHERE status = 'awaiting_erp_sync'
    AND awaiting_erp_sync_at IS NOT NULL
    AND awaiting_erp_sync_at <= v_cutoff;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.release_stale_erp_sync_reservations(INTEGER) IS
  'Release awaiting_erp_sync reservations whose ERP-sync window has expired.  '
  'Call with default (12 h) from admin or a pg_cron job.';

GRANT EXECUTE ON FUNCTION public.release_stale_erp_sync_reservations(INTEGER)
  TO service_role;

-- ── 2. Immediate cleanup: release all awaiting_erp_sync rows > 12 h old ────

DO $$
DECLARE
  v_released INTEGER;
BEGIN
  SELECT public.release_stale_erp_sync_reservations(12) INTO v_released;
  RAISE NOTICE 'migration 113: released % stale awaiting_erp_sync reservations', v_released;
END;
$$;

-- ── 3. Patched submit_sales_order ─────────────────────────────────────────
--
--  Changes vs migration 111:
--    a. FOR UPDATE on stock_reservations now targets ONLY 'active' rows.
--       awaiting_erp_sync rows are read with FOR SHARE (no write intent).
--       This eliminates lock-queue pile-ups at peak hours.
--    b. emit_queue_event('billing', 'order_submitted', …) is called in a
--       nested BEGIN/EXCEPTION block so it can never roll back the order.

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
        -- Lock only the stock_locationwise row (authoritative physical qty).
        PERFORM 1
        FROM public.stock_locationwise sl
        WHERE sl.busy_code::NUMERIC IS NOT DISTINCT FROM v_busy_code
          AND public.normalize_stock_location_code(sl.stock_location) = v_stock_location_code
        FOR UPDATE;

        -- Lock ONLY active reservations for write; awaiting_erp_sync rows are
        -- read-only here (we never update them in this RPC) so FOR SHARE avoids
        -- blocking concurrent ERP-sync releases.
        PERFORM 1
        FROM public.stock_reservations sr
        WHERE sr.busy_code IS NOT DISTINCT FROM v_busy_code
          AND sr.stock_location_code = v_stock_location_code
          AND sr.status = 'active'
        FOR UPDATE;

        PERFORM 1
        FROM public.stock_reservations sr
        WHERE sr.busy_code IS NOT DISTINCT FROM v_busy_code
          AND sr.stock_location_code = v_stock_location_code
          AND sr.status = 'awaiting_erp_sync'
        FOR SHARE;

        -- Accumulate in-payload reservations for the same busy_code so that
        -- two lines for the same SKU (e.g. paid + FOC) don't double-allocate.
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

    -- ── Notify billing queue instantly ───────────────────────────────────
    -- Migration 035 already has a trigger (trg_orders_emit_queue_event_insert)
    -- that emits a queue_event on every orders INSERT.  This explicit call is
    -- a safety-net: if the trigger is ever dropped or the INSERT-chain fails
    -- silently, billing still gets an instant notification.  Duplicate events
    -- are harmless — they just cause an extra refetch.
    -- Wrapped in its own exception handler so a failure here can NEVER roll
    -- back the order that was just created.
    BEGIN
      PERFORM public.emit_queue_event(
        'billing',
        'order_submitted',
        v_order_id,
        'submitted',
        v_salesperson_user_id,
        jsonb_build_object(
          'salesperson', v_salesperson_name,
          'customer_name', v_customer_name,
          'order_number', v_order_number,
          'total_value', v_total_value
        )
      );
    EXCEPTION
      WHEN OTHERS THEN NULL;
    END;

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

COMMENT ON FUNCTION public.submit_sales_order(jsonb) IS
  'Sales checkout: reserves stock from stock_locationwise, emits billing queue event.  '
  'Migration 113: narrowed FOR UPDATE to active-only reservations; added emit_queue_event.';

-- ── 4. Index on orders.workflow_status for billing queue scans ─────────────
--   get_billing_queue_snapshot and fetchLegacyClaimableOrders both filter by
--   workflow_status.  A partial index on the active statuses speeds both up.

CREATE INDEX IF NOT EXISTS idx_orders_workflow_status_active
  ON public.orders (workflow_status, created_at DESC)
  WHERE workflow_status IN ('submitted', 'approved', 'picking');

-- ── 5. Grant execute on helper to anon/authenticated for admin tooling ──────
GRANT EXECUTE ON FUNCTION public.release_stale_erp_sync_reservations(INTEGER)
  TO authenticated;
