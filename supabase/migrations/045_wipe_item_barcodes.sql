-- One-time wipe of manufacturer barcode mappings before re-import with canonical OEM keys.
-- Safe to re-run on an empty table.

TRUNCATE TABLE public.item_barcodes;
