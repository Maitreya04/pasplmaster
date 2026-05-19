-- ============================================================
-- PASPL Master — Pending recovery / back-in-stock follow-up
-- ============================================================

ALTER TABLE pending_items
  ADD COLUMN IF NOT EXISTS recovery_status TEXT,
  ADD COLUMN IF NOT EXISTS back_in_stock_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_reviewed_by TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.pending_items'::regclass
      AND conname = 'pending_items_recovery_status_check'
  ) THEN
    ALTER TABLE pending_items
      ADD CONSTRAINT pending_items_recovery_status_check
      CHECK (recovery_status IN ('waiting_stock', 'back_in_stock', 'needs_checked', 'reviewed'));
  END IF;
END
$$;

ALTER TABLE pending_items
  ALTER COLUMN recovery_status SET DEFAULT 'waiting_stock';

CREATE INDEX IF NOT EXISTS idx_pending_items_item_pending
  ON pending_items(item_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_pending_items_status_recovery
  ON pending_items(status, recovery_status);

CREATE OR REPLACE FUNCTION pending_recovery_target_status(
  p_current_status TEXT,
  p_stock_qty INTEGER,
  p_qty_pending INTEGER
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_sufficient BOOLEAN := COALESCE(p_stock_qty, 0) >= GREATEST(COALESCE(p_qty_pending, 0), 0)
    AND COALESCE(p_qty_pending, 0) > 0;
BEGIN
  IF p_current_status = 'reviewed' THEN
    IF v_sufficient THEN
      RETURN 'reviewed';
    END IF;
    RETURN 'waiting_stock';
  END IF;

  IF v_sufficient THEN
    RETURN 'back_in_stock';
  END IF;

  IF p_current_status IN ('back_in_stock', 'needs_checked') THEN
    RETURN 'needs_checked';
  END IF;

  RETURN 'waiting_stock';
END;
$$;

UPDATE pending_items pi
SET recovery_status = CASE
  WHEN pi.status <> 'pending' THEN 'reviewed'
  ELSE pending_recovery_target_status(
    'waiting_stock',
    i.stock_qty,
    pi.qty_pending
  )
END
FROM items i
WHERE pi.item_id = i.id
  AND pi.recovery_status IS NULL;

UPDATE pending_items
SET recovery_status = CASE
  WHEN status <> 'pending' THEN 'reviewed'
  ELSE 'waiting_stock'
END
WHERE recovery_status IS NULL;

ALTER TABLE pending_items
  ALTER COLUMN recovery_status SET NOT NULL;

CREATE OR REPLACE FUNCTION notify_pending_item_back_in_stock(
  p_pending_item_id BIGINT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending RECORD;
  v_inserted INTEGER := 0;
BEGIN
  SELECT
    pi.id,
    pi.order_id,
    pi.order_number,
    pi.customer_name,
    pi.item_id,
    pi.item_name,
    pi.qty_pending,
    o.salesperson_name
  INTO v_pending
  FROM pending_items pi
  JOIN orders o ON o.id = pi.order_id
  WHERE pi.id = p_pending_item_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  WITH normalized AS (
    SELECT
      REGEXP_REPLACE(LOWER(TRIM(COALESCE(v_pending.salesperson_name, ''))), '[^a-z0-9]+', '', 'g') AS needle
  ),
  matched_sales AS (
    SELECT DISTINCT u.id
    FROM users u
    CROSS JOIN normalized n
    WHERE u.role = 'sales'
      AND u.is_active = true
      AND n.needle <> ''
      AND (
        REGEXP_REPLACE(LOWER(TRIM(COALESCE(u.full_name, ''))), '[^a-z0-9]+', '', 'g') = n.needle
        OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(u.station_label, ''))), '[^a-z0-9]+', '', 'g') = n.needle
        OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(u.full_name, ''))), '[^a-z0-9]+', '', 'g') LIKE '%' || n.needle || '%'
        OR REGEXP_REPLACE(LOWER(TRIM(COALESCE(u.station_label, ''))), '[^a-z0-9]+', '', 'g') LIKE '%' || n.needle || '%'
      )
  )
  INSERT INTO user_notifications (
    user_id,
    title,
    body,
    type,
    order_id,
    payload
  )
  SELECT
    ms.id,
    'Back in stock: ' || v_pending.item_name,
    FORMAT(
      '%s is available again for %s. Pending qty %s on order %s needs customer follow-up.',
      v_pending.item_name,
      v_pending.customer_name,
      v_pending.qty_pending,
      v_pending.order_number
    ),
    'pending_item_back_in_stock',
    v_pending.order_id,
    jsonb_build_object(
      'eventType', 'pending_item_back_in_stock',
      'pending_item_id', v_pending.id,
      'order_id', v_pending.order_id,
      'order_number', v_pending.order_number,
      'item_id', v_pending.item_id,
      'item_name', v_pending.item_name,
      'qty_pending', v_pending.qty_pending,
      'recovery_status', 'back_in_stock',
      'deep_link', FORMAT('/sales/pending-recovery?pendingItemId=%s', v_pending.id)
    )
  FROM matched_sales ms;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION recompute_pending_recovery_status(
  p_pending_item_id BIGINT,
  p_emit_notification BOOLEAN DEFAULT true
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending RECORD;
  v_old_status TEXT;
  v_new_status TEXT;
BEGIN
  SELECT
    pi.id,
    pi.status,
    pi.recovery_status,
    pi.qty_pending,
    pi.back_in_stock_at,
    COALESCE(i.stock_qty, 0) AS stock_qty
  INTO v_pending
  FROM pending_items pi
  LEFT JOIN items i ON i.id = pi.item_id
  WHERE pi.id = p_pending_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_pending.status <> 'pending' THEN
    RETURN COALESCE(v_pending.recovery_status, 'reviewed');
  END IF;

  v_old_status := COALESCE(v_pending.recovery_status, 'waiting_stock');
  v_new_status := pending_recovery_target_status(
    v_old_status,
    v_pending.stock_qty,
    v_pending.qty_pending
  );

  IF v_new_status IS DISTINCT FROM v_old_status THEN
    UPDATE pending_items
    SET
      recovery_status = v_new_status,
      back_in_stock_at = CASE
        WHEN v_new_status = 'back_in_stock' THEN NOW()
        ELSE back_in_stock_at
      END
    WHERE id = p_pending_item_id;

    IF p_emit_notification AND v_new_status = 'back_in_stock' THEN
      PERFORM notify_pending_item_back_in_stock(p_pending_item_id);
    END IF;
  ELSIF v_new_status = 'back_in_stock' AND v_pending.back_in_stock_at IS NULL THEN
    UPDATE pending_items
    SET back_in_stock_at = NOW()
    WHERE id = p_pending_item_id;
  END IF;

  RETURN v_new_status;
END;
$$;

CREATE OR REPLACE FUNCTION seed_pending_recovery_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'pending' THEN
    PERFORM recompute_pending_recovery_status(NEW.id, false);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pending_items_seed_recovery ON pending_items;

CREATE TRIGGER trg_pending_items_seed_recovery
AFTER INSERT OR UPDATE OF item_id, qty_pending, status
ON pending_items
FOR EACH ROW
EXECUTE FUNCTION seed_pending_recovery_status();

CREATE OR REPLACE FUNCTION refresh_pending_recovery_for_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending RECORD;
BEGIN
  IF COALESCE(NEW.stock_qty, 0) IS DISTINCT FROM COALESCE(OLD.stock_qty, 0) THEN
    FOR v_pending IN
      SELECT id
      FROM pending_items
      WHERE item_id = NEW.id
        AND status = 'pending'
    LOOP
      PERFORM recompute_pending_recovery_status(v_pending.id, true);
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_items_refresh_pending_recovery ON items;

CREATE TRIGGER trg_items_refresh_pending_recovery
AFTER UPDATE OF stock_qty
ON items
FOR EACH ROW
EXECUTE FUNCTION refresh_pending_recovery_for_item();

CREATE OR REPLACE FUNCTION process_pending_recovery_action(
  p_pending_item_id BIGINT,
  p_action TEXT,
  p_actor_user_id BIGINT DEFAULT NULL,
  p_actor_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending pending_items%ROWTYPE;
  v_actor_name TEXT;
  v_stock_qty INTEGER := 0;
  v_next_status TEXT;
  v_order_item_id BIGINT;
  v_billing_notified INTEGER := 0;
BEGIN
  IF p_action NOT IN ('send_to_billing', 'keep_pending', 'customer_declined') THEN
    RAISE EXCEPTION 'Unsupported pending recovery action: %', p_action;
  END IF;

  SELECT *
  INTO v_pending
  FROM pending_items
  WHERE id = p_pending_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending item % not found', p_pending_item_id;
  END IF;

  IF v_pending.status <> 'pending' THEN
    RAISE EXCEPTION 'Pending item % is already closed', p_pending_item_id;
  END IF;

  v_actor_name := NULLIF(TRIM(COALESCE(p_actor_name, '')), '');
  IF v_actor_name IS NULL AND p_actor_user_id IS NOT NULL THEN
    SELECT NULLIF(TRIM(full_name), '')
    INTO v_actor_name
    FROM users
    WHERE id = p_actor_user_id;
  END IF;
  v_actor_name := COALESCE(v_actor_name, 'Sales');

  IF v_pending.item_id IS NOT NULL THEN
    SELECT COALESCE(stock_qty, 0)
    INTO v_stock_qty
    FROM items
    WHERE id = v_pending.item_id;
  END IF;

  IF p_action = 'send_to_billing' THEN
    UPDATE pending_items
    SET
      recovery_status = 'reviewed',
      recovery_reviewed_at = NOW(),
      recovery_reviewed_by = v_actor_name
    WHERE id = v_pending.id;

    INSERT INTO user_notifications (
      user_id,
      title,
      body,
      type,
      order_id,
      payload
    )
    SELECT
      u.id,
      'Customer confirmed: ' || v_pending.item_name,
      FORMAT(
        '%s confirmed %s for %s. Please review %s pending pc(s) on order %s.',
        v_actor_name,
        v_pending.customer_name,
        v_pending.item_name,
        v_pending.qty_pending,
        v_pending.order_number
      ),
      'pending_item_ready_for_billing',
      v_pending.order_id,
      jsonb_build_object(
        'eventType', 'pending_item_ready_for_billing',
        'pending_item_id', v_pending.id,
        'order_id', v_pending.order_id,
        'order_number', v_pending.order_number,
        'item_id', v_pending.item_id,
        'item_name', v_pending.item_name,
        'qty_pending', v_pending.qty_pending,
        'deep_link', FORMAT('/billing/review/%s?pendingItemId=%s', v_pending.order_id, v_pending.id)
      )
    FROM users u
    WHERE u.role = 'billing'
      AND u.is_active = true;

    GET DIAGNOSTICS v_billing_notified = ROW_COUNT;

    RETURN jsonb_build_object(
      'ok', true,
      'action', p_action,
      'recovery_status', 'reviewed',
      'billing_notified', v_billing_notified,
      'pending_item_id', v_pending.id,
      'order_id', v_pending.order_id
    );
  END IF;

  IF p_action = 'keep_pending' THEN
    v_next_status := CASE
      WHEN v_stock_qty >= v_pending.qty_pending THEN 'reviewed'
      ELSE 'waiting_stock'
    END;

    UPDATE pending_items
    SET
      recovery_status = v_next_status,
      recovery_reviewed_at = NOW(),
      recovery_reviewed_by = v_actor_name
    WHERE id = v_pending.id;

    RETURN jsonb_build_object(
      'ok', true,
      'action', p_action,
      'recovery_status', v_next_status,
      'pending_item_id', v_pending.id,
      'order_id', v_pending.order_id
    );
  END IF;

  UPDATE pending_items
  SET
    status = 'cancelled',
    resolved_at = NOW(),
    resolved_by = v_actor_name,
    recovery_status = 'reviewed',
    recovery_reviewed_at = NOW(),
    recovery_reviewed_by = v_actor_name
  WHERE id = v_pending.id;

  IF v_pending.item_id IS NOT NULL THEN
    SELECT id
    INTO v_order_item_id
    FROM order_items
    WHERE order_id = v_pending.order_id
      AND item_id = v_pending.item_id
    ORDER BY COALESCE(qty_po, 0) DESC, id ASC
    LIMIT 1
    FOR UPDATE;

    IF v_order_item_id IS NOT NULL THEN
      UPDATE order_items
      SET qty_po = GREATEST(0, COALESCE(qty_po, 0) - v_pending.qty_pending)
      WHERE id = v_order_item_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'action', p_action,
    'recovery_status', 'reviewed',
    'pending_item_id', v_pending.id,
    'order_id', v_pending.order_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION process_pending_recovery_action(BIGINT, TEXT, BIGINT, TEXT) TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'pending_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pending_items;
  END IF;
END
$$;
