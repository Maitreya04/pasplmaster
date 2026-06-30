-- orders.customer_id still pointed at legacy public.customers1 while the app uses
-- Busy-synced public.customers (different ids for the same party names).
-- Example: Nousad Auto Parts is id 6489 in customers but missing from customers1.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.customers'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (id)'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_id_key UNIQUE (id);
  END IF;
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conrelid::regclass AS tbl, conname
    FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid = 'public.customers1'::regclass
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL
  NOT VALID;

ALTER TABLE public.pending_items
  ADD CONSTRAINT pending_items_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL
  NOT VALID;

ALTER TABLE public.sales_order_shortages
  ADD CONSTRAINT sales_order_shortages_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL
  NOT VALID;
