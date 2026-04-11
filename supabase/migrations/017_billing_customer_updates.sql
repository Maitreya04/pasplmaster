-- ============================================================
-- Billing customer updates for Sales follow-up
-- ============================================================

CREATE TABLE IF NOT EXISTS billing_customer_updates (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  message_text TEXT NOT NULL,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  sent_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_customer_updates_order_created
  ON billing_customer_updates(order_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON billing_customer_updates TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE billing_customer_updates_id_seq TO anon, authenticated;
