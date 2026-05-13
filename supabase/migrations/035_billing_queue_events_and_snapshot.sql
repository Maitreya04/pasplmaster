-- PASPL Master — low-volume billing queue Realtime + compact queue snapshot.
--
-- Realtime should signal meaningful workflow changes, not every heartbeat.
-- Billing keeps its instant feel by listening to queue_events and then pulling
-- a compact snapshot instead of repeatedly fetching broad order embeds.

CREATE TABLE IF NOT EXISTS public.queue_events (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('billing', 'picking', 'sales')),
  event_type TEXT NOT NULL,
  workflow_status TEXT,
  actor_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_queue_events_stage_created
  ON public.queue_events(stage, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_queue_events_order_created
  ON public.queue_events(order_id, created_at DESC);

GRANT SELECT ON public.queue_events TO anon, authenticated;
GRANT INSERT ON public.queue_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.queue_events_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.emit_queue_event(
  p_stage TEXT,
  p_event_type TEXT,
  p_order_id BIGINT,
  p_workflow_status TEXT DEFAULT NULL,
  p_actor_user_id BIGINT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workflow_status TEXT;
BEGIN
  IF p_order_id IS NULL OR p_stage IS NULL OR p_event_type IS NULL THEN
    RETURN;
  END IF;

  IF p_stage NOT IN ('billing', 'picking', 'sales') THEN
    RETURN;
  END IF;

  v_workflow_status := p_workflow_status;
  IF v_workflow_status IS NULL THEN
    SELECT workflow_status
    INTO v_workflow_status
    FROM public.orders
    WHERE id = p_order_id;
  END IF;

  INSERT INTO public.queue_events (
    order_id,
    stage,
    event_type,
    workflow_status,
    actor_user_id,
    payload
  ) VALUES (
    p_order_id,
    p_stage,
    p_event_type,
    v_workflow_status,
    p_actor_user_id,
    COALESCE(p_payload, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_order_insert_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.workflow_status = 'submitted' THEN
    PERFORM public.emit_queue_event(
      'billing',
      'order_submitted',
      NEW.id,
      NEW.workflow_status,
      NEW.salesperson_user_id,
      jsonb_build_object('order_number', NEW.order_number)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_emit_queue_event_insert ON public.orders;
CREATE TRIGGER trg_orders_emit_queue_event_insert
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_order_insert_event();

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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_events_emit_queue_event ON public.order_events;
CREATE TRIGGER trg_order_events_emit_queue_event
AFTER INSERT ON public.order_events
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_order_event_queue_event();

CREATE OR REPLACE FUNCTION public.get_billing_queue_snapshot(
  p_statuses TEXT[] DEFAULT NULL,
  p_created_from TIMESTAMPTZ DEFAULT NULL,
  p_created_to TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE (
  id BIGINT,
  order_number TEXT,
  order_kind TEXT,
  customer_id BIGINT,
  customer_name TEXT,
  customer_city TEXT,
  transport_id BIGINT,
  transport_name TEXT,
  salesperson_name TEXT,
  salesperson_user_id BIGINT,
  reviewer_name TEXT,
  picker_name TEXT,
  workflow_status TEXT,
  priority TEXT,
  notes TEXT,
  item_count INTEGER,
  ask_line_count INTEGER,
  special_rate_line_count INTEGER,
  special_rate_qty INTEGER,
  total_value NUMERIC,
  created_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  picked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  claim_id BIGINT,
  claimed_by_user_id BIGINT,
  claimed_by_name TEXT,
  claimed_at TIMESTAMPTZ,
  last_heartbeat_at TIMESTAMPTZ,
  claim_is_stale BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH line_summary AS (
    SELECT
      oi.order_id,
      COUNT(*)::INTEGER AS live_item_count,
      COUNT(*) FILTER (
        WHERE (
          UPPER(COALESCE(i.main_group, '')) = 'ASK'
          OR UPPER(COALESCE(i.parent_group, '')) = 'ASK'
          OR UPPER(COALESCE(oi.item_name, '')) = 'ASK'
          OR UPPER(COALESCE(oi.item_name, '')) LIKE 'ASK %'
          OR UPPER(COALESCE(oi.item_name, '')) LIKE 'ASK-%'
          OR UPPER(COALESCE(oi.item_name, '')) ~ '(^|[^A-Z0-9])ASK([^A-Z0-9]|$)'
        )
      )::INTEGER AS ask_line_count,
      COUNT(*) FILTER (
        WHERE oi.price_quoted IS NOT NULL
          AND oi.price_system IS NOT NULL
          AND oi.price_quoted IS DISTINCT FROM oi.price_system
      )::INTEGER AS special_rate_line_count,
      COALESCE(
        SUM(
          CASE
            WHEN oi.price_quoted IS NOT NULL
              AND oi.price_system IS NOT NULL
              AND oi.price_quoted IS DISTINCT FROM oi.price_system
            THEN GREATEST(COALESCE(oi.qty_requested, 0), 0)
            ELSE 0
          END
        ),
        0
      )::INTEGER AS special_rate_qty
    FROM public.order_items oi
    LEFT JOIN public.items i ON i.id = oi.item_id
    GROUP BY oi.order_id
  ),
  active_billing_claims AS (
    SELECT DISTINCT ON (wc.order_id)
      wc.order_id,
      wc.id AS claim_id,
      wc.claimed_by_user_id,
      u.full_name AS claimed_by_name,
      wc.claimed_at,
      wc.last_heartbeat_at,
      ((now() - wc.last_heartbeat_at) > INTERVAL '3 minutes') AS claim_is_stale
    FROM public.work_claims wc
    LEFT JOIN public.users u ON u.id = wc.claimed_by_user_id
    WHERE wc.stage = 'billing'
      AND wc.status = 'active'
    ORDER BY wc.order_id, wc.claimed_at DESC
  )
  SELECT
    o.id,
    o.order_number,
    o.order_kind,
    o.customer_id,
    o.customer_name,
    o.customer_city,
    o.transport_id,
    o.transport_name,
    o.salesperson_name,
    o.salesperson_user_id,
    o.reviewer_name,
    o.picker_name,
    o.workflow_status,
    o.priority,
    o.notes,
    COALESCE(ls.live_item_count, o.item_count, 0)::INTEGER AS item_count,
    COALESCE(ls.ask_line_count, 0)::INTEGER AS ask_line_count,
    COALESCE(ls.special_rate_line_count, 0)::INTEGER AS special_rate_line_count,
    COALESCE(ls.special_rate_qty, 0)::INTEGER AS special_rate_qty,
    COALESCE(o.total_value, 0) AS total_value,
    o.created_at,
    o.approved_at,
    o.picked_at,
    o.completed_at,
    o.dispatched_at,
    abc.claim_id,
    abc.claimed_by_user_id,
    abc.claimed_by_name,
    abc.claimed_at,
    abc.last_heartbeat_at,
    abc.claim_is_stale
  FROM public.orders o
  LEFT JOIN line_summary ls ON ls.order_id = o.id
  LEFT JOIN active_billing_claims abc ON abc.order_id = o.id
  WHERE (p_statuses IS NULL OR o.workflow_status = ANY(p_statuses))
    AND (p_created_from IS NULL OR o.created_at >= p_created_from)
    AND (p_created_to IS NULL OR o.created_at <= p_created_to)
  ORDER BY o.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_billing_queue_snapshot(TEXT[], TIMESTAMPTZ, TIMESTAMPTZ)
  TO anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'queue_events'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_events;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'work_claims'
    ) THEN
      ALTER PUBLICATION supabase_realtime DROP TABLE public.work_claims;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'items'
    ) THEN
      ALTER PUBLICATION supabase_realtime DROP TABLE public.items;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_events'
    ) THEN
      ALTER PUBLICATION supabase_realtime DROP TABLE public.order_events;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pending_items'
    ) THEN
      ALTER PUBLICATION supabase_realtime DROP TABLE public.pending_items;
    END IF;
  END IF;
END $$;

COMMENT ON TABLE public.queue_events IS
  'Low-volume workflow event stream for queue UIs. Heartbeats deliberately do not emit rows here.';

COMMENT ON FUNCTION public.get_billing_queue_snapshot(TEXT[], TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Compact billing queue payload used with queue_events Realtime to reduce free-tier egress.';
