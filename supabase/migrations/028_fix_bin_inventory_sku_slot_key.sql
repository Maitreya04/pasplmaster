-- PASPL Master — Correct bin inventory identity to rack + SKU.
--
-- This is a repair migration for environments where migration 027 was already
-- run when bin_inventory was still keyed by bin_id alone. Operationally, one
-- physical rack/shelf can hold multiple SKU slots, and each SKU slot needs its
-- own composition counts.

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  -- Old 027 had supplier_variances.bin_id referencing bin_inventory(bin_id).
  -- That FK cannot exist once bin_inventory is keyed by (bin_id, sku_busy_code).
  FOR v_constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.supplier_variances'::regclass
      AND confrelid = 'public.bin_inventory'::regclass
      AND contype = 'f'
  LOOP
    EXECUTE format('ALTER TABLE public.supplier_variances DROP CONSTRAINT %I', v_constraint_name);
  END LOOP;

  -- Replace any existing primary key with the corrected composite key.
  SELECT conname
  INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.bin_inventory'::regclass
    AND contype = 'p'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.bin_inventory DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  ALTER TABLE public.bin_inventory
    ADD CONSTRAINT bin_inventory_pkey PRIMARY KEY (bin_id, sku_busy_code);
END;
$$;

CREATE INDEX IF NOT EXISTS idx_bin_inventory_bin_id
  ON public.bin_inventory(bin_id);
