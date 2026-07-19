-- Supabase's API privilege hook grants public-schema functions to API roles.
-- Keep this privileged registration endpoint authenticated-only.
REVOKE EXECUTE ON FUNCTION public.sync_push_subscription(TEXT, TEXT, TEXT, TEXT) FROM anon;
