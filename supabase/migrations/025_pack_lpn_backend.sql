-- PASPL Master — Pack definitions, license plates, and pick scan ledger.
-- This migration is intentionally additive and does not alter the MSSQL-owned
-- items table. busy_code is the business identifier that bridges synced items
-- to PASPL-owned pack and LPN state.

CREATE TABLE IF NOT EXISTS public.item_pack_definitions (
  busy_code NUMERIC PRIMARY KEY,
  item_id_snapshot BIGINT,
  item_name_snapshot TEXT NOT NULL,
  inner_pack_qty INTEGER,
  outer_pack_qty INTEGER,
  source_file TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT item_pack_definitions_inner_reasonable
    CHECK (inner_pack_qty IS NULL OR inner_pack_qty > 1),
  CONSTRAINT item_pack_definitions_outer_reasonable
    CHECK (outer_pack_qty IS NULL OR outer_pack_qty > 1)
);

CREATE TABLE IF NOT EXISTS public.license_plate_batches (
  id BIGSERIAL PRIMARY KEY,
  batch_code TEXT UNIQUE NOT NULL,
  created_by_user_id BIGINT,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  printed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.license_plates (
  id BIGSERIAL PRIMARY KEY,
  lpn_code TEXT UNIQUE NOT NULL,
  batch_id BIGINT REFERENCES public.license_plate_batches(id) ON DELETE SET NULL,
  busy_code NUMERIC NOT NULL,
  item_id_snapshot BIGINT,
  item_name_snapshot TEXT NOT NULL,
  pack_type TEXT NOT NULL CHECK (pack_type IN ('inner', 'outer')),
  pack_qty INTEGER NOT NULL CHECK (pack_qty > 1),
  remaining_qty INTEGER NOT NULL CHECK (remaining_qty >= 0),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'opened', 'depleted', 'voided')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  printed_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  depleted_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  CONSTRAINT license_plates_remaining_within_pack
    CHECK (remaining_qty <= pack_qty)
);

