-- Notify billing queue when a picker claims or releases an order (instant picker_name on dashboard).

CREATE OR REPLACE FUNCTION public.enqueue_order_event_queue_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage TEXT;
  v_event_type TEXT;
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
    PERFORM public.emit_queue_event(
      'picking',
      'picking_ready',
      NEW.order_id,
      'approved',
      NEW.actor_user_id,
      COALESCE(NEW.payload, '{}'::jsonb)
    );
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

COMMENT ON FUNCTION public.enqueue_order_event_queue_event() IS
  'Mirrors billing/picking order_events into queue_events for low-volume Realtime (billing stage includes picking_claimed).';
