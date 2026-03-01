-- ============================================================
-- PASPL Master — Full Schema Migration
-- ============================================================

-- ─── app_config ─────────────────────────────────────────────
CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO app_config (key, value) VALUES ('access_code', '1234');

-- ─── items ──────────────────────────────────────────────────
CREATE TABLE items (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  alias TEXT,
  alias1 TEXT,
  parent_group TEXT,
  main_group TEXT,
  item_category TEXT,
  gst_percent NUMERIC(5,2) DEFAULT 18,
  hsn_code TEXT,
  sales_price NUMERIC(10,2) DEFAULT 0,
  mrp NUMERIC(10,2) DEFAULT 0,
  stock_qty NUMERIC(10,2) DEFAULT 0,
  rack_no TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_items_name ON items USING gin(to_tsvector('english', name));
CREATE INDEX idx_items_alias ON items(alias);
CREATE INDEX idx_items_alias1 ON items(alias1);
CREATE INDEX idx_items_main_group ON items(main_group);
CREATE INDEX idx_items_active ON items(is_active) WHERE is_active = true;

-- ─── customers ──────────────────────────────────────────────
CREATE TABLE customers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  address TEXT,
  mobile TEXT,
  parent_group TEXT,
  city TEXT,
  salesman TEXT,
  gstin TEXT,
  dealer_type TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_customers_city ON customers(city);
CREATE INDEX idx_customers_salesman ON customers(salesman);
CREATE INDEX idx_customers_active ON customers(is_active) WHERE is_active = true;

-- ─── transports ─────────────────────────────────────────────
CREATE TABLE transports (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT true
);

INSERT INTO transports (name) VALUES
  ('Om Sai Ram Transport'),
  ('Shree Maruti Courier'),
  ('VRL Logistics'),
  ('Gati Limited'),
  ('Safe Express'),
  ('Customer Pickup'),
  ('Company Vehicle'),
  ('DTDC Courier'),
  ('Professional Courier');

-- ─── orders ─────────────────────────────────────────────────
CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  customer_id BIGINT REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  customer_city TEXT,
  transport_id BIGINT REFERENCES transports(id),
  transport_name TEXT,
  salesperson_name TEXT NOT NULL,
  reviewer_name TEXT,
  picker_name TEXT,
  status TEXT NOT NULL DEFAULT 'submitted',
  priority TEXT NOT NULL DEFAULT 'normal',
  notes TEXT,
  item_count INTEGER DEFAULT 0,
  total_value NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  approved_at TIMESTAMPTZ,
  picked_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ
);

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_orders_salesperson ON orders(salesperson_name);

-- ─── order_items ────────────────────────────────────────────
CREATE TABLE order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE,
  item_id BIGINT REFERENCES items(id),
  item_name TEXT NOT NULL,
  item_alias TEXT,
  rack_no TEXT,
  qty_requested INTEGER NOT NULL,
  qty_approved INTEGER,
  price_quoted NUMERIC(10,2),
  price_system NUMERIC(10,2),
  state TEXT NOT NULL DEFAULT 'pending',
  flag_reason TEXT,
  flag_notes TEXT,
  scan_result JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_state ON order_items(state);

-- ─── upload_log ─────────────────────────────────────────────
CREATE TABLE upload_log (
  id BIGSERIAL PRIMARY KEY,
  file_type TEXT NOT NULL,
  file_name TEXT,
  uploaded_by TEXT,
  row_count INTEGER,
  new_count INTEGER DEFAULT 0,
  updated_count INTEGER DEFAULT 0,
  changes_summary JSONB,
  status TEXT DEFAULT 'completed',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── Auto-generate order numbers: PA-YYMMDD-XXXX ───────────
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TRIGGER AS $$
DECLARE
  today_prefix TEXT;
  seq INTEGER;
BEGIN
  today_prefix := 'PA-' || to_char(now(), 'YYMMDD');
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(order_number FROM '-(\d+)$') AS INTEGER)
  ), 0) + 1 INTO seq
  FROM orders
  WHERE order_number LIKE today_prefix || '-%';
  NEW.order_number := today_prefix || '-' || LPAD(seq::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_number
  BEFORE INSERT ON orders
  FOR EACH ROW
  WHEN (NEW.order_number IS NULL)
  EXECUTE FUNCTION generate_order_number();
