-- PASPL Master - location-wise stock availability + app reservations
--
-- Busy/MSSQL remains the physical stock snapshot in stock_locationwise.
-- The app creates reservations for submitted orders so visible availability is:
--   physical stock_locationwise stock - active/awaiting app reservations.

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS busy_code NUMERIC;

CREATE INDEX IF NOT EXISTS idx_items_busy_code
  ON public.items (busy_code)
  WHERE busy_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.stock_locationwise (
  busy_code BIGINT NOT NULL,
  stock_location TEXT NOT NULL,
  stock_qty NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (busy_code, stock_location)
);

GRANT SELECT, INSERT, UPDATE ON public.stock_locationwise TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.normalize_stock_location_code(p_location TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(trim(coalesce(p_location, '')))
    WHEN 'main store' THEN 'main_store'
    WHEN 'mainstore' THEN 'main_store'
    WHEN 'indore' THEN 'main_store'
    WHEN 'jbp' THEN 'jabalpur'
    WHEN 'jbl' THEN 'jabalpur'
    WHEN 'jabalpur' THEN 'jabalpur'
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.stock_location_label(p_stock_location_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_stock_location_code
    WHEN 'main_store' THEN 'Main Store'
    WHEN 'jabalpur' THEN 'Jabalpur'
    ELSE NULL
  END
$$;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS stock_location_code TEXT NOT NULL DEFAULT 'main_store';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_stock_location_code_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_stock_location_code_check
      CHECK (stock_location_code IN ('main_store', 'jabalpur'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_users_stock_location_code
  ON public.users(stock_location_code)
  WHERE is_active = true;

UPDATE public.users
SET stock_location_code = 'main_store'
WHERE stock_location_code IS NULL;

UPDATE public.users
SET stock_location_code = 'jabalpur'
WHERE public.normalize_salesperson_key(full_name) IN ('hardeep', 'awasthi', 'manish')
  OR lower(regexp_replace(coalesce(trim(full_name), ''), '[^a-z0-9]+', '', 'g')) IN ('shashank', 'shahank');

UPDATE public.users
SET stock_location_code = 'main_store'
WHERE role IN ('billing', 'picking')
  OR public.normalize_salesperson_key(full_name) IN (
    'rehan',
    'shriramsharma',
    'mahendrarajput',
    'sachinrao',
    'pankaj',
    'pankajmeena',
    'raju',
    'hemant',
    'guddu',
    'mankar',
    'asad',
    'kamlakar',
    'neeraj',
    'satish',
    'direct'
  );

INSERT INTO public.users (full_name, role, is_active, stock_location_code)
VALUES ('Harsh', 'picking', true, 'main_store')
ON CONFLICT (full_name) DO UPDATE
SET role = 'picking',
    is_active = true,
    stock_location_code = 'main_store';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stock_location_code TEXT;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS stock_location_code TEXT;

ALTER TABLE public.pending_items
  ADD COLUMN IF NOT EXISTS stock_location_code TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_stock_location_code_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_stock_location_code_check
      CHECK (stock_location_code IS NULL OR stock_location_code IN ('main_store', 'jabalpur'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.order_items'::regclass
      AND conname = 'order_items_stock_location_code_check'
  ) THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_stock_location_code_check
      CHECK (stock_location_code IS NULL OR stock_location_code IN ('main_store', 'jabalpur'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.pending_items'::regclass
      AND conname = 'pending_items_stock_location_code_check'
  ) THEN
    ALTER TABLE public.pending_items
      ADD CONSTRAINT pending_items_stock_location_code_check
      CHECK (stock_location_code IS NULL OR stock_location_code IN ('main_store', 'jabalpur'));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.stock_reservations (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id BIGINT REFERENCES public.order_items(id) ON DELETE CASCADE,
  item_id BIGINT REFERENCES public.items(id) ON DELETE SET NULL,
  busy_code NUMERIC NOT NULL,
  stock_location_code TEXT NOT NULL CHECK (stock_location_code IN ('main_store', 'jabalpur')),
  qty_reserved INTEGER NOT NULL CHECK (qty_reserved >= 0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'awaiting_erp_sync', 'released', 'cancelled')),
  source TEXT NOT NULL DEFAULT 'order_submit',
  created_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_by TEXT,
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  awaiting_erp_sync_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  last_reconciled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stock_reservations_availability
  ON public.stock_reservations(busy_code, stock_location_code, status)
  WHERE status IN ('active', 'awaiting_erp_sync');

CREATE INDEX IF NOT EXISTS idx_stock_reservations_order
  ON public.stock_reservations(order_id);

CREATE INDEX IF NOT EXISTS idx_stock_reservations_order_item
  ON public.stock_reservations(order_item_id);

GRANT SELECT, INSERT, UPDATE ON public.stock_reservations TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.stock_reservations_id_seq TO anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.locationwise_stock_available AS
WITH physical AS (
  SELECT
    sl.busy_code::NUMERIC AS busy_code,
    public.normalize_stock_location_code(sl.stock_location) AS stock_location_code,
    SUM(COALESCE(sl.stock_qty, 0))::NUMERIC AS physical_qty,
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
)
SELECT
  p.busy_code,
  p.stock_location_code,
  public.stock_location_label(p.stock_location_code) AS stock_location_label,
  p.physical_qty,
  COALESCE(r.reserved_qty, 0)::NUMERIC AS reserved_qty,
  GREATEST(p.physical_qty - COALESCE(r.reserved_qty, 0), 0)::NUMERIC AS available_qty,
  p.latest_stock_updated_at
FROM physical p
LEFT JOIN reserved r
  ON r.busy_code IS NOT DISTINCT FROM p.busy_code
 AND r.stock_location_code = p.stock_location_code;

GRANT SELECT ON public.locationwise_stock_available TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.touch_stock_locationwise_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := COALESCE(NEW.updated_at, now());
  ELSIF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_locationwise_touch_updated_at ON public.stock_locationwise;

CREATE TRIGGER trg_stock_locationwise_touch_updated_at
  BEFORE INSERT OR UPDATE ON public.stock_locationwise
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_stock_locationwise_updated_at();

CREATE OR REPLACE FUNCTION public.reconcile_stock_reservations_after_stock_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock_location_code TEXT;
  v_sync_at TIMESTAMPTZ;
BEGIN
  v_stock_location_code := public.normalize_stock_location_code(NEW.stock_location);
  IF v_stock_location_code IS NULL THEN
    RETURN NEW;
  END IF;

  v_sync_at := COALESCE(NEW.updated_at, now());

  UPDATE public.stock_reservations sr
  SET status = 'released',
      released_at = COALESCE(sr.released_at, v_sync_at),
      last_reconciled_at = now()
  WHERE sr.busy_code IS NOT DISTINCT FROM NEW.busy_code::NUMERIC
    AND sr.stock_location_code = v_stock_location_code
    AND sr.status = 'awaiting_erp_sync'
    AND sr.awaiting_erp_sync_at IS NOT NULL
    AND sr.awaiting_erp_sync_at <= v_sync_at;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_locationwise_reconcile_reservations ON public.stock_locationwise;

CREATE TRIGGER trg_stock_locationwise_reconcile_reservations
  AFTER INSERT OR UPDATE ON public.stock_locationwise
  FOR EACH ROW
  EXECUTE FUNCTION public.reconcile_stock_reservations_after_stock_sync();

CREATE OR REPLACE FUNCTION public.stock_location_for_user(
  p_user_id BIGINT,
  p_user_name TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock_location_code TEXT;
BEGIN
  IF p_user_id IS NOT NULL THEN
    SELECT u.stock_location_code
    INTO v_stock_location_code
    FROM public.users u
    WHERE u.id = p_user_id
      AND u.is_active = true;
  END IF;

  IF v_stock_location_code IS NULL AND NULLIF(trim(COALESCE(p_user_name, '')), '') IS NOT NULL THEN
    SELECT u.stock_location_code
    INTO v_stock_location_code
    FROM public.users u
    WHERE u.is_active = true
      AND public.normalize_salesperson_key(u.full_name) = public.normalize_salesperson_key(p_user_name)
    ORDER BY CASE WHEN u.role = 'sales' THEN 0 ELSE 1 END, u.id
    LIMIT 1;
  END IF;

  RETURN COALESCE(v_stock_location_code, 'main_store');
END;
$$;

CREATE OR REPLACE FUNCTION public.fill_pending_item_stock_location()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.stock_location_code IS NULL AND NEW.order_id IS NOT NULL THEN
    SELECT o.stock_location_code
    INTO NEW.stock_location_code
    FROM public.orders o
    WHERE o.id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pending_items_fill_stock_location ON public.pending_items;

CREATE TRIGGER trg_pending_items_fill_stock_location
  BEFORE INSERT OR UPDATE OF order_id, stock_location_code ON public.pending_items
  FOR EACH ROW
  EXECUTE FUNCTION public.fill_pending_item_stock_location();

CREATE OR REPLACE FUNCTION public.cancel_active_stock_reservations_for_order(p_order_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  UPDATE public.stock_reservations
  SET status = 'cancelled',
      cancelled_at = COALESCE(cancelled_at, now()),
      last_reconciled_at = now()
  WHERE order_id = p_order_id
    AND status = 'active';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_active_stock_reservations_for_order(BIGINT) TO anon;
GRANT EXECUTE ON FUNCTION public.cancel_active_stock_reservations_for_order(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_active_stock_reservations_for_order(BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.cancel_stock_reservations_on_order_reject()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.workflow_status = 'rejected'
     AND COALESCE(OLD.workflow_status, '') IS DISTINCT FROM NEW.workflow_status THEN
    PERFORM public.cancel_active_stock_reservations_for_order(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_cancel_stock_reservations ON public.orders;

CREATE TRIGGER trg_orders_cancel_stock_reservations
  AFTER UPDATE OF workflow_status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.cancel_stock_reservations_on_order_reject();

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
  v_physical_qty NUMERIC;
  v_reserved_qty NUMERIC;
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

        SELECT COALESCE(SUM((elem->>'qty_shippable')::INTEGER), 0)
        INTO v_payload_reserved_qty
        FROM jsonb_array_elements(v_lines) AS e(elem)
        WHERE NULLIF(elem->>'busy_code', '')::NUMERIC IS NOT DISTINCT FROM v_busy_code
          AND elem->>'stock_location_code' = v_stock_location_code;

        v_available_qty := FLOOR(
          GREATEST(
            COALESCE(v_physical_qty, 0)
              - COALESCE(v_reserved_qty, 0)
              - COALESCE(v_payload_reserved_qty, 0),
            0
          )
        )::INT;
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
  'Sales checkout: splits by user stock location using stock_locationwise minus reservations; creates active stock_reservations.';

GRANT EXECUTE ON FUNCTION public.submit_sales_order(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_sales_order(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_sales_order(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_billing(
  p_order_id BIGINT,
  p_claim_id BIGINT,
  p_user_id BIGINT,
  p_is_resolving_flags BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim RECORD;
  v_user_name TEXT;
BEGIN
  SELECT id, order_id, stage, claimed_by_user_id
  INTO v_claim
  FROM public.work_claims
  WHERE id = p_claim_id
    AND order_id = p_order_id
    AND stage = 'billing'
    AND claimed_by_user_id = p_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'No active billing claim found');
  END IF;

  SELECT full_name INTO v_user_name FROM public.users WHERE id = p_user_id;

  UPDATE public.work_claims
  SET status = 'completed',
      completed_at = now()
  WHERE id = p_claim_id;

  UPDATE public.stock_reservations sr
  SET qty_reserved = GREATEST(COALESCE(oi.qty_approved, oi.qty_shippable, 0), 0),
      status = CASE
        WHEN GREATEST(COALESCE(oi.qty_approved, oi.qty_shippable, 0), 0) > 0 THEN 'awaiting_erp_sync'
        ELSE 'released'
      END,
      awaiting_erp_sync_at = CASE
        WHEN GREATEST(COALESCE(oi.qty_approved, oi.qty_shippable, 0), 0) > 0 THEN now()
        ELSE sr.awaiting_erp_sync_at
      END,
      released_at = CASE
        WHEN GREATEST(COALESCE(oi.qty_approved, oi.qty_shippable, 0), 0) > 0 THEN sr.released_at
        ELSE COALESCE(sr.released_at, now())
      END,
      last_reconciled_at = now()
  FROM public.order_items oi
  WHERE sr.order_item_id = oi.id
    AND sr.order_id = p_order_id
    AND sr.status = 'active';

  IF p_is_resolving_flags THEN
    UPDATE public.orders
    SET workflow_status = 'completed',
        reviewer_name = v_user_name,
        priority = 'normal'
    WHERE id = p_order_id;

    INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
    VALUES (p_order_id, 'billing_flags_resolved', p_user_id, 'billing',
            jsonb_build_object('reviewer', v_user_name));
  ELSE
    UPDATE public.orders
    SET workflow_status = 'approved',
        reviewer_name = v_user_name,
        approved_at = COALESCE(approved_at, now())
    WHERE id = p_order_id;

    INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
    VALUES (p_order_id, 'billing_approved', p_user_id, 'billing',
            jsonb_build_object('reviewer', v_user_name));
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_billing(BIGINT, BIGINT, BIGINT, BOOLEAN) TO anon;
GRANT EXECUTE ON FUNCTION public.complete_billing(BIGINT, BIGINT, BIGINT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_billing(BIGINT, BIGINT, BIGINT, BOOLEAN) TO service_role;

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
  v_physical_qty NUMERIC;
  v_reserved_qty NUMERIC;
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

      v_available_qty := FLOOR(GREATEST(COALESCE(v_physical_qty, 0) - COALESCE(v_reserved_qty, 0), 0))::INTEGER;
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
