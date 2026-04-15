-- ============================================================
-- Team user configuration — 2026-04-14
-- ============================================================
--
-- WHAT THIS DOES
--   1. Normalizes a few existing legacy sales names to the new labels
--   2. Upserts the confirmed Billing + Sales roster
--   3. Moves Guddu from picking -> sales
--   4. Deactivates sales/billing users who are no longer on those teams
--
-- NOTES
--   - `users.full_name` is globally UNIQUE, so one exact name can only
--     belong to one role at a time.
--   - Existing billing station labels are preserved where known.
--   - This script intentionally does NOT deactivate the remaining pickers.
--   - If you want historical orders to follow renamed salespeople
--     (e.g. `Raju Ji` -> `Raju`), update legacy order data separately.
--
-- RUN
--   Execute in the Supabase SQL Editor or with psql.
--
-- ============================================================

BEGIN;

-- 1) Normalize existing legacy names to the confirmed labels.
UPDATE users
SET full_name = 'Raju'
WHERE role = 'sales'
  AND full_name = 'Raju Ji'
  AND NOT EXISTS (
    SELECT 1 FROM users u2 WHERE u2.full_name = 'Raju'
  );

UPDATE users
SET full_name = 'Asad'
WHERE role = 'sales'
  AND full_name = 'Asad Khan'
  AND NOT EXISTS (
    SELECT 1 FROM users u2 WHERE u2.full_name = 'Asad'
  );

UPDATE users
SET full_name = 'Manish'
WHERE role = 'sales'
  AND full_name = 'Manish Sharma'
  AND NOT EXISTS (
    SELECT 1 FROM users u2 WHERE u2.full_name = 'Manish'
  );

UPDATE users
SET full_name = 'Hardeep'
WHERE role = 'sales'
  AND full_name = 'Hardeep Singh'
  AND NOT EXISTS (
    SELECT 1 FROM users u2 WHERE u2.full_name = 'Hardeep'
  );

UPDATE users
SET full_name = 'Awasthi'
WHERE role = 'sales'
  AND full_name = 'Anand Awasthi'
  AND NOT EXISTS (
    SELECT 1 FROM users u2 WHERE u2.full_name = 'Awasthi'
  );

-- 2) Move Guddu to sales.
UPDATE users
SET role = 'sales',
    station_label = NULL,
    is_active = true
WHERE full_name = 'Guddu';

-- 3) Upsert the confirmed billing team.
WITH desired_billing(full_name, role, station_label) AS (
  VALUES
    ('Kamlakar', 'billing', 'Station 4'),
    ('Govind', 'billing', 'Station 1'),
    ('Deepak Yogi', 'billing', 'Station 2'),
    ('Neetu', 'billing', 'Station 3'),
    ('Ashok', 'billing', NULL)
)
INSERT INTO users (full_name, role, station_label, is_active)
SELECT full_name, role, station_label, true
FROM desired_billing
ON CONFLICT (full_name) DO UPDATE
SET role = EXCLUDED.role,
    is_active = true,
    station_label = COALESCE(EXCLUDED.station_label, users.station_label);

-- 4) Upsert the confirmed sales team.
WITH desired_sales(full_name, role, station_label) AS (
  VALUES
    ('Satish', 'sales', NULL),
    ('Hemant', 'sales', NULL),
    ('Rohan', 'sales', NULL),
    ('Raju', 'sales', NULL),
    ('Guddu', 'sales', NULL),
    ('Mankar', 'sales', NULL),
    ('Mahendra Rajput', 'sales', NULL),
    ('Sachin Rao', 'sales', NULL),
    ('Pankaj', 'sales', NULL),
    ('Direct', 'sales', NULL),
    ('Neeraj', 'sales', NULL),
    ('Asad', 'sales', NULL),
    ('Manish', 'sales', NULL),
    ('Hardeep', 'sales', NULL),
    ('Shashank', 'sales', NULL),
    ('Awasthi', 'sales', NULL)
)
INSERT INTO users (full_name, role, station_label, is_active)
SELECT full_name, role, station_label, true
FROM desired_sales
ON CONFLICT (full_name) DO UPDATE
SET role = EXCLUDED.role,
    is_active = true,
    station_label = NULL;

-- 5) Deactivate billing users not in the confirmed roster.
UPDATE users
SET is_active = false
WHERE role = 'billing'
  AND full_name NOT IN (
    'Kamlakar',
    'Govind',
    'Deepak Yogi',
    'Neetu',
    'Ashok'
  );

-- 6) Deactivate sales users not in the confirmed roster.
UPDATE users
SET is_active = false
WHERE role = 'sales'
  AND full_name NOT IN (
    'Satish',
    'Hemant',
    'Rohan',
    'Raju',
    'Guddu',
    'Mankar',
    'Mahendra Rajput',
    'Sachin Rao',
    'Pankaj',
    'Direct',
    'Neeraj',
    'Asad',
    'Manish',
    'Hardeep',
    'Shashank',
    'Awasthi'
  );

COMMIT;