CREATE TABLE IF NOT EXISTS public.order_item_pick_scans (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  order_item_id BIGINT NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  busy_code NUMERIC,
  scan_kind TEXT NOT NULL CHECK (scan_kind IN ('sku', 'lpn', 'pack', 'manual')),
  consumption TEXT NOT NULL CHECK (consumption IN ('full', 'partial', 'adjustment')),
  lpn_id BIGINT REFERENCES public.license_plates(id) ON DELETE SET NULL,
  qty_delta INTEGER NOT NULL CHECK (qty_delta <> 0),
  qr_payload TEXT,
  reason TEXT,
  picker_user_id BIGINT,
  claim_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT c.conname
  INTO v_constraint_name
  FROM pg_constraint c
  WHERE c.conrelid = 'public.order_item_pick_scans'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%scan_kind%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.order_item_pick_scans DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  ALTER TABLE public.order_item_pick_scans
    ADD CONSTRAINT order_item_pick_scans_scan_kind_check
    CHECK (scan_kind IN ('sku', 'lpn', 'pack', 'manual'));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_item_pack_definitions_updated_at
  ON public.item_pack_definitions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_license_plates_busy_code
  ON public.license_plates(busy_code);
CREATE INDEX IF NOT EXISTS idx_license_plates_batch_id
  ON public.license_plates(batch_id);
CREATE INDEX IF NOT EXISTS idx_license_plates_status
  ON public.license_plates(status);
CREATE INDEX IF NOT EXISTS idx_order_item_pick_scans_order_item
  ON public.order_item_pick_scans(order_item_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_item_pick_scans_unique_lpn_per_line
  ON public.order_item_pick_scans(order_item_id, lpn_id)
  WHERE lpn_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.normalize_pick_scan_code(v TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(upper(trim(coalesce(v, ''))), '[^A-Z0-9]', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.pack_qty_or_null(v NUMERIC)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN v IS NULL OR v <= 1 THEN NULL
    ELSE v::INTEGER
  END;
$$;

CREATE OR REPLACE FUNCTION public.extract_lpn_code(p_payload TEXT)
RETURNS TEXT
AS $$
DECLARE
  v_raw TEXT := trim(coalesce(p_payload, ''));
  v_upper TEXT := upper(trim(coalesce(p_payload, '')));
  v_match TEXT[];
BEGIN
  IF v_upper LIKE 'PASPL-LPN:%' THEN
    RETURN upper(trim(split_part(v_raw, ':', 2)));
  END IF;

  IF v_upper LIKE 'LPN:%' THEN
    RETURN upper(trim(split_part(v_raw, ':', 2)));
  END IF;

  v_match := regexp_match(v_raw, '"lpn"\s*:\s*"([^"]+)"', 'i');
  IF v_match IS NOT NULL THEN
    RETURN upper(trim(v_match[1]));
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.extract_pack_pick_payload(p_payload TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_raw TEXT := trim(coalesce(p_payload, ''));
  v_upper TEXT := upper(trim(coalesce(p_payload, '')));
  v_busy_code_text TEXT;
  v_pack_type TEXT;
  v_json JSONB;
  v_json_type TEXT;
BEGIN
  IF v_upper LIKE 'PASPL-PACK:%' THEN
    v_busy_code_text := trim(split_part(v_raw, ':', 2));
    v_pack_type := lower(trim(split_part(v_raw, ':', 3)));

    IF v_busy_code_text ~ '^[0-9]+(\.[0-9]+)?$' AND v_pack_type IN ('inner', 'outer') THEN
      RETURN jsonb_build_object(
        'busy_code', v_busy_code_text::NUMERIC,
        'pack_type', v_pack_type
      );
    END IF;
  END IF;

  IF v_upper LIKE 'PACK:%' THEN
    v_busy_code_text := trim(split_part(v_raw, ':', 2));
    v_pack_type := lower(trim(split_part(v_raw, ':', 3)));

    IF v_busy_code_text ~ '^[0-9]+(\.[0-9]+)?$' AND v_pack_type IN ('inner', 'outer') THEN
      RETURN jsonb_build_object(
        'busy_code', v_busy_code_text::NUMERIC,
        'pack_type', v_pack_type
      );
    END IF;
  END IF;

  BEGIN
    v_json := v_raw::JSONB;
  EXCEPTION WHEN others THEN
    v_json := NULL;
  END;

  IF v_json IS NOT NULL THEN
    v_json_type := upper(trim(coalesce(v_json->>'type', '')));
    v_busy_code_text := trim(coalesce(v_json->>'busy_code', v_json->>'busyCode', ''));
    v_pack_type := lower(trim(coalesce(v_json->>'pack_type', v_json->>'packType', '')));

    IF v_json_type IN ('PASPL_PACK', 'PACK_PICK')
      AND v_busy_code_text ~ '^[0-9]+(\.[0-9]+)?$'
      AND v_pack_type IN ('inner', 'outer') THEN
      RETURN jsonb_build_object(
        'busy_code', v_busy_code_text::NUMERIC,
        'pack_type', v_pack_type
      );
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sku_scan_code_candidate(p_payload TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_raw TEXT := trim(coalesce(p_payload, ''));
  v_prefix TEXT;
  v_code TEXT;
  v_match TEXT[];
BEGIN
  v_match := regexp_match(v_raw, '"(code|itemCode|alias|alias1|sku)"\s*:\s*"([^"]+)"', 'i');
  IF v_match IS NOT NULL THEN
    RETURN public.normalize_pick_scan_code(v_match[2]);
  END IF;

  IF position(':' IN v_raw) > 0 AND length(v_raw) - length(replace(v_raw, ':', '')) = 1 THEN
    v_prefix := upper(trim(split_part(v_raw, ':', 1)));
    v_code := trim(split_part(v_raw, ':', 2));
    IF v_prefix IN ('PASPL', 'SKU', 'ITEM', 'CODE') THEN
      RETURN public.normalize_pick_scan_code(v_code);
    END IF;
  END IF;

  RETURN public.normalize_pick_scan_code(v_raw);
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_lp_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out_code TEXT := 'LP-';
  i INTEGER;
BEGIN
  FOR i IN 1..10 LOOP
    out_code := out_code || substr(chars, 1 + floor(random() * length(chars))::INTEGER, 1);
  END LOOP;
  RETURN out_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_item_pack_definitions(
  p_rows JSONB,
  p_source_file TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row JSONB;
  v_busy_code NUMERIC;
  v_item_id BIGINT;
  v_item_name TEXT;
  v_inner INTEGER;
  v_outer INTEGER;
  v_existing BOOLEAN;
  v_inserted INTEGER := 0;
  v_updated INTEGER := 0;
  v_skipped INTEGER := 0;
  v_unmatched INTEGER := 0;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'p_rows must be a JSON array');
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    BEGIN
      v_busy_code := NULLIF(v_row->>'busy_code', '')::NUMERIC;
    EXCEPTION WHEN others THEN
      v_busy_code := NULL;
    END;

    IF v_busy_code IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    SELECT i.id, i.name
    INTO v_item_id, v_item_name
    FROM public.items i
    WHERE i.busy_code::NUMERIC = v_busy_code
    ORDER BY i.id
    LIMIT 1;

    IF v_item_name IS NULL THEN
      v_unmatched := v_unmatched + 1;
      v_item_id := NULLIF(v_row->>'item_id', '')::BIGINT;
      v_item_name := NULLIF(trim(coalesce(v_row->>'item_name', v_row->>'item_name_snapshot', '')), '');
    END IF;

    IF v_item_name IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_inner := public.pack_qty_or_null(NULLIF(v_row->>'inner_pack_qty', '')::NUMERIC);
    v_outer := public.pack_qty_or_null(NULLIF(v_row->>'outer_pack_qty', '')::NUMERIC);

    SELECT EXISTS (
      SELECT 1 FROM public.item_pack_definitions WHERE busy_code = v_busy_code
    ) INTO v_existing;

    INSERT INTO public.item_pack_definitions (
      busy_code,
      item_id_snapshot,
      item_name_snapshot,
      inner_pack_qty,
      outer_pack_qty,
      source_file,
      updated_at
    ) VALUES (
      v_busy_code,
      v_item_id,
      v_item_name,
      v_inner,
      v_outer,
      p_source_file,
      now()
    )
    ON CONFLICT (busy_code) DO UPDATE
    SET item_id_snapshot = EXCLUDED.item_id_snapshot,
        item_name_snapshot = EXCLUDED.item_name_snapshot,
        inner_pack_qty = EXCLUDED.inner_pack_qty,
        outer_pack_qty = EXCLUDED.outer_pack_qty,
        source_file = EXCLUDED.source_file,
        updated_at = now();

    IF v_existing THEN
      v_updated := v_updated + 1;
    ELSE
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'inserted', v_inserted,
    'updated', v_updated,
    'skipped', v_skipped,
    'unmatched', v_unmatched
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_license_plate_batch(
  p_rows JSONB,
  p_user_id BIGINT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_batch_id BIGINT;
  v_batch_code TEXT;
  v_row JSONB;
  v_busy_code NUMERIC;
  v_pack_type TEXT;
  v_count INTEGER;
  v_pack_qty INTEGER;
  v_def RECORD;
  v_lpn_code TEXT;
  v_created JSONB := '[]'::JSONB;
  i INTEGER;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'p_rows must be a JSON array');
  END IF;

  v_batch_code := 'LPB-' || to_char(now(), 'YYMMDD-HH24MISS') || '-' || substr(md5(random()::TEXT), 1, 4);

  INSERT INTO public.license_plate_batches (batch_code, created_by_user_id, created_by_name)
  VALUES (upper(v_batch_code), p_user_id, p_user_name)
  RETURNING id, batch_code INTO v_batch_id, v_batch_code;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_busy_code := NULLIF(v_row->>'busy_code', '')::NUMERIC;
    v_pack_type := lower(trim(coalesce(v_row->>'pack_type', '')));
    v_count := GREATEST(0, COALESCE(NULLIF(v_row->>'count', '')::INTEGER, 0));

    IF v_busy_code IS NULL OR v_pack_type NOT IN ('inner', 'outer') OR v_count < 1 THEN
      CONTINUE;
    END IF;

    SELECT *
    INTO v_def
    FROM public.item_pack_definitions
    WHERE busy_code = v_busy_code;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No pack definition found for busy_code %', v_busy_code;
    END IF;

    v_pack_qty := CASE v_pack_type
      WHEN 'inner' THEN v_def.inner_pack_qty
      ELSE v_def.outer_pack_qty
    END;

    IF v_pack_qty IS NULL OR v_pack_qty <= 1 THEN
      RAISE EXCEPTION 'Invalid % pack quantity for busy_code %', v_pack_type, v_busy_code;
    END IF;

    FOR i IN 1..v_count LOOP
      LOOP
        v_lpn_code := public.generate_lp_code();
        EXIT WHEN NOT EXISTS (
          SELECT 1 FROM public.license_plates WHERE lpn_code = v_lpn_code
        );
      END LOOP;

      INSERT INTO public.license_plates (
        lpn_code,
        batch_id,
        busy_code,
        item_id_snapshot,
        item_name_snapshot,
        pack_type,
        pack_qty,
        remaining_qty,
        status
      ) VALUES (
        v_lpn_code,
        v_batch_id,
        v_busy_code,
        v_def.item_id_snapshot,
        v_def.item_name_snapshot,
        v_pack_type,
        v_pack_qty,
        v_pack_qty,
        'available'
      );

      v_created := v_created || jsonb_build_array(jsonb_build_object(
        'lpn_code', v_lpn_code,
        'batch_id', v_batch_id,
        'batch_code', v_batch_code,
        'busy_code', v_busy_code,
        'item_id_snapshot', v_def.item_id_snapshot,
        'item_name_snapshot', v_def.item_name_snapshot,
        'pack_type', v_pack_type,
        'pack_qty', v_pack_qty,
        'remaining_qty', v_pack_qty,
        'status', 'available'
      ));
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'batch', jsonb_build_object(
      'id', v_batch_id,
      'batch_code', v_batch_code,
      'created_by_user_id', p_user_id,
      'created_by_name', p_user_name
    ),
    'license_plates', v_created,
    'created_count', jsonb_array_length(v_created)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_pick_scan(
  p_order_id BIGINT,
  p_order_item_id BIGINT,
  p_claim_id BIGINT,
  p_user_id BIGINT,
  p_qr_payload TEXT,
  p_confirm_break BOOLEAN DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claim RECORD;
  v_line RECORD;
  v_lpn RECORD;
  v_lpn_code TEXT;
  v_pack_payload JSONB;
  v_pack_busy_code NUMERIC;
  v_pack_type TEXT;
  v_pack_qty INTEGER;
  v_scan_code TEXT;
  v_scan_kind TEXT;
  v_expected_codes TEXT[];
  v_target_qty INTEGER;
  v_current_qty INTEGER;
  v_remaining_needed INTEGER;
  v_qty_delta INTEGER;
  v_total_after INTEGER;
  v_consumption TEXT;
BEGIN
  SELECT id
  INTO v_claim
  FROM public.work_claims
  WHERE id = p_claim_id
    AND order_id = p_order_id
    AND stage = 'picking'
    AND claimed_by_user_id = p_user_id
    AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'No active picking claim found');
  END IF;

  SELECT
    oi.*,
    i.busy_code AS catalog_busy_code,
    i.alias AS catalog_alias,
    i.alias1 AS catalog_alias1
  INTO v_line
  FROM public.order_items oi
  LEFT JOIN public.items i ON i.id = oi.item_id
  WHERE oi.id = p_order_item_id
    AND oi.order_id = p_order_id
  FOR UPDATE OF oi;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Order item not found');
  END IF;

  v_target_qty := LEAST(
    COALESCE(v_line.qty_approved, v_line.qty_shippable, v_line.qty_requested),
    COALESCE(v_line.qty_shippable, v_line.qty_requested)
  );

  SELECT COALESCE(SUM(qty_delta), 0)
  INTO v_current_qty
  FROM public.order_item_pick_scans
  WHERE order_item_id = p_order_item_id;

  v_remaining_needed := v_target_qty - v_current_qty;
  IF v_remaining_needed <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'Line already fully picked',
      'target_qty', v_target_qty,
      'total_picked', v_current_qty,
      'remaining_qty', 0
    );
  END IF;

  v_pack_payload := public.extract_pack_pick_payload(p_qr_payload);

  IF v_pack_payload IS NOT NULL THEN
    v_pack_busy_code := (v_pack_payload->>'busy_code')::NUMERIC;
    v_pack_type := lower(v_pack_payload->>'pack_type');

    IF v_line.catalog_busy_code IS NULL OR v_pack_busy_code <> v_line.catalog_busy_code::NUMERIC THEN
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'Pack QR belongs to a different item',
        'pack_busy_code', v_pack_busy_code,
        'expected_busy_code', v_line.catalog_busy_code
      );
    END IF;

    SELECT CASE v_pack_type
      WHEN 'inner' THEN inner_pack_qty
      WHEN 'outer' THEN outer_pack_qty
      ELSE NULL
    END
    INTO v_pack_qty
    FROM public.item_pack_definitions
    WHERE busy_code = v_pack_busy_code;

    IF v_pack_qty IS NULL OR v_pack_qty <= 1 THEN
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'No valid pack quantity found for this reusable pack QR',
        'busy_code', v_pack_busy_code,
        'pack_type', v_pack_type
      );
    END IF;

    IF v_pack_qty > v_remaining_needed AND NOT p_confirm_break THEN
      RETURN jsonb_build_object(
        'success', false,
        'requires_break_confirmation', true,
        'reason', 'Scanned pack is larger than remaining quantity',
        'scan_kind', 'pack',
        'busy_code', v_pack_busy_code,
        'pack_type', v_pack_type,
        'pack_qty', v_pack_qty,
        'target_qty', v_target_qty,
        'total_picked', v_current_qty,
        'remaining_qty', v_remaining_needed
      );
    END IF;

    v_qty_delta := LEAST(v_pack_qty, v_remaining_needed);
    v_consumption := CASE WHEN v_qty_delta = v_pack_qty THEN 'full' ELSE 'partial' END;
    v_scan_kind := 'pack';

    INSERT INTO public.order_item_pick_scans (
      order_id,
      order_item_id,
      busy_code,
      scan_kind,
      consumption,
      qty_delta,
      qr_payload,
      picker_user_id,
      claim_id
    ) VALUES (
      p_order_id,
      p_order_item_id,
      v_pack_busy_code,
      v_scan_kind,
      v_consumption,
      v_qty_delta,
      p_qr_payload,
      p_user_id,
      p_claim_id
    );
  ELSE
    v_lpn_code := public.extract_lpn_code(p_qr_payload);

    IF v_lpn_code IS NOT NULL THEN
      SELECT *
      INTO v_lpn
      FROM public.license_plates
      WHERE lpn_code = v_lpn_code
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'reason', 'License plate not found', 'lpn_code', v_lpn_code);
      END IF;

      IF v_lpn.status IN ('depleted', 'voided') OR v_lpn.remaining_qty <= 0 THEN
        RETURN jsonb_build_object('success', false, 'reason', 'License plate is not available', 'status', v_lpn.status);
      END IF;

      IF v_line.catalog_busy_code IS NULL OR v_lpn.busy_code <> v_line.catalog_busy_code::NUMERIC THEN
        RETURN jsonb_build_object(
          'success', false,
          'reason', 'License plate belongs to a different item',
          'lpn_busy_code', v_lpn.busy_code,
          'expected_busy_code', v_line.catalog_busy_code
        );
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.order_item_pick_scans
        WHERE order_item_id = p_order_item_id
          AND lpn_id = v_lpn.id
      ) THEN
        RETURN jsonb_build_object('success', false, 'reason', 'License plate already scanned for this line');
      END IF;

      IF v_lpn.remaining_qty > v_remaining_needed AND NOT p_confirm_break THEN
        RETURN jsonb_build_object(
          'success', false,
          'requires_break_confirmation', true,
          'reason', 'Scanned pack is larger than remaining quantity',
          'scan_kind', 'lpn',
          'lpn_code', v_lpn.lpn_code,
          'pack_type', v_lpn.pack_type,
          'pack_qty', v_lpn.pack_qty,
          'lpn_remaining_qty', v_lpn.remaining_qty,
          'target_qty', v_target_qty,
          'total_picked', v_current_qty,
          'remaining_qty', v_remaining_needed
        );
      END IF;

      v_qty_delta := LEAST(v_lpn.remaining_qty, v_remaining_needed);
      v_consumption := CASE WHEN v_qty_delta = v_lpn.remaining_qty THEN 'full' ELSE 'partial' END;
      v_scan_kind := 'lpn';

      INSERT INTO public.order_item_pick_scans (
        order_id,
        order_item_id,
        busy_code,
        scan_kind,
        consumption,
        lpn_id,
        qty_delta,
        qr_payload,
        picker_user_id,
        claim_id
      ) VALUES (
        p_order_id,
        p_order_item_id,
        v_lpn.busy_code,
        v_scan_kind,
        v_consumption,
        v_lpn.id,
        v_qty_delta,
        p_qr_payload,
        p_user_id,
        p_claim_id
      );

      UPDATE public.license_plates
      SET remaining_qty = remaining_qty - v_qty_delta,
          status = CASE
            WHEN remaining_qty - v_qty_delta <= 0 THEN 'depleted'
            ELSE 'opened'
          END,
          opened_at = CASE
            WHEN remaining_qty - v_qty_delta > 0 THEN COALESCE(opened_at, now())
            ELSE opened_at
          END,
          depleted_at = CASE
            WHEN remaining_qty - v_qty_delta <= 0 THEN COALESCE(depleted_at, now())
            ELSE depleted_at
          END
      WHERE id = v_lpn.id;
    ELSE
      v_scan_code := public.sku_scan_code_candidate(p_qr_payload);
      v_expected_codes := ARRAY[
        public.normalize_pick_scan_code(v_line.catalog_alias1),
        public.normalize_pick_scan_code(v_line.catalog_alias),
        public.normalize_pick_scan_code(v_line.item_alias)
      ];

      IF v_scan_code = '' OR NOT EXISTS (
        SELECT 1
        FROM unnest(v_expected_codes) AS expected(code)
        WHERE expected.code <> ''
          AND expected.code = v_scan_code
      ) THEN
        RETURN jsonb_build_object(
          'success', false,
          'reason', 'SKU QR does not match order item',
          'scanned_code', v_scan_code
        );
      END IF;

      v_qty_delta := 1;
      v_consumption := 'full';
      v_scan_kind := 'sku';

      INSERT INTO public.order_item_pick_scans (
        order_id,
        order_item_id,
        busy_code,
        scan_kind,
        consumption,
        qty_delta,
        qr_payload,
        picker_user_id,
        claim_id
      ) VALUES (
        p_order_id,
        p_order_item_id,
        v_line.catalog_busy_code,
        v_scan_kind,
        v_consumption,
        v_qty_delta,
        p_qr_payload,
        p_user_id,
        p_claim_id
      );
    END IF;
  END IF;

  SELECT COALESCE(SUM(qty_delta), 0)
  INTO v_total_after
  FROM public.order_item_pick_scans
  WHERE order_item_id = p_order_item_id;

  IF v_total_after >= v_target_qty THEN
    UPDATE public.order_items
    SET state = 'picked'
    WHERE id = p_order_item_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'scan_kind', v_scan_kind,
    'consumption', v_consumption,
    'qty_added', v_qty_delta,
    'target_qty', v_target_qty,
    'total_picked', v_total_after,
    'remaining_qty', GREATEST(0, v_target_qty - v_total_after),
    'line_complete', v_total_after >= v_target_qty
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_manual_pick_adjustment(
  p_order_id BIGINT,
  p_order_item_id BIGINT,
  p_claim_id BIGINT,
  p_user_id BIGINT,
  p_qty_delta INTEGER,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_claim RECORD;
  v_line RECORD;
  v_target_qty INTEGER;
  v_current_qty INTEGER;
  v_total_after INTEGER;
BEGIN
  IF p_qty_delta = 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Quantity adjustment cannot be zero');
  END IF;

  IF NULLIF(trim(coalesce(p_reason, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Manual adjustment reason is required');
  END IF;

  SELECT id
  INTO v_claim
  FROM public.work_claims
  WHERE id = p_claim_id
    AND order_id = p_order_id
    AND stage = 'picking'
    AND claimed_by_user_id = p_user_id
    AND status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'No active picking claim found');
  END IF;

  SELECT
    oi.*,
    i.busy_code AS catalog_busy_code
  INTO v_line
  FROM public.order_items oi
  LEFT JOIN public.items i ON i.id = oi.item_id
  WHERE oi.id = p_order_item_id
    AND oi.order_id = p_order_id
  FOR UPDATE OF oi;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Order item not found');
  END IF;

  v_target_qty := LEAST(
    COALESCE(v_line.qty_approved, v_line.qty_shippable, v_line.qty_requested),
    COALESCE(v_line.qty_shippable, v_line.qty_requested)
  );

  SELECT COALESCE(SUM(qty_delta), 0)
  INTO v_current_qty
  FROM public.order_item_pick_scans
  WHERE order_item_id = p_order_item_id;

  v_total_after := v_current_qty + p_qty_delta;
  IF v_total_after < 0 OR v_total_after > v_target_qty THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'Manual adjustment would exceed allowed pick quantity',
      'target_qty', v_target_qty,
      'total_picked', v_current_qty,
      'attempted_total', v_total_after
    );
  END IF;

  INSERT INTO public.order_item_pick_scans (
    order_id,
    order_item_id,
    busy_code,
    scan_kind,
    consumption,
    qty_delta,
    reason,
    picker_user_id,
    claim_id
  ) VALUES (
    p_order_id,
    p_order_item_id,
    v_line.catalog_busy_code,
    'manual',
    'adjustment',
    p_qty_delta,
    p_reason,
    p_user_id,
    p_claim_id
  );

  IF v_total_after >= v_target_qty THEN
    UPDATE public.order_items
    SET state = 'picked'
    WHERE id = p_order_item_id;
  ELSE
    UPDATE public.order_items
    SET state = 'pending'
    WHERE id = p_order_item_id
      AND state = 'picked';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'scan_kind', 'manual',
    'consumption', 'adjustment',
    'qty_added', p_qty_delta,
    'target_qty', v_target_qty,
    'total_picked', v_total_after,
    'remaining_qty', GREATEST(0, v_target_qty - v_total_after),
    'line_complete', v_total_after >= v_target_qty
  );
END;
$$;

GRANT SELECT, INSERT, UPDATE ON public.item_pack_definitions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.license_plate_batches TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.license_plates TO anon, authenticated;
GRANT SELECT, INSERT ON public.order_item_pick_scans TO anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.license_plate_batches_id_seq TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.license_plates_id_seq TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.order_item_pick_scans_id_seq TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_item_pack_definitions(JSONB, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_license_plate_batch(JSONB, BIGINT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.extract_pack_pick_payload(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_pick_scan(BIGINT, BIGINT, BIGINT, BIGINT, TEXT, BOOLEAN) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_manual_pick_adjustment(BIGINT, BIGINT, BIGINT, BIGINT, INTEGER, TEXT) TO anon, authenticated;
