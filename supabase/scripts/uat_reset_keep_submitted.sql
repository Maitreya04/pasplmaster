-- ============================================================
-- UAT clean slate — keep submitted orders only
-- ============================================================
--
-- WHEN TO RUN
--   Manual / ops only. Run in Supabase SQL Editor (or psql) against
--   the target project before handing the app to external testers.
--   Take a backup or snapshot first; this is destructive.
--
-- WHAT IS REMOVED
--   All orders where workflow_status <> 'submitted' (approved, picking,
--   completed, rejected, flagged), and their order_items, work_claims,
--   order_events, pending_items (via CASCADE on delete).
--
-- WHAT IS PRESERVED
--   Orders with workflow_status = 'submitted' and their order_items.
--   Catalog: items, customers, transports, users.
--   Sales intelligence / uploads: customer_top_items, salesperson_*,
--   sales_targets, upload_log (not touched).
--   push_subscriptions (not touched).
--
-- WHAT IS CLEANED ON SURVIVING ORDERS
--   work_claims, order_events, pending_items for those order ids;
--   reviewer_name, picker_name, timeline timestamps, notes cleared.
--
-- NOTIFICATIONS (default vs optional)
--   Default below: TRUNCATE user_notifications and notification_events
--   for an empty inbox. If you want to keep in-app history, comment out
--   the TRUNCATE block and optionally run instead:
--
--     DELETE FROM user_notifications WHERE order_id IS NOT NULL;
--     DELETE FROM notification_events WHERE order_id IS NOT NULL;
--
-- PRE-CHECK (run before BEGIN)
--   SELECT workflow_status, count(*) FROM orders GROUP BY 1 ORDER BY 1;
--
-- POST-CHECK (run after COMMIT)
--   SELECT workflow_status, count(*) FROM orders GROUP BY 1 ORDER BY 1;
--   SELECT count(*) AS active_claims FROM work_claims WHERE status = 'active';
--
-- ============================================================

BEGIN;

-- 1) Drop every order that is not still in the sales-submitted queue
DELETE FROM orders
WHERE workflow_status <> 'submitted';

-- 2) On the orders you kept: remove claims, audit events, pending lines
DELETE FROM work_claims
WHERE order_id IN (SELECT id FROM orders);

DELETE FROM order_events
WHERE order_id IN (SELECT id FROM orders);

DELETE FROM pending_items
WHERE order_id IN (SELECT id FROM orders);

UPDATE orders
SET
  reviewer_name = NULL,
  picker_name = NULL,
  approved_at = NULL,
  picked_at = NULL,
  completed_at = NULL,
  dispatched_at = NULL,
  notes = NULL
WHERE workflow_status = 'submitted';

-- 3) Clean notification tables (full inbox reset for UAT)
TRUNCATE user_notifications RESTART IDENTITY;
TRUNCATE notification_events RESTART IDENTITY;

COMMIT;
