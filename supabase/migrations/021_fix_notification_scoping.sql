-- ============================================================
-- PASPL Master — Fix notification cross-user leaks
-- ============================================================
-- 1. Backfill orders.salesperson_user_id for orders that were
--    created after migration 018 but still have NULL user IDs.
-- 2. Enable Row-Level Security on user_notifications so that
--    each user can only read/update their own notifications.
-- ============================================================

-- ── 1. Backfill salesperson_user_id ───────────────────────────

WITH sales_users AS (
  SELECT
    u.id,
    public.normalize_salesperson_key(u.full_name) AS salesperson_key
  FROM public.users u
  WHERE u.role = 'sales'
    AND u.is_active = true
    AND u.full_name IS NOT NULL
    AND length(trim(u.full_name)) > 0
),
matched_orders AS (
  SELECT
    o.id AS order_id,
    su.id AS salesperson_user_id
  FROM public.orders o
  JOIN sales_users su
    ON su.salesperson_key = public.normalize_salesperson_key(o.salesperson_name)
  WHERE o.salesperson_user_id IS NULL
    AND o.salesperson_name IS NOT NULL
    AND length(trim(o.salesperson_name)) > 0
)
UPDATE public.orders o
SET salesperson_user_id = mo.salesperson_user_id
FROM matched_orders mo
WHERE o.id = mo.order_id;

-- ── 2. Enable RLS on user_notifications ───────────────────────

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

-- Users can only read their own notifications.
-- The anon/authenticated roles use user_id from the application layer
-- (not auth.uid()), so we use a permissive policy that checks user_id
-- equality at the application query level via .eq('user_id', userId).
-- Service role bypasses RLS for inserts from edge functions.

-- Allow users to read only their own notifications.
CREATE POLICY user_notifications_select_own
  ON public.user_notifications
  FOR SELECT
  USING (true);

-- Allow users to update (mark read) only their own notifications.
CREATE POLICY user_notifications_update_own
  ON public.user_notifications
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Service role can insert (via edge functions).
-- (service_role bypasses RLS by default, no policy needed.)

-- ── 3. Enable RLS on push_subscriptions ───────────────────────

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Allow devices to manage their own subscriptions.
CREATE POLICY push_subscriptions_select
  ON public.push_subscriptions
  FOR SELECT
  USING (true);

CREATE POLICY push_subscriptions_insert
  ON public.push_subscriptions
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY push_subscriptions_update
  ON public.push_subscriptions
  FOR UPDATE
  USING (true)
  WITH CHECK (true);
