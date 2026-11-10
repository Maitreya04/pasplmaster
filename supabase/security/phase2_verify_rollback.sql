-- Phase 2 verify. Expect no legacy/open anon policies (partner_companies_anon_read ok).
SELECT tablename, policyname FROM pg_policies
WHERE schemaname = 'public'
  AND (policyname = 'legacy_anon_all' OR policyname LIKE '%_legacy_anon_all' OR policyname LIKE '%_anon_all')
  AND policyname <> 'partner_companies_anon_read';

BEGIN; SET LOCAL ROLE anon;
SELECT 'orders' t, count(*) n FROM public.orders
UNION ALL SELECT 'items', count(*) FROM public.items
UNION ALL SELECT 'purchase_orders', count(*) FROM public.purchase_orders;
ROLLBACK;

-- After 2d: expect false / false
SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='is_legacy_anon_session') AS helper_exists,
  has_table_privilege('anon','public.orders','SELECT') AS anon_orders_select;

-- Rollback: re-run scripts/export-anon-policies.sql output captured before apply.
-- If 2d ran, restore is_legacy_anon_session from migration 128, then re-grant tables to anon.
