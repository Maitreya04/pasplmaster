SELECT
  has_function_privilege('anon', 'public.apply_erp_items_delta(jsonb, text, jsonb)', 'EXECUTE') AS anon_erp,
  has_function_privilege('anon', 'public.list_users_for_pin_reset()', 'EXECUTE') AS list_reset,
  has_function_privilege('anon', 'public.generate_self_service_reset_code(bigint, text)', 'EXECUTE') AS gen_reset,
  has_function_privilege('anon', 'public.list_pending_onboarding_users()', 'EXECUTE') AS list_onboard,
  has_function_privilege('anon', 'public.generate_self_service_invite_code(bigint)', 'EXECUTE') AS gen_invite,
  has_function_privilege('service_role', 'public.apply_erp_items_delta(jsonb, text, jsonb)', 'EXECUTE') AS service_erp;

SELECT count(*)::int AS anon_exec_funcs
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE');
