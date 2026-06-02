-- Seed kit/set/piece sales units for gasket kit SKUs (name starts with "KIT ").
-- Adjust ea_multiplier values per SKU if pack hierarchy differs.

UPDATE public.items
SET sales_selling_units = '[
  {"id":"kit","label":"Kit","busy_unit":"Kit","ea_multiplier":1},
  {"id":"set","label":"Set","busy_unit":"Set","ea_multiplier":4},
  {"id":"piece","label":"Piece","busy_unit":"Pcs","ea_multiplier":0.25}
]'::jsonb
WHERE sales_selling_units IS NULL
  AND name ~* '^KIT ';
