CREATE TABLE IF NOT EXISTS public.customer_ocr_shorthand (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES public.items(id),
  raw_phrase TEXT NOT NULL,
  normalized_phrase TEXT NOT NULL,
  hit_count INTEGER NOT NULL DEFAULT 1,
  last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, normalized_phrase)
);

CREATE INDEX IF NOT EXISTS idx_customer_ocr_shorthand_customer
  ON public.customer_ocr_shorthand(customer_id);

CREATE INDEX IF NOT EXISTS idx_customer_ocr_shorthand_item
  ON public.customer_ocr_shorthand(item_id);

COMMENT ON TABLE public.customer_ocr_shorthand IS
  'Customer-specific OCR learning: maps confirmed handwritten phrases to catalog items for future scan ranking.';
