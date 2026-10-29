-- Phase 1: drop legacy anon RLS on sensitive tables only. No grant revokes.
-- Manual apply (migrations are not auto-applied on merge to main).

DO $$
DECLARE
  r record;
  targets text[] := ARRAY[
    'users', 'customers', 'ledger', 'sales', 'customersos', 'push_subscriptions'
  ];
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (targets)
      AND (
        policyname = 'legacy_anon_all'
        OR policyname LIKE '%_legacy_anon_all'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;
