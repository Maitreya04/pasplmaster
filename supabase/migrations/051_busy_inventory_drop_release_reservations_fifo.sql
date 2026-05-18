-- PASPL Master — align sellable qty with Busy as inventory authority.
--
-- Problem: locationwise_stock_available uses physical − reservations. Busy-fed
-- physical already reflects invoiced/outbound qty, while soft reservations for
-- open orders stay active → double subtraction (e.g. 26 − 12 Busy net = 14,
-- minus reservation 12 shows 2).
--
-- Fix: when Busy-fed location rows drop (ERP apply or items↔location reconcile),
-- peel FIFO reservations up to that drop so availability is not double-counted.
-- (PostgreSQL does not allow REFERENCING transition tables on INSERT OR DELETE OR UPDATE
-- triggers; hook points live in apply_erp_items_delta + reconcile_stock_locationwise_to_item_total
-- via migration 053.)
--
-- complete_billing previously updated only sr.status = 'active'; FIFO may mark rows
-- released early so billing still promotes those lines to awaiting_erp_sync.

CREATE OR REPLACE FUNCTION public.release_stock_reservations_fifo_for_location_drop(
  p_busy_code NUMERIC,
  p_stock_location_code TEXT,
  p_drop_qty NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_need INTEGER;
  r RECORD;
  v_take INTEGER;
  v_row_qty INTEGER;
BEGIN
  IF p_busy_code IS NULL OR p_stock_location_code IS NULL THEN
    RETURN;
  END IF;

  v_need := GREATEST(FLOOR(COALESCE(p_drop_qty, 0))::INTEGER, 0);
  IF v_need <= 0 THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT sr.id, sr.qty_reserved AS q
    FROM public.stock_reservations sr
    WHERE sr.busy_code IS NOT DISTINCT FROM p_busy_code
      AND sr.stock_location_code IS NOT DISTINCT FROM p_stock_location_code
      AND sr.status IN ('active', 'awaiting_erp_sync')
    ORDER BY sr.reserved_at ASC NULLS LAST, sr.id ASC
    FOR UPDATE OF sr
  LOOP
    EXIT WHEN v_need <= 0;
    v_row_qty := GREATEST(COALESCE(r.q, 0), 0);
    IF v_row_qty <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_row_qty, v_need);

    IF v_take >= v_row_qty THEN
      UPDATE public.stock_reservations sr
      SET status = 'released',
          released_at = COALESCE(sr.released_at, now()),
          last_reconciled_at = now()
      WHERE sr.id = r.id;
      v_need := v_need - v_take;
    ELSE
      UPDATE public.stock_reservations sr
      SET qty_reserved = sr.qty_reserved - v_take,
          last_reconciled_at = now()
      WHERE sr.id = r.id;
      v_need := 0;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.release_stock_reservations_fifo_for_location_drop(NUMERIC, TEXT, NUMERIC) IS
  'After Busy lowers stock_locationwise qty at one warehouse, peel FIFO reservations up to that drop so physical − reservation is not double-counted.';

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
    AND sr.status IN ('active', 'released', 'awaiting_erp_sync');

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
