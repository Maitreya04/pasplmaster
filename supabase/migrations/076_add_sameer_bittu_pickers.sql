-- Add Sameer and Bittu to the picking team (matches PICKER_NAMES in constants.ts).

INSERT INTO public.users (full_name, role, is_active, stock_location_code)
VALUES
  ('Sameer', 'picking', true, 'main_store'),
  ('Bittu', 'picking', true, 'main_store')
ON CONFLICT (full_name) DO UPDATE
SET role = EXCLUDED.role,
    is_active = true,
    stock_location_code = EXCLUDED.stock_location_code;
