-- PASPL Master — Items realtime + reliable updated_at
--
-- Goal: make the client switch from full-table polling of `items`
-- to (a) an initial snapshot + IndexedDB cache, (b) `updated_at`
-- watermark deltas, and (c) Supabase Realtime for sub-second updates.
--
-- Two server-side pieces are required:
--   1. A BEFORE UPDATE trigger on items that always sets updated_at = now().
--      Without it, upstream stock-sync paths can change stock_qty without
--      bumping updated_at, which made an earlier delta-sync attempt miss
--      stock changes (see commit 3dd5791 / 356d8e38).
--   2. items + work_claims added to the supabase_realtime publication so
--      postgres_changes events reach the browser. orders, order_items,
--      and user_notifications are already members (migrations 007 + 014).
--
-- Idempotent — safe to re-run.

CREATE OR REPLACE FUNCTION set_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_items_set_updated_at ON public.items;

CREATE TRIGGER trg_items_set_updated_at
  BEFORE UPDATE ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION set_items_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.items;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'work_claims'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.work_claims;
  END IF;
END
$$;
