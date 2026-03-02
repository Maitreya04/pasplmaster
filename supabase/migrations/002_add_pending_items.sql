-- ============================================================
-- PASPL Master — Pending Items (Out-of-Stock) Support
-- ============================================================
-- This migration adds a dedicated table to track order lines
-- that could not be fulfilled due to lack of stock at either
-- billing-time (Busy check) or during warehouse picking.
--
-- These records power:
-- - Billing: central "Pending" queue
-- - Picking: automatic creation when flagging Out of Stock
-- - Sales: visibility into which items are pending per customer
--
-- NOTE: This is append-only for v1. Records are resolved or
-- cancelled but never hard-deleted.

CREATE TABLE IF NOT EXISTS pending_items (
  id BIGSERIAL PRIMARY KEY,

  -- Links back to the original order + customer
  order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  customer_id BIGINT REFERENCES customers(id),
  customer_name TEXT NOT NULL,

  -- Item details
  item_id BIGINT REFERENCES items(id),
  item_name TEXT NOT NULL,

  qty_pending INTEGER NOT NULL CHECK (qty_pending > 0),

  -- Who created the pending record and from where
  source TEXT NOT NULL DEFAULT 'billing', -- 'billing' | 'picking'
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Optional notes (e.g. Busy ref, rack issues)
  note TEXT,

  -- Lifecycle: pending → resolved | cancelled
  status TEXT NOT NULL DEFAULT 'pending', -- pending|resolved|cancelled
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_items_status ON pending_items(status);
CREATE INDEX IF NOT EXISTS idx_pending_items_order ON pending_items(order_id);
CREATE INDEX IF NOT EXISTS idx_pending_items_customer ON pending_items(customer_id);

