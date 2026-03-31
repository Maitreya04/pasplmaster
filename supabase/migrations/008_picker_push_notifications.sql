-- ============================================================
-- PASPL Master — Picker Push Notifications
-- ============================================================

CREATE TABLE push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('sales', 'billing', 'picking', 'admin')),
  device_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_subscriptions_role_enabled
  ON push_subscriptions(role, enabled, last_seen_at DESC);

CREATE INDEX idx_push_subscriptions_device_user
  ON push_subscriptions(device_id, role, user_id);

CREATE TABLE notification_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_role TEXT NOT NULL CHECK (target_role IN ('sales', 'billing', 'picking', 'admin')),
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notification_events_created
  ON notification_events(created_at DESC);

CREATE OR REPLACE FUNCTION set_push_subscription_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_push_subscriptions_updated_at
  BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION set_push_subscription_updated_at();

GRANT SELECT, INSERT, UPDATE ON push_subscriptions TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE push_subscriptions_id_seq TO anon, authenticated;

GRANT SELECT, INSERT ON notification_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE notification_events_id_seq TO service_role;
