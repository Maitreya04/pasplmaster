-- Keep user_notifications inbox queries fast:
--   • prune old rows (read > 90d, any row > 180d)
--   • refresh planner stats after bulk deletes
--
-- Schedule weekly via Supabase Dashboard → Database → Cron, e.g.:
--   SELECT public.prune_user_notifications();

CREATE OR REPLACE FUNCTION public.prune_user_notifications(
  p_read_retention_days integer DEFAULT 90,
  p_unread_retention_days integer DEFAULT 180
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.user_notifications
  WHERE (
      read_at IS NOT NULL
      AND created_at < now() - make_interval(days => p_read_retention_days)
    )
    OR created_at < now() - make_interval(days => p_unread_retention_days);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 THEN
    ANALYZE public.user_notifications;
  END IF;

  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.prune_user_notifications(integer, integer) IS
  'Deletes stale inbox rows. Run on a schedule (pg_cron / Supabase Cron) to keep user_notifications scans cache-hot.';

REVOKE ALL ON FUNCTION public.prune_user_notifications(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_user_notifications(integer, integer) TO service_role;
