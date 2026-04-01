-- Replace placeholder billing users with the real billing team names.
-- We keep station labels stable so any station-oriented UI can continue working.

UPDATE users
SET full_name = 'Govind'
WHERE role = 'billing' AND full_name = 'Billing 1';

UPDATE users
SET full_name = 'Deepak Yogi'
WHERE role = 'billing' AND full_name = 'Billing 2';

UPDATE users
SET full_name = 'Neetu'
WHERE role = 'billing' AND full_name = 'Billing 3';

UPDATE users
SET full_name = 'Kamlakar'
WHERE role = 'billing' AND full_name = 'Billing 4';

INSERT INTO users (full_name, role, station_label)
SELECT 'Govind', 'billing', 'Station 1'
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE full_name = 'Govind' AND role = 'billing'
);

INSERT INTO users (full_name, role, station_label)
SELECT 'Deepak Yogi', 'billing', 'Station 2'
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE full_name = 'Deepak Yogi' AND role = 'billing'
);

INSERT INTO users (full_name, role, station_label)
SELECT 'Neetu', 'billing', 'Station 3'
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE full_name = 'Neetu' AND role = 'billing'
);

INSERT INTO users (full_name, role, station_label)
SELECT 'Kamlakar', 'billing', 'Station 4'
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE full_name = 'Kamlakar' AND role = 'billing'
);
