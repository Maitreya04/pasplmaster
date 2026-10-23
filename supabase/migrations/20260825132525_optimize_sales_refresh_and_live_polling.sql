-- The recent-sales refresh previously parsed every VchDate in the full sales
-- table every three minutes. The immutable parser already used by the refresh
-- is safe to index, so make the two-day filter indexable first.
CREATE INDEX IF NOT EXISTS idx_sales_busy_sales_date
  ON public.sales (public.busy_sales_date("VchDate"));

ANALYZE public.sales;

-- Sales data is imported in batches; a 15-minute window keeps the dashboard
-- fresh while avoiding 480 full refresh attempts per day.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'refresh-recent-sales-achievement'
  ) THEN
    PERFORM cron.alter_job(
      job_id := (
        SELECT jobid
        FROM cron.job
        WHERE jobname = 'refresh-recent-sales-achievement'
      ),
      schedule := '*/15 * * * *'
    );
  END IF;
END;
$$;
