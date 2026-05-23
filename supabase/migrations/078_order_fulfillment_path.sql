-- Billing fulfillment path: warehouse pick (Indore queue) vs direct bill (skip pick).

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfillment_path TEXT;

UPDATE public.orders
SET fulfillment_path = CASE
  WHEN stock_location_code = 'jabalpur' THEN 'direct_bill'
  ELSE 'warehouse_pick'
END
WHERE fulfillment_path IS NULL;

ALTER TABLE public.orders
  ALTER COLUMN fulfillment_path SET DEFAULT 'warehouse_pick';

ALTER TABLE public.orders
  ALTER COLUMN fulfillment_path SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_fulfillment_path_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_fulfillment_path_check
      CHECK (fulfillment_path IN ('warehouse_pick', 'direct_bill'));
  END IF;
END $$;

-- Jabalpur orders should not sit in the Indore pick queue.
UPDATE public.orders
SET workflow_status = 'completed',
    completed_at = COALESCE(completed_at, approved_at, now())
WHERE stock_location_code = 'jabalpur'
  AND workflow_status IN ('approved', 'picking');

CREATE OR REPLACE FUNCTION public.complete_billing(
  p_order_id BIGINT,
  p_claim_id BIGINT,
  p_user_id BIGINT,
  p_is_resolving_flags BOOLEAN DEFAULT false,
  p_fulfillment_path TEXT DEFAULT 'warehouse_pick'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim RECORD;
  v_user_name TEXT;
  v_path TEXT;
BEGIN
  v_path := COALESCE(NULLIF(trim(p_fulfillment_path), ''), 'warehouse_pick');
  IF v_path NOT IN ('warehouse_pick', 'direct_bill') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_fulfillment_path');
  END IF;

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
        priority = 'normal',
        fulfillment_path = v_path
    WHERE id = p_order_id;

    INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
    VALUES (p_order_id, 'billing_flags_resolved', p_user_id, 'billing',
            jsonb_build_object('reviewer', v_user_name, 'fulfillment_path', v_path));
  ELSIF v_path = 'direct_bill' THEN
    UPDATE public.orders
    SET workflow_status = 'completed',
        reviewer_name = v_user_name,
        approved_at = COALESCE(approved_at, now()),
        completed_at = COALESCE(completed_at, now()),
        fulfillment_path = v_path
    WHERE id = p_order_id;

    INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
    VALUES (p_order_id, 'billing_approved', p_user_id, 'billing',
            jsonb_build_object('reviewer', v_user_name, 'fulfillment_path', v_path));
  ELSE
    UPDATE public.orders
    SET workflow_status = 'approved',
        reviewer_name = v_user_name,
        approved_at = COALESCE(approved_at, now()),
        fulfillment_path = v_path
    WHERE id = p_order_id;

    INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
    VALUES (p_order_id, 'billing_approved', p_user_id, 'billing',
            jsonb_build_object('reviewer', v_user_name, 'fulfillment_path', v_path));
  END IF;

  RETURN jsonb_build_object('success', true, 'fulfillment_path', v_path);
END;
$$;

COMMENT ON COLUMN public.orders.fulfillment_path IS
  'warehouse_pick = Indore pick queue after billing; direct_bill = skip warehouse pick.';

COMMENT ON FUNCTION public.complete_billing(BIGINT, BIGINT, BIGINT, BOOLEAN, TEXT) IS
  'Complete billing claim; direct_bill completes the order without sending to picking.';

CREATE OR REPLACE FUNCTION public.enqueue_order_event_queue_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage TEXT;
  v_event_type TEXT;
  v_fulfillment_path TEXT;
BEGIN
  v_stage := NEW.stage;
  v_event_type := NEW.event_type;

  IF v_stage = 'billing'
     AND v_event_type IN (
       'billing_claimed',
       'billing_released',
       'billing_approved',
       'billing_flags_resolved',
       'claim_expired',
       'claim_takeover'
     ) THEN
    PERFORM public.emit_queue_event(
      'billing',
      v_event_type,
      NEW.order_id,
      NULL,
      NEW.actor_user_id,
      COALESCE(NEW.payload, '{}'::jsonb)
    );
  END IF;

  IF v_stage = 'billing' AND v_event_type = 'billing_approved' THEN
    SELECT o.fulfillment_path
    INTO v_fulfillment_path
    FROM public.orders o
    WHERE o.id = NEW.order_id;

    IF COALESCE(v_fulfillment_path, 'warehouse_pick') = 'warehouse_pick' THEN
      PERFORM public.emit_queue_event(
        'picking',
        'picking_ready',
        NEW.order_id,
        'approved',
        NEW.actor_user_id,
        COALESCE(NEW.payload, '{}'::jsonb)
      );
    END IF;
  END IF;

  IF v_stage = 'picking'
     AND v_event_type IN ('picking_claimed', 'picking_released') THEN
    PERFORM public.emit_queue_event(
      'billing',
      v_event_type,
      NEW.order_id,
      NULL,
      NEW.actor_user_id,
      COALESCE(NEW.payload, '{}'::jsonb)
    );
  END IF;

  RETURN NEW;
END;
$$;
