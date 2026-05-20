-- PASPL — Receiving / Label Studio Phase 1 (A): extend pack definitions for FPQ + sell_unit;
-- relax inner/outer qty checks to allow 1 (loose / single-pack edge cases).

ALTER TABLE public.item_pack_definitions
  DROP CONSTRAINT IF EXISTS item_pack_definitions_inner_reasonable;

ALTER TABLE public.item_pack_definitions
  DROP CONSTRAINT IF EXISTS item_pack_definitions_outer_reasonable;

ALTER TABLE public.item_pack_definitions
  ADD CONSTRAINT item_pack_definitions_inner_reasonable
  CHECK (inner_pack_qty IS NULL OR inner_pack_qty >= 1);

ALTER TABLE public.item_pack_definitions
  ADD CONSTRAINT item_pack_definitions_outer_reasonable
  CHECK (outer_pack_qty IS NULL OR outer_pack_qty >= 1);

ALTER TABLE public.item_pack_definitions
  ADD COLUMN IF NOT EXISTS bin_forward_pick_qty INTEGER
  CHECK (bin_forward_pick_qty IS NULL OR bin_forward_pick_qty >= 1);

ALTER TABLE public.item_pack_definitions
  ADD COLUMN IF NOT EXISTS sell_unit TEXT NOT NULL DEFAULT 'EACH'
    CHECK (sell_unit IN ('EACH', 'PACK', 'BOTH'));

ALTER TABLE public.item_pack_definitions
  ADD COLUMN IF NOT EXISTS supplier_type TEXT
    CHECK (supplier_type IS NULL OR supplier_type IN ('VARROC', 'TAFE', 'OTHER'));

COMMENT ON COLUMN public.item_pack_definitions.bin_forward_pick_qty IS 'Forward pick qty (eaches) shown on BIN label; live bin qty stays in bin_inventory.';
COMMENT ON COLUMN public.item_pack_definitions.sell_unit IS 'PASPL sell mode: EACH/PACK/BOTH — controls each-label generation on inner break (distinct from items.selling_unit UoM preference).';
COMMENT ON COLUMN public.item_pack_definitions.supplier_type IS 'Nominal supplier classification for label pre-print tie-break with item_barcodes.manufacturer.';
