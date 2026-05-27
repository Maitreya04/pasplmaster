-- Warehouse pick-issue audit fields on pending_items (billing desk flag resolution)

ALTER TABLE public.pending_items
  ADD COLUMN IF NOT EXISTS issue_category TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

CREATE INDEX IF NOT EXISTS idx_pending_items_issue_audit
  ON public.pending_items (issue_category, reviewed_at)
  WHERE status = 'pending' AND issue_category IS NOT NULL;

COMMENT ON COLUMN public.pending_items.issue_category IS
  'Pick/billing issue type for warehouse audit: out_of_stock, cant_find, wrong_part, damaged, other, unknown';
