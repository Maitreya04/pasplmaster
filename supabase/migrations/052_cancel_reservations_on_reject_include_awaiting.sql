-- PASPL Master — billing rejection must clear all soft holds, not only `active`.
--
-- Orders that reached billing approval have reservations in `awaiting_erp_sync`.
-- Those rows still subtract from locationwise_stock_available; if billing later
-- rejects the order, we must cancel them or sales capacity stays understated.
--
-- Busy remains authoritative for physical qty: the per-minute writer overwrites
-- stock_locationwise from Busy. Rejection in-app does not push stock back into
-- Busy — if no invoice was posted, Busy stays high and the next sync restores it;
-- if Busy already posted, the business must reverse/cancel in Busy so the writer
-- can reflect the return on the next tick.

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
    AND status IN ('active', 'awaiting_erp_sync');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.cancel_active_stock_reservations_for_order(BIGINT) IS
  'On order reject/flag cleanup: cancel soft stock holds. Clears active and awaiting_erp_sync; Busy sync still owns physical qty.';
