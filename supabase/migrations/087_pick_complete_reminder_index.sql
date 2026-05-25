-- Speed up auto pick-reminder dedupe lookups in send-internal-notification.

CREATE INDEX IF NOT EXISTS idx_notification_events_order_type_created
  ON notification_events(order_id, event_type, created_at DESC)
  WHERE order_id IS NOT NULL;
