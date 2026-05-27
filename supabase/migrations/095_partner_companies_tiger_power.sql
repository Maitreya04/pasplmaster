-- Partner portal: Tiger Power (+ ensure TAFE row exists on envs that skipped seed)

INSERT INTO partner_companies (display_name, brand_keys)
SELECT 'Tiger Power', ARRAY['TIGER POWER', 'TIGER']
WHERE NOT EXISTS (
  SELECT 1 FROM partner_companies WHERE display_name = 'Tiger Power'
);

INSERT INTO partner_companies (display_name, brand_keys)
SELECT 'TAFE', ARRAY['TAFE']
WHERE NOT EXISTS (
  SELECT 1 FROM partner_companies WHERE display_name = 'TAFE'
);

-- Keep brand keys in sync if row was added manually without keys
UPDATE partner_companies
SET brand_keys = ARRAY['TIGER POWER', 'TIGER']
WHERE display_name = 'Tiger Power'
  AND brand_keys IS DISTINCT FROM ARRAY['TIGER POWER', 'TIGER'];

UPDATE partner_companies
SET brand_keys = ARRAY['TAFE'], is_active = true
WHERE display_name = 'TAFE';
