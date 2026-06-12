-- Branch + user scoped RLS for Supabase Auth sessions.
-- Legacy anon sessions (auth.uid() IS NULL) retain broad access during migration.

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_auth_branch_scoped ON public.orders;
CREATE POLICY orders_auth_branch_scoped
  ON public.orders
  FOR ALL
  TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR stock_location_code = public.current_user_branch()
    OR public.current_user_branch() IS NULL
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR stock_location_code = public.current_user_branch()
    OR public.current_user_branch() IS NULL
  );

DROP POLICY IF EXISTS orders_legacy_anon_all ON public.orders;
CREATE POLICY orders_legacy_anon_all
  ON public.orders
  FOR ALL
  TO anon
  USING (public.is_legacy_anon_session())
  WITH CHECK (public.is_legacy_anon_session());

DROP POLICY IF EXISTS work_claims_auth_scoped ON public.work_claims;
CREATE POLICY work_claims_auth_scoped
  ON public.work_claims
  FOR ALL
  TO authenticated
  USING (
    public.current_user_role() = 'admin'
    OR claimed_by_user_id = public.current_user_id()
  )
  WITH CHECK (
    public.current_user_role() = 'admin'
    OR claimed_by_user_id = public.current_user_id()
  );

DROP POLICY IF EXISTS work_claims_legacy_anon_all ON public.work_claims;
CREATE POLICY work_claims_legacy_anon_all
  ON public.work_claims
  FOR ALL
  TO anon
  USING (public.is_legacy_anon_session())
  WITH CHECK (public.is_legacy_anon_session());

DROP POLICY IF EXISTS user_notifications_select_own ON public.user_notifications;
DROP POLICY IF EXISTS user_notifications_update_own ON public.user_notifications;

CREATE POLICY user_notifications_select_own
  ON public.user_notifications
  FOR SELECT
  TO authenticated
  USING (
    user_id = public.current_user_id()
    OR public.current_user_role() = 'admin'
  );

CREATE POLICY user_notifications_update_own
  ON public.user_notifications
  FOR UPDATE
  TO authenticated
  USING (
    user_id = public.current_user_id()
    OR public.current_user_role() = 'admin'
  )
  WITH CHECK (
    user_id = public.current_user_id()
    OR public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS user_notifications_legacy_anon_all ON public.user_notifications;
CREATE POLICY user_notifications_legacy_anon_all
  ON public.user_notifications
  FOR ALL
  TO anon
  USING (public.is_legacy_anon_session())
  WITH CHECK (public.is_legacy_anon_session());

DROP POLICY IF EXISTS push_subscriptions_select ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_insert ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_update ON public.push_subscriptions;

CREATE POLICY push_subscriptions_select
  ON public.push_subscriptions
  FOR SELECT
  TO authenticated
  USING (
    user_id = public.current_user_id()
    OR public.current_user_role() = 'admin'
  );

CREATE POLICY push_subscriptions_insert
  ON public.push_subscriptions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = public.current_user_id()
    OR public.current_user_role() = 'admin'
  );

CREATE POLICY push_subscriptions_update
  ON public.push_subscriptions
  FOR UPDATE
  TO authenticated
  USING (
    user_id = public.current_user_id()
    OR public.current_user_role() = 'admin'
  )
  WITH CHECK (
    user_id = public.current_user_id()
    OR public.current_user_role() = 'admin'
  );

DROP POLICY IF EXISTS push_subscriptions_legacy_anon_all ON public.push_subscriptions;
CREATE POLICY push_subscriptions_legacy_anon_all
  ON public.push_subscriptions
  FOR ALL
  TO anon
  USING (public.is_legacy_anon_session())
  WITH CHECK (public.is_legacy_anon_session());
