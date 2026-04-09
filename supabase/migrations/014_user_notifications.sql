-- ============================================================
-- PASPL Master — In-app user notifications + realtime
-- ============================================================

CREATE TABLE user_notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_notifications_user_created
  ON user_notifications(user_id, created_at DESC);

CREATE INDEX idx_user_notifications_user_unread
  ON user_notifications(user_id)
  WHERE read_at IS NULL;

GRANT SELECT, UPDATE ON user_notifications TO anon, authenticated;

-- INSERT only via service role (edge functions)
GRANT INSERT ON user_notifications TO service_role;
GRANT USAGE, SELECT ON SEQUENCE user_notifications_id_seq TO service_role;

-- Broaden audit log for multi-target internal sends
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.notification_events'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%target_role%'
  LOOP
    EXECUTE format('ALTER TABLE notification_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE notification_events
  ADD CONSTRAINT notification_events_target_role_check
  CHECK (target_role IN ('sales', 'billing', 'picking', 'admin', 'broadcast'));

-- Realtime: inbox + order line updates for billing/picking UIs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'user_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;
  END IF;
END
$$;
