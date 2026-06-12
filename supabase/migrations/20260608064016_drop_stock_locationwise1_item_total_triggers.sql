-- PASPL Master — unblock direct stock_locationwise1 bulk sync.
--
-- stock_locationwise1 is the app-mapped duplicate table. Its legacy item-total
-- sync triggers call sync_item_stock_qty_from_locationwise_busy_codes(), which
-- recomputes items.stock_qty from public.stock_locationwise, not from
-- stock_locationwise1. On full stock_locationwise1 sync batches this extra work
-- times out with 57014 and blocks the write.
--
-- Keep public.stock_locationwise completely untouched. Only remove the
-- stock_locationwise1 item-total triggers that block bulk sync.

DROP TRIGGER IF EXISTS trg_stock_locationwise_sync_item_total_insert
  ON public.stock_locationwise1;

DROP TRIGGER IF EXISTS trg_stock_locationwise_sync_item_total_update
  ON public.stock_locationwise1;

DROP TRIGGER IF EXISTS trg_stock_locationwise_sync_item_total_delete
  ON public.stock_locationwise1;
