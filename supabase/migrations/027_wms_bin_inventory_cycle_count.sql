-- PASPL Master — WMS bin composition, cycle count, and LPN hierarchy.
-- This layer is PASPL-owned warehouse state. The Busy/MSSQL-synced items table
-- remains the catalog and aggregate stock source of truth.

ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS parent_lp_id BIGINT REFERENCES public.license_plates(id) ON DELETE SET NULL;

ALTER TABLE public.license_plates
  DROP CONSTRAINT IF EXISTS license_plates_parent_not_self;

ALTER TABLE public.license_plates
  ADD CONSTRAINT license_plates_parent_not_self
  CHECK (parent_lp_id IS NULL OR parent_lp_id <> id);

ALTER TABLE public.order_item_pick_scans
  ADD COLUMN IF NOT EXISTS bin_id TEXT;

CREATE TABLE IF NOT EXISTS public.bin_inventory (
  bin_id TEXT NOT NULL,
  sku_busy_code NUMERIC NOT NULL,
  item_id_snapshot BIGINT,
  item_name_snapshot TEXT,
  inner_packs INTEGER NOT NULL DEFAULT 0 CHECK (inner_packs >= 0),
  loose_ea_qty INTEGER NOT NULL DEFAULT 0 CHECK (loose_ea_qty >= 0),
  inner_pack_qty INTEGER NOT NULL DEFAULT 25 CHECK (inner_pack_qty > 0),
  total_qty INTEGER GENERATED ALWAYS AS ((inner_packs * inner_pack_qty) + loose_ea_qty) STORED,
  reorder_point INTEGER CHECK (reorder_point IS NULL OR reorder_point >= 0),
  daily_target INTEGER CHECK (daily_target IS NULL OR daily_target >= 0),
  status TEXT NOT NULL DEFAULT 'healthy'
    CHECK (status IN ('healthy', 'low', 'empty', 'pending_review', 'inactive')),
  last_counted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bin_id, sku_busy_code)
);

CREATE TABLE IF NOT EXISTS public.bin_count_logs (
  id BIGSERIAL PRIMARY KEY,
  bin_id TEXT NOT NULL,
  count_type TEXT NOT NULL DEFAULT 'cycle_count'
    CHECK (count_type IN ('initial_setup', 'cycle_count', 'adjustment')),
  sku_busy_code NUMERIC NOT NULL,
  item_id_snapshot BIGINT,
  item_name_snapshot TEXT,
  expected_inner_packs INTEGER NOT NULL DEFAULT 0 CHECK (expected_inner_packs >= 0),
  expected_loose_ea_qty INTEGER NOT NULL DEFAULT 0 CHECK (expected_loose_ea_qty >= 0),
  counted_inner_packs INTEGER NOT NULL CHECK (counted_inner_packs >= 0),
  counted_loose_ea_qty INTEGER NOT NULL CHECK (counted_loose_ea_qty >= 0),
  inner_pack_qty INTEGER NOT NULL DEFAULT 25 CHECK (inner_pack_qty > 0),
  variance_inner_packs INTEGER GENERATED ALWAYS AS (counted_inner_packs - expected_inner_packs) STORED,
  variance_loose_ea_qty INTEGER GENERATED ALWAYS AS (counted_loose_ea_qty - expected_loose_ea_qty) STORED,
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('auto_approved', 'pending_review', 'approved', 'rejected')),
  note TEXT,
  source_file TEXT,
  created_by_user_id BIGINT,
  created_by_name TEXT,
  reviewed_by_user_id BIGINT,
  reviewed_by_name TEXT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_variances (
  id BIGSERIAL PRIMARY KEY,
  busy_code NUMERIC NOT NULL,
  item_id_snapshot BIGINT,
  item_name_snapshot TEXT,
  lpn_id BIGINT REFERENCES public.license_plates(id) ON DELETE SET NULL,
  bin_id TEXT,
  expected_qty INTEGER NOT NULL CHECK (expected_qty >= 0),
  actual_qty INTEGER NOT NULL CHECK (actual_qty >= 0),
  variance_qty INTEGER GENERATED ALWAYS AS (actual_qty - expected_qty) STORED,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'credited', 'closed')),
  reported_by_user_id BIGINT,
  reported_by_name TEXT,
  reviewed_by_user_id BIGINT,
  reviewed_by_name TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_license_plates_parent_lp_id
  ON public.license_plates(parent_lp_id);
CREATE INDEX IF NOT EXISTS idx_order_item_pick_scans_bin_id
  ON public.order_item_pick_scans(bin_id);
CREATE INDEX IF NOT EXISTS idx_bin_inventory_sku_busy_code
  ON public.bin_inventory(sku_busy_code);
CREATE INDEX IF NOT EXISTS idx_bin_inventory_bin_id
  ON public.bin_inventory(bin_id);
