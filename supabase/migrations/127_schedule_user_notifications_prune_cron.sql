-- Weekly inbox prune (Sundays 03:00 UTC). No-op if pg_cron is not enabled on the project.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'prune-user-notifications';

    PERFORM cron.schedule(
      'prune-user-notifications',
      '0 3 * * 0',
      $cron$SELECT public.prune_user_notifications();$cron$
    );
  END IF;
END $$;
