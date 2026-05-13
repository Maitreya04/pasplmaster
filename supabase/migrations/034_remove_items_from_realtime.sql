-- PASPL Master — remove high-volume item catalog from Supabase Realtime
--
-- Stock freshness now uses a 30s `updated_at` watermark poll in `useItems`.
-- Keeping `items` in the realtime publication makes bulk stock/price imports
-- fan out one message per changed row per connected browser, which can burn
-- through the Free Realtime quota in a single import day.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'items'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.items;
  END IF;
END $$;

