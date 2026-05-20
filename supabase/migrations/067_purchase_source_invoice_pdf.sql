-- Extend purchase_orders.source to allow invoice-first PO scaffolding.

ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_source_check;

ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_source_check
  CHECK (source IN ('excel_upload', 'manual', 'invoice_pdf'));
