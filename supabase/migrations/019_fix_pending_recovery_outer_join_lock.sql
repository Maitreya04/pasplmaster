-- Fix pending recovery recompute lock:
-- PostgreSQL rejects plain FOR UPDATE on a LEFT JOIN because it would try
-- to lock the nullable side of the outer join. Lock only pending_items.

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
  FOR UPDATE OF pi;

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
