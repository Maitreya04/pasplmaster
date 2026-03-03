-- ─── Sales history aggregates ─────────────────────────────────
-- Run this in Supabase (or via migration runner) before using
-- the sales history upload.

CREATE TABLE IF NOT EXISTS public.customer_top_items (
  id BIGSERIAL PRIMARY KEY,
  customer_name TEXT NOT NULL,
  item_name TEXT NOT NULL,
  total_qty NUMERIC(14,2) NOT NULL DEFAULT 0,
  order_count INTEGER NOT NULL DEFAULT 0,
  avg_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
  most_common_qty NUMERIC(14,2),
  last_ordered DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (customer_name, item_name)
);

CREATE INDEX IF NOT EXISTS idx_customer_top_items_customer
  ON public.customer_top_items(customer_name);

CREATE INDEX IF NOT EXISTS idx_customer_top_items_item
  ON public.customer_top_items(item_name);


CREATE TABLE IF NOT EXISTS public.salesperson_top_customers (
  id BIGSERIAL PRIMARY KEY,
  salesperson_name TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  order_count INTEGER NOT NULL DEFAULT 0,
  total_value NUMERIC(16,2) NOT NULL DEFAULT 0,
  last_order_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (salesperson_name, customer_name)
);

CREATE INDEX IF NOT EXISTS idx_salesperson_top_customers_salesperson
  ON public.salesperson_top_customers(salesperson_name);

CREATE INDEX IF NOT EXISTS idx_salesperson_top_customers_customer
  ON public.salesperson_top_customers(customer_name);

