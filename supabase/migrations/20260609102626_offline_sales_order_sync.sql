-- Offline sales order replay support.
--
-- Adds an idempotent submission ledger and shortage audit rows, then extends
-- submit_sales_order(jsonb) with an opt-in offline policy:
--   shortage_policy = 'bill_available_skip_rest'
--
-- Existing callers keep the prior behavior: unavailable quantity becomes
-- qty_po and pending_items rows.

CREATE TABLE IF NOT EXISTS public.sales_order_submissions (
  id BIGSERIAL PRIMARY KEY,
  client_order_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  submission_mode TEXT NOT NULL DEFAULT 'online'
    CHECK (submission_mode IN ('online', 'offline_replay')),
  shortage_policy TEXT NOT NULL DEFAULT 'po_pending'
    CHECK (shortage_policy IN ('po_pending', 'bill_available_skip_rest')),
  salesperson_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  salesperson_name TEXT,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'submitted', 'partial', 'no_billable_lines', 'failed')),
  order_id BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sales_order_submissions_salesperson
  ON public.sales_order_submissions(salesperson_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_order_submissions_status
  ON public.sales_order_submissions(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sales_order_shortages (
  id BIGSERIAL PRIMARY KEY,
  submission_id BIGINT REFERENCES public.sales_order_submissions(id) ON DELETE SET NULL,
  client_order_key TEXT,
  order_id BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,
  customer_id BIGINT REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  salesperson_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  salesperson_name TEXT,
  item_id BIGINT REFERENCES public.items(id) ON DELETE SET NULL,
  busy_code NUMERIC,
  item_name TEXT NOT NULL,
  item_alias TEXT,
  stock_location_code TEXT,
  qty_requested INTEGER NOT NULL CHECK (qty_requested >= 0),
  qty_accepted INTEGER NOT NULL DEFAULT 0 CHECK (qty_accepted >= 0),
  qty_skipped INTEGER NOT NULL CHECK (qty_skipped > 0),
  reason TEXT NOT NULL DEFAULT 'stock_unavailable',
  is_foc BOOLEAN NOT NULL DEFAULT false,
  price_quoted NUMERIC(10,2),
  price_system NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_order_shortages_client_key
  ON public.sales_order_shortages(client_order_key);

CREATE INDEX IF NOT EXISTS idx_sales_order_shortages_order
  ON public.sales_order_shortages(order_id);

CREATE INDEX IF NOT EXISTS idx_sales_order_shortages_salesperson
  ON public.sales_order_shortages(salesperson_user_id, created_at DESC);

ALTER TABLE public.sales_order_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_shortages ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_order_submissions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_order_shortages TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sales_order_submissions_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sales_order_shortages_id_seq TO service_role;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.transports
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.set_lookup_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_set_updated_at ON public.customers;
CREATE TRIGGER trg_customers_set_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_lookup_updated_at();

DROP TRIGGER IF EXISTS trg_transports_set_updated_at ON public.transports;
CREATE TRIGGER trg_transports_set_updated_at
  BEFORE UPDATE ON public.transports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_lookup_updated_at();

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
  v_skipped INT;
  v_total_qty INT := 0;
  v_total_value NUMERIC := 0;
  v_order_id BIGINT;
  v_order_number TEXT;
  v_line JSONB;
  v_order_item_id BIGINT;
  v_client_order_key TEXT;
  v_submission_mode TEXT;
  v_shortage_policy TEXT;
  v_payload_hash TEXT;
  v_submission_id BIGINT;
  v_existing_submission public.sales_order_submissions%ROWTYPE;
  v_inserted_submission BOOLEAN := false;
  v_shortage_count INT := 0;
  v_shortage_qty INT := 0;
  v_result JSONB;
  v_status TEXT;
BEGIN
  BEGIN
    IF p_payload IS NULL OR p_payload->'lines' IS NULL OR jsonb_array_length(p_payload->'lines') = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'no_lines');
    END IF;

    v_client_order_key := NULLIF(TRIM(p_payload->>'client_order_key'), '');
    v_submission_mode := COALESCE(NULLIF(TRIM(p_payload->>'submission_mode'), ''), 'online');
    IF v_submission_mode NOT IN ('online', 'offline_replay') THEN
      v_submission_mode := 'online';
    END IF;

    v_shortage_policy := COALESCE(NULLIF(TRIM(p_payload->>'shortage_policy'), ''), 'po_pending');
    IF v_shortage_policy NOT IN ('po_pending', 'bill_available_skip_rest') THEN
      v_shortage_policy := 'po_pending';
    END IF;

    v_payload_hash := md5(p_payload::TEXT);

    IF v_client_order_key IS NOT NULL THEN
      INSERT INTO public.sales_order_submissions (
        client_order_key,
        payload_hash,
        payload,
        submission_mode,
        shortage_policy,
        status
      )
      VALUES (
        v_client_order_key,
        v_payload_hash,
        p_payload,
        v_submission_mode,
        v_shortage_policy,
        'processing'
      )
      ON CONFLICT (client_order_key) DO NOTHING
      RETURNING id INTO v_submission_id;

      v_inserted_submission := v_submission_id IS NOT NULL;

      IF NOT v_inserted_submission THEN
        SELECT *
        INTO v_existing_submission
        FROM public.sales_order_submissions
        WHERE client_order_key = v_client_order_key
        FOR UPDATE;

        IF v_existing_submission.payload_hash <> v_payload_hash THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'client_key_conflict',
            'detail', 'This offline order key was already used for a different payload.'
          );
        END IF;

        IF v_existing_submission.status <> 'processing' AND v_existing_submission.result IS NOT NULL THEN
          RETURN v_existing_submission.result;
        END IF;

        v_submission_id := v_existing_submission.id;
      END IF;
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

    IF v_submission_id IS NOT NULL THEN
      UPDATE public.sales_order_submissions
      SET
        salesperson_user_id = v_salesperson_user_id,
        salesperson_name = v_salesperson_name,
        updated_at = now()
      WHERE id = v_submission_id;
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
      IF v_shortage_policy = 'bill_available_skip_rest' THEN
        v_po := 0;
        v_skipped := v_qty - v_ship;
      ELSE
        v_po := v_qty - v_ship;
        v_skipped := 0;
      END IF;

      v_total_qty := v_total_qty + v_ship;
      v_total_value := v_total_value + (v_price_quoted * v_ship);
      IF v_skipped > 0 THEN
        v_shortage_count := v_shortage_count + 1;
        v_shortage_qty := v_shortage_qty + v_skipped;
      END IF;

      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object(
          'cart_position', r.cart_pos,
          'bill_line_no', r.cart_pos,
          'item_id', v_item_id,
          'busy_code', v_busy_code,
          'item_name', v_item.name,
          'item_alias', v_item.alias,
          'rack_no', v_item.rack_no,
          'qty_requested_original', v_qty,
          'qty_requested', CASE WHEN v_shortage_policy = 'bill_available_skip_rest' THEN v_ship ELSE v_qty END,
          'qty_shippable', v_ship,
          'qty_po', v_po,
          'qty_skipped', v_skipped,
          'price_quoted', v_price_quoted,
          'price_system', v_price_system,
          'stock_location_code', v_stock_location_code,
          'is_foc', v_is_foc
        )
      );
    END LOOP;

    IF v_shortage_policy = 'bill_available_skip_rest' AND v_total_qty <= 0 THEN
      IF v_client_order_key IS NOT NULL THEN
        FOR v_line IN
          SELECT elem FROM jsonb_array_elements(v_lines) AS e(elem)
        LOOP
          IF (v_line->>'qty_skipped')::INTEGER > 0 THEN
            INSERT INTO public.sales_order_shortages (
              submission_id,
              client_order_key,
              customer_id,
              customer_name,
              salesperson_user_id,
              salesperson_name,
              item_id,
              busy_code,
              item_name,
              item_alias,
              stock_location_code,
              qty_requested,
              qty_accepted,
              qty_skipped,
              reason,
              is_foc,
              price_quoted,
              price_system
            )
            VALUES (
              v_submission_id,
              v_client_order_key,
              v_customer_id,
              v_customer_name,
              v_salesperson_user_id,
              v_salesperson_name,
              (v_line->>'item_id')::BIGINT,
              NULLIF(v_line->>'busy_code', '')::NUMERIC,
              v_line->>'item_name',
              NULLIF(v_line->>'item_alias', ''),
              v_line->>'stock_location_code',
              (v_line->>'qty_requested_original')::INTEGER,
              0,
              (v_line->>'qty_skipped')::INTEGER,
              'stock_unavailable',
              COALESCE((v_line->>'is_foc')::BOOLEAN, false),
              (v_line->>'price_quoted')::NUMERIC,
              (v_line->>'price_system')::NUMERIC
            );
          END IF;
        END LOOP;
      END IF;

      v_result := jsonb_build_object(
        'success', true,
        'order_id', NULL,
        'order_number', NULL,
        'item_count', 0,
        'total_qty', 0,
        'total_value', 0,
        'stock_location_code', v_stock_location_code,
        'offline_outcome', 'no_billable_lines',
        'shortage_count', v_shortage_count,
        'shortage_qty', v_shortage_qty,
        'lines', COALESCE(
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'name', elem->>'item_name',
                'qty_requested', (elem->>'qty_requested_original')::INTEGER,
                'qty_ship', 0,
                'qty_po', 0,
                'qty_skipped', (elem->>'qty_skipped')::INTEGER,
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

      IF v_submission_id IS NOT NULL THEN
        UPDATE public.sales_order_submissions
        SET
          status = 'no_billable_lines',
          result = v_result,
          order_id = NULL,
          updated_at = now(),
          completed_at = now()
        WHERE id = v_submission_id;
      END IF;

      RETURN v_result;
    END IF;

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
      CASE
        WHEN v_shortage_policy = 'bill_available_skip_rest' THEN
          (
            SELECT COUNT(*)::INT
            FROM jsonb_array_elements(v_lines) AS e(elem)
            WHERE (elem->>'qty_shippable')::INTEGER > 0
          )
        ELSE v_line_count
      END,
      v_total_value
    )
    RETURNING id, order_number INTO v_order_id, v_order_number;

    FOR v_line IN
      SELECT elem FROM jsonb_array_elements(v_lines) AS e(elem)
      WHERE (elem->>'qty_requested')::INTEGER > 0
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
          CASE WHEN v_shortage_policy = 'bill_available_skip_rest' THEN 'offline_order_submit' ELSE 'order_submit' END,
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

      IF (v_line->>'qty_skipped')::INTEGER > 0 THEN
        INSERT INTO public.sales_order_shortages (
          submission_id,
          client_order_key,
          order_id,
          customer_id,
          customer_name,
          salesperson_user_id,
          salesperson_name,
          item_id,
          busy_code,
          item_name,
          item_alias,
          stock_location_code,
          qty_requested,
          qty_accepted,
          qty_skipped,
          reason,
          is_foc,
          price_quoted,
          price_system
        )
        VALUES (
          v_submission_id,
          v_client_order_key,
          v_order_id,
          v_customer_id,
          v_customer_name,
          v_salesperson_user_id,
          v_salesperson_name,
          (v_line->>'item_id')::BIGINT,
          NULLIF(v_line->>'busy_code', '')::NUMERIC,
          v_line->>'item_name',
          NULLIF(v_line->>'item_alias', ''),
          v_line->>'stock_location_code',
          (v_line->>'qty_requested_original')::INTEGER,
          (v_line->>'qty_shippable')::INTEGER,
          (v_line->>'qty_skipped')::INTEGER,
          'stock_unavailable',
          COALESCE((v_line->>'is_foc')::BOOLEAN, false),
          (v_line->>'price_quoted')::NUMERIC,
          (v_line->>'price_system')::NUMERIC
        );
      END IF;
    END LOOP;

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

    v_status := CASE
      WHEN v_shortage_policy = 'bill_available_skip_rest' AND v_shortage_count > 0 THEN 'partial'
      ELSE 'submitted'
    END;

    v_result := jsonb_build_object(
      'success', true,
      'order_id', v_order_id,
      'order_number', v_order_number,
      'item_count', CASE
        WHEN v_shortage_policy = 'bill_available_skip_rest' THEN
          (
            SELECT COUNT(*)::INT
            FROM jsonb_array_elements(v_lines) AS e(elem)
            WHERE (elem->>'qty_shippable')::INTEGER > 0
          )
        ELSE v_line_count
      END,
      'total_qty', v_total_qty,
      'total_value', v_total_value,
      'stock_location_code', v_stock_location_code,
      'offline_outcome', v_status,
      'shortage_count', v_shortage_count,
      'shortage_qty', v_shortage_qty,
      'lines', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'name', elem->>'item_name',
              'qty_requested', (elem->>'qty_requested_original')::INTEGER,
              'qty_ship', (elem->>'qty_shippable')::INTEGER,
              'qty_po', (elem->>'qty_po')::INTEGER,
              'qty_skipped', (elem->>'qty_skipped')::INTEGER,
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

    IF v_submission_id IS NOT NULL THEN
      UPDATE public.sales_order_submissions
      SET
        status = v_status,
        order_id = v_order_id,
        result = v_result,
        updated_at = now(),
        completed_at = now()
      WHERE id = v_submission_id;
    END IF;

    RETURN v_result;
  EXCEPTION
    WHEN OTHERS THEN
      IF v_submission_id IS NOT NULL THEN
        UPDATE public.sales_order_submissions
        SET
          status = 'failed',
          error = SQLERRM,
          result = jsonb_build_object('success', false, 'error', 'submit_failed', 'detail', SQLERRM),
          updated_at = now(),
          completed_at = now()
        WHERE id = v_submission_id;
      END IF;

      RETURN jsonb_build_object(
        'success', false,
        'error', 'submit_failed',
        'detail', SQLERRM
      );
  END;
END;
$func$;

COMMENT ON FUNCTION public.submit_sales_order(jsonb) IS
  'Sales checkout with optional offline replay idempotency. Default unavailable qty becomes PO; bill_available_skip_rest records shortages instead.';

GRANT EXECUTE ON FUNCTION public.submit_sales_order(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_sales_order(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_sales_order(jsonb) TO service_role;