CREATE INDEX IF NOT EXISTS idx_bin_inventory_status
  ON public.bin_inventory(status);
CREATE INDEX IF NOT EXISTS idx_bin_count_logs_bin_created
  ON public.bin_count_logs(bin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bin_count_logs_status
  ON public.bin_count_logs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_variances_busy_code
  ON public.supplier_variances(busy_code, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_bin_inventory_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bin_inventory_updated_at ON public.bin_inventory;
CREATE TRIGGER trg_bin_inventory_updated_at
  BEFORE UPDATE ON public.bin_inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.set_bin_inventory_updated_at();

CREATE OR REPLACE FUNCTION public.wms_bin_status(
  p_inner_packs INTEGER,
  p_loose_ea_qty INTEGER,
  p_reorder_point INTEGER
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(p_inner_packs, 0) = 0 AND COALESCE(p_loose_ea_qty, 0) = 0 THEN 'empty'
    WHEN p_reorder_point IS NOT NULL AND COALESCE(p_loose_ea_qty, 0) <= p_reorder_point THEN 'low'
    ELSE 'healthy'
  END;
$$;

CREATE OR REPLACE FUNCTION public.wms_item_snapshot(p_busy_code NUMERIC)
RETURNS TABLE(item_id_snapshot BIGINT, item_name_snapshot TEXT)
LANGUAGE sql
STABLE
AS $$
  SELECT i.id, i.name
  FROM public.items i
  WHERE i.busy_code::NUMERIC = p_busy_code
  ORDER BY i.id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.submit_bin_count(
  p_bin_id TEXT,
  p_sku_busy_code NUMERIC,
  p_inner_packs INTEGER,
  p_loose_ea_qty INTEGER,
  p_inner_pack_qty INTEGER DEFAULT 25,
  p_daily_target INTEGER DEFAULT NULL,
  p_reorder_point INTEGER DEFAULT NULL,
  p_count_type TEXT DEFAULT 'cycle_count',
  p_user_id BIGINT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bin_id TEXT := upper(trim(coalesce(p_bin_id, '')));
  v_existing public.bin_inventory%ROWTYPE;
  v_item_id BIGINT;
  v_item_name TEXT;
  v_has_existing BOOLEAN := false;
  v_expected_inner INTEGER := 0;
  v_expected_loose INTEGER := 0;
  v_status TEXT;
  v_log_id BIGINT;
  v_auto_approved BOOLEAN;
BEGIN
  IF v_bin_id = '' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'bin_id is required');
  END IF;

  IF p_sku_busy_code IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'sku_busy_code is required');
  END IF;

  IF COALESCE(p_inner_packs, -1) < 0 OR COALESCE(p_loose_ea_qty, -1) < 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Counts cannot be negative');
  END IF;

  IF COALESCE(p_inner_pack_qty, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'inner_pack_qty must be greater than zero');
  END IF;

  SELECT * INTO v_existing
  FROM public.bin_inventory
  WHERE bin_id = v_bin_id
    AND sku_busy_code = p_sku_busy_code
  FOR UPDATE;
  v_has_existing := FOUND;

  IF v_has_existing THEN
    v_expected_inner := v_existing.inner_packs;
    v_expected_loose := v_existing.loose_ea_qty;
  END IF;

  SELECT item_id_snapshot, item_name_snapshot
  INTO v_item_id, v_item_name
  FROM public.wms_item_snapshot(p_sku_busy_code);

  v_auto_approved := NOT v_has_existing
    OR (
      v_existing.sku_busy_code = p_sku_busy_code
      AND v_expected_inner = p_inner_packs
      AND v_expected_loose = p_loose_ea_qty
      AND v_existing.inner_pack_qty = p_inner_pack_qty
    );

  v_status := CASE WHEN v_auto_approved THEN 'auto_approved' ELSE 'pending_review' END;

  INSERT INTO public.bin_count_logs (
    bin_id,
    count_type,
    sku_busy_code,
    item_id_snapshot,
    item_name_snapshot,
    expected_inner_packs,
    expected_loose_ea_qty,
    counted_inner_packs,
    counted_loose_ea_qty,
    inner_pack_qty,
    status,
    note,
    created_by_user_id,
    created_by_name
  ) VALUES (
    v_bin_id,
    CASE WHEN p_count_type IN ('initial_setup', 'cycle_count', 'adjustment') THEN p_count_type ELSE 'cycle_count' END,
    p_sku_busy_code,
    v_item_id,
    v_item_name,
    v_expected_inner,
    v_expected_loose,
    p_inner_packs,
    p_loose_ea_qty,
    p_inner_pack_qty,
    v_status,
    p_note,
    p_user_id,
    p_user_name
  )
  RETURNING id INTO v_log_id;

  IF v_auto_approved THEN
    INSERT INTO public.bin_inventory (
      bin_id,
      sku_busy_code,
      item_id_snapshot,
      item_name_snapshot,
      inner_packs,
      loose_ea_qty,
      inner_pack_qty,
      daily_target,
      reorder_point,
      status,
      last_counted_at
    ) VALUES (
      v_bin_id,
      p_sku_busy_code,
      v_item_id,
      v_item_name,
      p_inner_packs,
      p_loose_ea_qty,
      p_inner_pack_qty,
      p_daily_target,
      p_reorder_point,
      public.wms_bin_status(p_inner_packs, p_loose_ea_qty, p_reorder_point),
      now()
    )
    ON CONFLICT (bin_id, sku_busy_code) DO UPDATE
    SET sku_busy_code = EXCLUDED.sku_busy_code,
        item_id_snapshot = EXCLUDED.item_id_snapshot,
        item_name_snapshot = EXCLUDED.item_name_snapshot,
        inner_packs = EXCLUDED.inner_packs,
        loose_ea_qty = EXCLUDED.loose_ea_qty,
        inner_pack_qty = EXCLUDED.inner_pack_qty,
        daily_target = COALESCE(EXCLUDED.daily_target, public.bin_inventory.daily_target),
        reorder_point = COALESCE(EXCLUDED.reorder_point, public.bin_inventory.reorder_point),
        status = EXCLUDED.status,
        last_counted_at = now();
  ELSE
    UPDATE public.bin_inventory
    SET status = 'pending_review'
    WHERE bin_id = v_bin_id
      AND sku_busy_code = p_sku_busy_code;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_status,
    'log_id', v_log_id,
    'requires_approval', NOT v_auto_approved
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.review_bin_count(
  p_log_id BIGINT,
  p_approved BOOLEAN,
  p_user_id BIGINT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL,
  p_review_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_log public.bin_count_logs%ROWTYPE;
  v_new_status TEXT;
BEGIN
  SELECT * INTO v_log
  FROM public.bin_count_logs
  WHERE id = p_log_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Count log not found');
  END IF;

  IF v_log.status <> 'pending_review' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Count log is not pending review');
  END IF;

  v_new_status := CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END;

  UPDATE public.bin_count_logs
  SET status = v_new_status,
      reviewed_by_user_id = p_user_id,
      reviewed_by_name = p_user_name,
      reviewed_at = now(),
      review_note = p_review_note
  WHERE id = p_log_id;

  IF p_approved THEN
    INSERT INTO public.bin_inventory (
      bin_id,
      sku_busy_code,
      item_id_snapshot,
      item_name_snapshot,
      inner_packs,
      loose_ea_qty,
      inner_pack_qty,
      status,
      last_counted_at
    ) VALUES (
      v_log.bin_id,
      v_log.sku_busy_code,
      v_log.item_id_snapshot,
      v_log.item_name_snapshot,
      v_log.counted_inner_packs,
      v_log.counted_loose_ea_qty,
      v_log.inner_pack_qty,
      public.wms_bin_status(v_log.counted_inner_packs, v_log.counted_loose_ea_qty, NULL),
      now()
    )
    ON CONFLICT (bin_id, sku_busy_code) DO UPDATE
    SET sku_busy_code = EXCLUDED.sku_busy_code,
        item_id_snapshot = EXCLUDED.item_id_snapshot,
        item_name_snapshot = EXCLUDED.item_name_snapshot,
        inner_packs = EXCLUDED.inner_packs,
        loose_ea_qty = EXCLUDED.loose_ea_qty,
        inner_pack_qty = EXCLUDED.inner_pack_qty,
        status = public.wms_bin_status(
          EXCLUDED.inner_packs,
          EXCLUDED.loose_ea_qty,
          public.bin_inventory.reorder_point
        ),
        last_counted_at = now();
  ELSE
    UPDATE public.bin_inventory
    SET status = public.wms_bin_status(inner_packs, loose_ea_qty, reorder_point)
    WHERE bin_id = v_log.bin_id
      AND sku_busy_code = v_log.sku_busy_code;
  END IF;

  RETURN jsonb_build_object('success', true, 'status', v_new_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_import_bin_inventory(
  p_rows JSONB,
  p_user_id BIGINT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL,
  p_source_file TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row JSONB;
  v_bin_id TEXT;
  v_busy_code NUMERIC;
  v_inner INTEGER;
  v_loose INTEGER;
  v_pack_qty INTEGER;
  v_daily_target INTEGER;
  v_reorder_point INTEGER;
  v_item_id BIGINT;
  v_item_name TEXT;
  v_imported INTEGER := 0;
  v_skipped INTEGER := 0;
  v_log_id BIGINT;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'p_rows must be a JSON array');
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    BEGIN
      v_bin_id := upper(trim(coalesce(v_row->>'bin_id', v_row->>'rack_no', '')));
      v_busy_code := NULLIF(trim(coalesce(v_row->>'sku_busy_code', v_row->>'busy_code', '')), '')::NUMERIC;
      v_inner := GREATEST(0, COALESCE(NULLIF(v_row->>'inner_packs', '')::INTEGER, 0));
      v_loose := GREATEST(0, COALESCE(NULLIF(v_row->>'loose_ea_qty', '')::INTEGER, 0));
      v_pack_qty := GREATEST(1, COALESCE(NULLIF(v_row->>'inner_pack_qty', '')::INTEGER, 25));
      v_daily_target := NULLIF(v_row->>'daily_target', '')::INTEGER;
      v_reorder_point := NULLIF(v_row->>'reorder_point', '')::INTEGER;
    EXCEPTION WHEN others THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END;

    IF v_bin_id = '' OR v_busy_code IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT item_id_snapshot, item_name_snapshot
    INTO v_item_id, v_item_name
    FROM public.wms_item_snapshot(v_busy_code);

    INSERT INTO public.bin_inventory (
      bin_id,
      sku_busy_code,
      item_id_snapshot,
      item_name_snapshot,
      inner_packs,
      loose_ea_qty,
      inner_pack_qty,
      daily_target,
      reorder_point,
      status,
      last_counted_at
    ) VALUES (
      v_bin_id,
      v_busy_code,
      v_item_id,
      v_item_name,
      v_inner,
      v_loose,
      v_pack_qty,
      v_daily_target,
      v_reorder_point,
      public.wms_bin_status(v_inner, v_loose, v_reorder_point),
      now()
    )
    ON CONFLICT (bin_id, sku_busy_code) DO UPDATE
    SET sku_busy_code = EXCLUDED.sku_busy_code,
        item_id_snapshot = EXCLUDED.item_id_snapshot,
        item_name_snapshot = EXCLUDED.item_name_snapshot,
        inner_packs = EXCLUDED.inner_packs,
        loose_ea_qty = EXCLUDED.loose_ea_qty,
        inner_pack_qty = EXCLUDED.inner_pack_qty,
        daily_target = EXCLUDED.daily_target,
        reorder_point = EXCLUDED.reorder_point,
        status = EXCLUDED.status,
        last_counted_at = now();

    INSERT INTO public.bin_count_logs (
      bin_id,
      count_type,
      sku_busy_code,
      item_id_snapshot,
      item_name_snapshot,
      expected_inner_packs,
      expected_loose_ea_qty,
      counted_inner_packs,
      counted_loose_ea_qty,
      inner_pack_qty,
      status,
      source_file,
      created_by_user_id,
      created_by_name
    ) VALUES (
      v_bin_id,
      'initial_setup',
      v_busy_code,
      v_item_id,
      v_item_name,
      0,
      0,
      v_inner,
      v_loose,
      v_pack_qty,
      'auto_approved',
      p_source_file,
      p_user_id,
      p_user_name
    )
    RETURNING id INTO v_log_id;

    v_imported := v_imported + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'imported', v_imported,
    'skipped', v_skipped
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_bin_inventory_from_items(
  p_inner_pack_qty INTEGER DEFAULT 25,
  p_user_id BIGINT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row RECORD;
  v_seeded INTEGER := 0;
  v_skipped_ambiguous INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT
      upper(trim(rack_no)) AS bin_id,
      busy_code::NUMERIC AS sku_busy_code
    FROM public.items
    WHERE NULLIF(trim(coalesce(rack_no, '')), '') IS NOT NULL
      AND busy_code IS NOT NULL
      AND is_active IS DISTINCT FROM false
    GROUP BY upper(trim(rack_no)), busy_code::NUMERIC
  LOOP
    PERFORM public.submit_bin_count(
      v_row.bin_id,
      v_row.sku_busy_code,
      0,
      0,
      COALESCE(NULLIF(p_inner_pack_qty, 0), 25),
      NULL,
      NULL,
      'initial_setup',
      p_user_id,
      p_user_name,
      'Seeded from items.rack_no; physical counts still required'
    );
    v_seeded := v_seeded + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'seeded', v_seeded,
    'skipped_ambiguous', v_skipped_ambiguous
  );
END;
$$;

GRANT SELECT, INSERT, UPDATE ON public.bin_inventory TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.bin_count_logs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.supplier_variances TO anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.bin_count_logs_id_seq TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.supplier_variances_id_seq TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_bin_count(TEXT, NUMERIC, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, BIGINT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_bin_count(BIGINT, BOOLEAN, BIGINT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_import_bin_inventory(JSONB, BIGINT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_bin_inventory_from_items(INTEGER, BIGINT, TEXT) TO anon, authenticated;
