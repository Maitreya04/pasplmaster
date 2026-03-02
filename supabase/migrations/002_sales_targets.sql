-- ─── sales_targets ───────────────────────────────────────────
-- Run this in Supabase Dashboard → SQL Editor if table doesn't exist
CREATE TABLE IF NOT EXISTS public.sales_targets (
  id BIGSERIAL PRIMARY KEY,
  salesperson_name TEXT NOT NULL,
  product_group TEXT NOT NULL,
  year TEXT NOT NULL,
  annual_target_lakhs NUMERIC(12,2) NOT NULL DEFAULT 0,
  category TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(salesperson_name, product_group, year)
);

CREATE INDEX IF NOT EXISTS idx_sales_targets_salesperson ON public.sales_targets(salesperson_name);
CREATE INDEX IF NOT EXISTS idx_sales_targets_year ON public.sales_targets(year);
