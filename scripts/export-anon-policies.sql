-- Generate re-runnable DROP+CREATE for all public anon/legacy RLS policies.
-- Run before Phase 1/2; save output as rollback. Manual apply only (no CI migrate).

SELECT format(
  E'DROP POLICY IF EXISTS %I ON public.%I;\nCREATE POLICY %I ON public.%I FOR %s TO %s USING (%s)%s;',
  policyname, tablename, policyname, tablename, cmd, array_to_string(roles, ', '), qual,
  CASE WHEN with_check IS NULL THEN '' ELSE format(' WITH CHECK (%s)', with_check) END
) AS recreate_sql
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    'anon' = ANY (roles)
    OR policyname ~* '(anon|legacy)'
    OR coalesce(qual, '') LIKE '%is_legacy_anon_session%'
    OR coalesce(with_check, '') LIKE '%is_legacy_anon_session%'
  )
ORDER BY tablename, policyname;
