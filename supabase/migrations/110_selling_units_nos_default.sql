-- Replace Piece with Nos on gasket kits; keep kit/set EA multipliers.

UPDATE public.items
SET sales_selling_units = '[
  {"id":"kit","label":"Kit","busy_unit":"Kit","ea_multiplier":1},
  {"id":"set","label":"Set","busy_unit":"Set","ea_multiplier":4},
  {"id":"nos","label":"Nos","busy_unit":"Nos","ea_multiplier":0.25}
]'::jsonb
WHERE name ~* '^KIT '
  AND sales_selling_units IS NOT NULL;
