-- Add Deepak Sharma to the sales team (Indore / main_store stock location).

INSERT INTO public.users (full_name, role, is_active, stock_location_code)
VALUES ('Deepak Sharma', 'sales', true, 'main_store')
ON CONFLICT (full_name) DO UPDATE
SET role = 'sales',
    is_active = true,
    stock_location_code = 'main_store',
    station_label = NULL;

-- Retire the legacy short name so role select does not show two Deepaks.
UPDATE public.users
SET is_active = false
WHERE role = 'sales'
  AND full_name = 'Deepak';
