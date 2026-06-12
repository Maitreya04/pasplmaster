-- Root cause for Observability > Query Performance showing
-- realtime.list_changes as the top query:
--
-- The app migrated queue screens to public.queue_events, but the
-- supabase_realtime publication still included high-churn tables. Realtime
-- reads the WAL for every table in the publication, so ERP stock sync and
-- order/item writes kept the internal realtime.list_changes query hot even
-- when clients only needed compact queue invalidation events.

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

  -- Billing needs picker assignment changes for the desk monitor.
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

  -- Picking queue clients now listen to queue_events instead of direct
  -- orders/work_claims table changes.
  IF v_stage = 'picking'
     AND v_event_type IN ('picking_claimed', 'picking_released', 'picking_completed') THEN
    PERFORM public.emit_queue_event(
      'picking',
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
  'Mirrors workflow order_events into low-volume queue_events so queue UIs do not subscribe to hot base tables.';

DO $$
DECLARE
  table_to_drop TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RETURN;
  END IF;

  FOREACH table_to_drop IN ARRAY ARRAY[
    'orders',
    'order_items',
    'pending_items',
    'stock_locationwise',
    'work_claims',
    'order_events',
    'items'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = table_to_drop
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', table_to_drop);
    END IF;
  END LOOP;

  IF to_regclass('public.queue_events') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'queue_events'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_events;
  END IF;

  IF to_regclass('public.user_notifications') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'user_notifications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
  END IF;
END $$;
