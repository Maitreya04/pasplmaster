-- OEM company representatives: brand-scoped supply demand portal
CREATE TABLE IF NOT EXISTS partner_companies (
  id           serial PRIMARY KEY,
  display_name text NOT NULL,
  brand_keys   text[] NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_companies_active ON partner_companies (is_active) WHERE is_active = true;

ALTER TABLE partner_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY partner_companies_anon_read ON partner_companies
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

INSERT INTO partner_companies (display_name, brand_keys) VALUES
  ('TAFE', ARRAY['TAFE']),
  ('Lucas', ARRAY['LUCAS', 'LUCAS TVS']),
  ('Varroc', ARRAY['VARROC']);
