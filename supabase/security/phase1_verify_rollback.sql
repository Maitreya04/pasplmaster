-- Phase 1 verify (expect 0 rows) + rollback snippet.
-- Verify:
SELECT tablename, policyname FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('users','customers','ledger','sales','customersos','push_subscriptions')
  AND (policyname = 'legacy_anon_all' OR policyname LIKE '%_legacy_anon_all');

BEGIN; SET LOCAL ROLE anon;
SELECT 'users' t, count(*) n FROM public.users
UNION ALL SELECT 'customers', count(*) FROM public.customers
UNION ALL SELECT 'ledger', count(*) FROM public.ledger
UNION ALL SELECT 'sales', count(*) FROM public.sales
UNION ALL SELECT 'customersos', count(*) FROM public.customersos
UNION ALL SELECT 'push_subscriptions', count(*) FROM public.push_subscriptions;
ROLLBACK;

SELECT id, status, started_at, completed_at FROM public.sales_achievement_refresh_runs ORDER BY id DESC LIMIT 3;
SELECT max(updated_at) AS latest_items_updated_at FROM public.items;

-- Rollback (requires is_legacy_anon_session still present):
-- DO $$ DECLARE t text; BEGIN
--   FOREACH t IN ARRAY ARRAY['users','customers','ledger','sales','customersos'] LOOP
--     EXECUTE format('DROP POLICY IF EXISTS legacy_anon_all ON public.%I; CREATE POLICY legacy_anon_all ON public.%I FOR ALL TO anon USING (public.is_legacy_anon_session()) WITH CHECK (public.is_legacy_anon_session())', t, t);
--   END LOOP;
--   DROP POLICY IF EXISTS push_subscriptions_legacy_anon_all ON public.push_subscriptions;
--   CREATE POLICY push_subscriptions_legacy_anon_all ON public.push_subscriptions FOR ALL TO anon USING (public.is_legacy_anon_session()) WITH CHECK (public.is_legacy_anon_session());
-- END $$;
