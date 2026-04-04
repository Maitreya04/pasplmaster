-- Split customer line into shippable-from-stock vs purchase-order / back-order quantities.
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS qty_shippable integer,
  ADD COLUMN IF NOT EXISTS qty_po integer;

UPDATE order_items
SET
  qty_shippable = COALESCE(qty_shippable, qty_requested),
  qty_po = COALESCE(qty_po, 0)
WHERE qty_shippable IS NULL OR qty_po IS NULL;

ALTER TABLE order_items
  ALTER COLUMN qty_shippable SET NOT NULL,
  ALTER COLUMN qty_po SET NOT NULL;

-- Safe to re-run: constraint may already exist from a prior apply.
DO $c$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'order_items_ship_po_reasonable'
      AND conrelid = 'public.order_items'::regclass
  ) THEN
    ALTER TABLE order_items
      ADD CONSTRAINT order_items_ship_po_reasonable CHECK (
        qty_shippable >= 0
        AND qty_po >= 0
        AND qty_shippable <= qty_requested
        AND (qty_shippable + qty_po) >= qty_requested
      );
  END IF;
END;
$c$;
