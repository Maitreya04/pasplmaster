-- Ensure order inserts/updates are broadcast over Supabase Realtime.
-- The UI already subscribes to `orders`, but without publication membership
-- Postgres changes on that table never reach the client.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;
END
$$;
