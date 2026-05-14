-- Confirm production user-to-stock-location mappings after enabling
-- location-wise sellable stock.

INSERT INTO public.users (full_name, role, is_active, stock_location_code)
VALUES
  ('Ashok', 'billing', true, 'jabalpur'),
  ('Sachin Rathore', 'billing', true, 'main_store'),
  ('Harsh', 'picking', true, 'main_store')
ON CONFLICT (full_name) DO UPDATE
SET role = EXCLUDED.role,
    is_active = true,
    stock_location_code = EXCLUDED.stock_location_code;

UPDATE public.users
SET role = 'sales',
    is_active = true,
    stock_location_code = 'main_store'
WHERE lower(regexp_replace(coalesce(trim(full_name), ''), '[^a-z0-9]+', '', 'g')) = 'guddu';

UPDATE public.users
SET is_active = true,
    stock_location_code = 'jabalpur'
WHERE role = 'sales'
  AND lower(regexp_replace(coalesce(trim(full_name), ''), '[^a-z0-9]+', '', 'g')) IN (
    'hardeep',
    'hardeepsingh',
    'anandawasthi',
    'awasthi',
    'manish',
    'manishsharma',
    'shahank',
    'shashank'
  );

UPDATE public.users
SET is_active = true,
    stock_location_code = 'jabalpur'
WHERE role = 'billing'
  AND lower(regexp_replace(coalesce(trim(full_name), ''), '[^a-z0-9]+', '', 'g')) = 'ashok';

UPDATE public.users
SET is_active = true,
    stock_location_code = 'main_store'
WHERE lower(regexp_replace(coalesce(trim(full_name), ''), '[^a-z0-9]+', '', 'g')) IN (
  'rehan',
  'rehanmultani',
  'shreeramsharma',
  'shriramsharma',
  'mahendrarajput',
  'sachinrao',
  'pankaj',
  'pankajmeena',
  'raju',
  'rajuji',
  'hemant',
  'mankar',
  'asad',
  'asadkhan',
  'kamlakar',
  'neeraj',
  'satish',
  'deepakyogi',
  'govind',
  'neetu',
  'sachinrathore',
  'shankar',
  'abhishek',
  'dharmendra',
  'harsh'
);
