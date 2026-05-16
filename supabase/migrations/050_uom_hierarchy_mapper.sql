-- PASPL Master — UoM hierarchy mapper: selling_unit on items, pack-def labels + confirmation,
-- QR tier overrides, resolve_scan_to_uom RPC, onboarding upsert, coverage gaps list.

-- ─── 1. items.selling_unit (display / prompting only; stored qty remains EA) ───
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS selling_unit TEXT NOT NULL DEFAULT 'piece';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.items'::regclass
      AND c.conname = 'items_selling_unit_check'
  ) THEN
    ALTER TABLE public.items
      ADD CONSTRAINT items_selling_unit_check
      CHECK (selling_unit IN ('piece', 'packet', 'box'));
  END IF;
END $$;

COMMENT ON COLUMN public.items.selling_unit IS
  'How operators prefer to think about qty for this SKU (piece/packet/box). All inventory and order qty remain EA.';

-- ─── 2. Extend item_pack_definitions ───
ALTER TABLE public.item_pack_definitions
  ADD COLUMN IF NOT EXISTS packet_label TEXT,
  ADD COLUMN IF NOT EXISTS box_label TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.item_pack_definitions.inner_pack_qty IS 'EA count per inner (packet) unit.';
COMMENT ON COLUMN public.item_pack_definitions.outer_pack_qty IS 'EA count per outer (box) unit.';
COMMENT ON COLUMN public.item_pack_definitions.confirmed_at IS 'Supervisor confirmed scan-driven UoM onboarding; NULL = spreadsheet/import only or unknown.';

-- ─── 3. QR tier overrides (OEM barcode maps to packet/box, not piece) ───
CREATE TABLE IF NOT EXISTS public.item_qr_tier_overrides (
  id BIGSERIAL PRIMARY KEY,
  busy_code NUMERIC NOT NULL,
  barcode_key TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('piece', 'packet', 'box')),
  created_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT item_qr_tier_overrides_barcode_key_unique UNIQUE (barcode_key)
);

CREATE INDEX IF NOT EXISTS idx_item_qr_tier_overrides_busy_code
  ON public.item_qr_tier_overrides(busy_code);

COMMENT ON TABLE public.item_qr_tier_overrides IS
  'Normalized barcode_key maps to UoM tier for that scan (default tier without row is piece).';

ALTER TABLE public.item_qr_tier_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_qr_tier_overrides_authenticated_all ON public.item_qr_tier_overrides;
DROP POLICY IF EXISTS item_qr_tier_overrides_anon_all ON public.item_qr_tier_overrides;

CREATE POLICY item_qr_tier_overrides_authenticated_all
  ON public.item_qr_tier_overrides
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY item_qr_tier_overrides_anon_all
  ON public.item_qr_tier_overrides
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.item_qr_tier_overrides TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.item_qr_tier_overrides_id_seq TO anon, authenticated;

-- ─── 4. Resolve one scan payload → UoM snapshot (uses migration 025 helpers) ───
CREATE OR REPLACE FUNCTION public.resolve_scan_to_uom(
  p_raw_value TEXT,
  p_normalized_candidates TEXT[] DEFAULT NULL,
  p_extracted_piece_qty INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trim TEXT := trim(coalesce(p_raw_value, ''));
  v_pack JSONB;
  v_busy NUMERIC;
  v_pack_type TEXT;
  v_lp_rem INTEGER;
  v_lp_pack_qty INTEGER;
  v_lpn_code TEXT;
  v_json JSONB;
  v_json_type TEXT;
  v_rack TEXT;
  v_def RECORD;
  v_candidates TEXT[];
  v_code TEXT;
  v_item_id BIGINT;
  v_item_name TEXT;
  v_item_busy NUMERIC;
  v_selling TEXT;
  v_matched_barcode_key TEXT;
  v_override_tier TEXT;
  v_tier TEXT;
  v_base INTEGER;
  v_inner INTEGER;
  v_outer INTEGER;
  v_packets INTEGER;
  v_source TEXT;
BEGIN
  IF v_trim = '' THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'empty_payload');
  END IF;

  -- Rack payloads (no SKU qty semantics)
  BEGIN
    v_json := v_trim::JSONB;
    v_json_type := upper(trim(coalesce(v_json->>'type', '')));
    v_rack := trim(coalesce(v_json->>'rack', v_json->>'rack_no', v_json->>'location', ''));
    IF v_json_type IN ('PASPL_RACK', 'RACK', 'BIN') AND v_rack <> '' THEN
      RETURN jsonb_build_object('matched', false, 'reason', 'rack_payload');
    END IF;
  EXCEPTION WHEN others THEN
    NULL;
  END;

  IF v_trim ~* '^(RACK|BIN|R)[\s:-]+[A-Z0-9]' THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'rack_payload');
  END IF;

  -- Pack QR
  v_pack := public.extract_pack_pick_payload(v_trim);
  IF v_pack IS NOT NULL THEN
    v_busy := (v_pack->>'busy_code')::NUMERIC;
    v_pack_type := v_pack->>'pack_type';
    SELECT *
    INTO v_def
    FROM public.item_pack_definitions
    WHERE busy_code = v_busy;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'matched', false,
        'reason', 'pack_def_missing',
        'busy_code', v_busy
      );
    END IF;

    SELECT i.id, i.name, i.busy_code, i.selling_unit
    INTO v_item_id, v_item_name, v_item_busy, v_selling
    FROM public.items i
    WHERE i.busy_code = v_busy
    ORDER BY i.id
    LIMIT 1;

    v_inner := v_def.inner_pack_qty;
    v_outer := v_def.outer_pack_qty;

    IF v_pack_type = 'inner' THEN
      v_tier := 'packet';
      v_base := v_inner;
      v_source := 'pack_def';
    ELSE
      v_tier := 'box';
      v_base := v_outer;
      v_source := 'pack_def';
    END IF;

    IF v_base IS NULL OR v_base < 1 THEN
      RETURN jsonb_build_object(
        'matched', false,
        'reason', 'incomplete_pack_definition',
        'busy_code', v_busy,
        'tier', v_tier
      );
    END IF;

    IF v_outer IS NOT NULL AND v_inner IS NOT NULL AND v_inner > 0 AND v_outer % v_inner = 0 THEN
      v_packets := v_outer / v_inner;
    ELSE
      v_packets := NULL;
    END IF;

    RETURN jsonb_build_object(
      'matched', true,
      'busy_code', v_busy,
      'item_id', v_item_id,
      'item_name', v_item_name,
      'selling_unit', coalesce(v_selling, 'piece'),
      'tier', v_tier,
      'base_qty_ea', v_base,
      'packet_qty_ea', v_inner,
      'packets_per_box', v_packets,
      'source', v_source
    );
  END IF;

  -- License plate
  v_lpn_code := public.extract_lpn_code(v_trim);
  IF v_lpn_code IS NOT NULL AND v_lpn_code <> '' THEN
    SELECT lp.busy_code, lp.pack_type, lp.remaining_qty, lp.pack_qty
    INTO v_busy, v_pack_type, v_lp_rem, v_lp_pack_qty
    FROM public.license_plates lp
    WHERE upper(lp.lpn_code) = upper(v_lpn_code)
    LIMIT 1;

    IF FOUND THEN
      SELECT *
      INTO v_def
      FROM public.item_pack_definitions
      WHERE busy_code = v_busy;

      SELECT i.id, i.name, i.busy_code, i.selling_unit
      INTO v_item_id, v_item_name, v_item_busy, v_selling
      FROM public.items i
      WHERE i.busy_code = v_busy
      ORDER BY i.id
      LIMIT 1;

      v_inner := v_def.inner_pack_qty;
      v_outer := v_def.outer_pack_qty;
      v_tier := CASE WHEN v_pack_type = 'inner' THEN 'packet' ELSE 'box' END;
      v_source := 'lpn';

      v_base := coalesce(nullif(v_lp_rem, 0), v_lp_pack_qty, v_inner, v_outer);
      IF v_base IS NULL OR v_base < 1 THEN
        v_base := 1;
      END IF;

      IF v_outer IS NOT NULL AND v_inner IS NOT NULL AND v_inner > 0 AND v_outer % v_inner = 0 THEN
        v_packets := v_outer / v_inner;
      ELSE
        v_packets := NULL;
      END IF;

      RETURN jsonb_build_object(
        'matched', true,
        'busy_code', v_busy,
        'item_id', v_item_id,
        'item_name', v_item_name,
        'selling_unit', coalesce(v_selling, 'piece'),
        'tier', v_tier,
        'base_qty_ea', v_base,
        'packet_qty_ea', v_inner,
        'packets_per_box', v_packets,
        'source', v_source
      );
    END IF;
  END IF;

  -- SKU / barcode path
  v_candidates := coalesce(p_normalized_candidates, ARRAY[]::TEXT[]);
  IF cardinality(v_candidates) = 0 THEN
    v_code := public.sku_scan_code_candidate(v_trim);
    IF v_code IS NOT NULL AND v_code <> '' THEN
      v_candidates := ARRAY[v_code];
    END IF;
  END IF;

  v_item_id := NULL;
  v_matched_barcode_key := NULL;

  FOREACH v_code IN ARRAY v_candidates
  LOOP
    EXIT WHEN v_item_id IS NOT NULL;

    IF v_code IS NULL OR v_code = '' THEN
      CONTINUE;
    END IF;

    IF v_code ~ '^[0-9]+$' THEN
      SELECT i.id, i.name, i.busy_code, i.selling_unit
      INTO v_item_id, v_item_name, v_item_busy, v_selling
      FROM public.items i
      WHERE i.busy_code IS NOT NULL AND i.busy_code = v_code::NUMERIC
      ORDER BY i.id
      LIMIT 1;
      IF FOUND THEN
        v_source := 'catalog';
        EXIT;
      END IF;
    END IF;

    SELECT i.id, i.name, i.busy_code, i.selling_unit
    INTO v_item_id, v_item_name, v_item_busy, v_selling
    FROM public.items i
    WHERE public.normalize_pick_scan_code(i.alias1::TEXT) = v_code
       OR public.normalize_pick_scan_code(i.alias::TEXT) = v_code
    ORDER BY i.id
    LIMIT 1;

    IF FOUND THEN
      v_source := 'catalog';
      EXIT;
    END IF;

    SELECT ib.sku_busy_code, public.normalize_pick_scan_code(ib.barcode_key)
    INTO v_busy, v_matched_barcode_key
    FROM public.item_barcodes ib
    WHERE public.normalize_pick_scan_code(ib.barcode_key) = v_code
    LIMIT 1;

    IF v_busy IS NOT NULL THEN
      SELECT i.id, i.name, i.busy_code, i.selling_unit
      INTO v_item_id, v_item_name, v_item_busy, v_selling
      FROM public.items i
      WHERE i.busy_code = v_busy
      ORDER BY i.id
      LIMIT 1;

      IF FOUND THEN
        v_source := 'barcode_mapping';
        EXIT;
      END IF;
    END IF;
  END LOOP;

  IF v_item_id IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'no_catalog_match');
  END IF;

  SELECT *
  INTO v_def
  FROM public.item_pack_definitions
  WHERE busy_code = v_item_busy;

  v_inner := v_def.inner_pack_qty;
  v_outer := v_def.outer_pack_qty;

  IF v_outer IS NOT NULL AND v_inner IS NOT NULL AND v_inner > 0 AND v_outer % v_inner = 0 THEN
    v_packets := v_outer / v_inner;
  ELSE
    v_packets := NULL;
  END IF;

  v_override_tier := NULL;
  IF v_matched_barcode_key IS NOT NULL THEN
    SELECT o.tier
    INTO v_override_tier
    FROM public.item_qr_tier_overrides o
    WHERE o.barcode_key = v_matched_barcode_key
       OR public.normalize_pick_scan_code(o.barcode_key) = v_matched_barcode_key
    LIMIT 1;
  END IF;

  IF v_override_tier IS NOT NULL THEN
    v_tier := v_override_tier;
    v_source := 'barcode_override';
    IF v_tier = 'piece' THEN
      v_base := CASE
        WHEN p_extracted_piece_qty IS NOT NULL AND p_extracted_piece_qty > 0 THEN p_extracted_piece_qty
        ELSE 1
      END;
    ELSIF v_tier = 'packet' THEN
      v_base := v_inner;
    ELSE
      v_base := v_outer;
    END IF;
  ELSE
    v_tier := 'piece';
    IF v_source = 'barcode_mapping' THEN
      v_source := 'barcode_default';
    END IF;
    v_base := CASE
      WHEN p_extracted_piece_qty IS NOT NULL AND p_extracted_piece_qty > 0 THEN p_extracted_piece_qty
      ELSE 1
    END;
  END IF;

  IF v_tier IN ('packet', 'box') AND (v_base IS NULL OR v_base < 1) THEN
    RETURN jsonb_build_object(
      'matched', false,
      'reason', 'incomplete_pack_definition',
      'busy_code', v_item_busy,
      'item_id', v_item_id,
      'item_name', v_item_name,
      'tier', v_tier
    );
  END IF;

  RETURN jsonb_build_object(
    'matched', true,
    'busy_code', v_item_busy,
    'item_id', v_item_id,
    'item_name', v_item_name,
    'selling_unit', coalesce(v_selling, 'piece'),
    'tier', v_tier,
    'base_qty_ea', v_base,
    'packet_qty_ea', v_inner,
    'packets_per_box', v_packets,
    'source', v_source
  );
END;
$$;

COMMENT ON FUNCTION public.resolve_scan_to_uom IS
  'Classify raw QR/barcode payload and return EA qty per scan unit plus pack metadata. Pass p_normalized_candidates from client collectQrLookupCandidates when available.';

-- ─── 5. Onboarding upsert (pack def + selling_unit + optional QR tier row) ───
CREATE OR REPLACE FUNCTION public.upsert_uom_definition(
  p_busy_code NUMERIC,
  p_inner_pack_qty INTEGER DEFAULT NULL,
  p_outer_pack_qty INTEGER DEFAULT NULL,
  p_packet_label TEXT DEFAULT NULL,
  p_box_label TEXT DEFAULT NULL,
  p_selling_unit TEXT DEFAULT 'piece',
  p_barcode_raw TEXT DEFAULT NULL,
  p_barcode_tier TEXT DEFAULT NULL,
  p_user_id BIGINT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item_id BIGINT;
  v_item_name TEXT;
  v_inner INTEGER;
  v_outer INTEGER;
  v_norm_barcode TEXT;
BEGIN
  IF p_busy_code IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'busy_code_required');
  END IF;

  IF p_selling_unit NOT IN ('piece', 'packet', 'box') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_selling_unit');
  END IF;

  IF p_barcode_tier IS NOT NULL AND p_barcode_tier NOT IN ('piece', 'packet', 'box') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_barcode_tier');
  END IF;

  SELECT i.id, i.name
  INTO v_item_id, v_item_name
  FROM public.items i
  WHERE i.busy_code = p_busy_code
  ORDER BY i.id
  LIMIT 1;

  IF v_item_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'item_not_found');
  END IF;

  v_inner := public.pack_qty_or_null(p_inner_pack_qty::NUMERIC);
  v_outer := public.pack_qty_or_null(p_outer_pack_qty::NUMERIC);

  INSERT INTO public.item_pack_definitions (
    busy_code,
    item_id_snapshot,
    item_name_snapshot,
    inner_pack_qty,
    outer_pack_qty,
    packet_label,
    box_label,
    confirmed_by_user_id,
    confirmed_at,
    updated_at
  ) VALUES (
    p_busy_code,
    v_item_id,
    v_item_name,
    v_inner,
    v_outer,
    nullif(trim(coalesce(p_packet_label, '')), ''),
    nullif(trim(coalesce(p_box_label, '')), ''),
    p_user_id,
    now(),
    now()
  )
  ON CONFLICT (busy_code) DO UPDATE
  SET item_id_snapshot = EXCLUDED.item_id_snapshot,
      item_name_snapshot = EXCLUDED.item_name_snapshot,
      inner_pack_qty = COALESCE(EXCLUDED.inner_pack_qty, public.item_pack_definitions.inner_pack_qty),
      outer_pack_qty = COALESCE(EXCLUDED.outer_pack_qty, public.item_pack_definitions.outer_pack_qty),
      packet_label = COALESCE(EXCLUDED.packet_label, public.item_pack_definitions.packet_label),
      box_label = COALESCE(EXCLUDED.box_label, public.item_pack_definitions.box_label),
      confirmed_by_user_id = COALESCE(EXCLUDED.confirmed_by_user_id, public.item_pack_definitions.confirmed_by_user_id),
      confirmed_at = COALESCE(EXCLUDED.confirmed_at, public.item_pack_definitions.confirmed_at),
      updated_at = now();

  UPDATE public.items
  SET selling_unit = p_selling_unit
  WHERE busy_code = p_busy_code;

  IF p_barcode_raw IS NOT NULL AND trim(p_barcode_raw) <> '' AND p_barcode_tier IS NOT NULL THEN
    v_norm_barcode := public.normalize_pick_scan_code(trim(p_barcode_raw));
    IF v_norm_barcode IS NULL OR v_norm_barcode = '' THEN
      RETURN jsonb_build_object('success', false, 'reason', 'invalid_barcode_raw');
    END IF;

    INSERT INTO public.item_qr_tier_overrides (busy_code, barcode_key, tier, created_by_user_id)
    VALUES (p_busy_code, v_norm_barcode, p_barcode_tier, p_user_id)
    ON CONFLICT (barcode_key) DO UPDATE
    SET busy_code = EXCLUDED.busy_code,
        tier = EXCLUDED.tier,
        created_by_user_id = COALESCE(EXCLUDED.created_by_user_id, public.item_qr_tier_overrides.created_by_user_id),
        created_at = now();
  END IF;

  RETURN jsonb_build_object('success', true, 'busy_code', p_busy_code);
END;
$$;

-- ─── 6. Coverage gaps (items with busy_code but pack def not supervisor-confirmed) ───
CREATE OR REPLACE FUNCTION public.list_uom_coverage_gaps(
  p_limit INTEGER DEFAULT 500
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB := '[]'::JSONB;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    p_limit := 500;
  END IF;
  IF p_limit > 5000 THEN
    p_limit := 5000;
  END IF;

  SELECT coalesce(
    jsonb_agg(row_to_json(t) ORDER BY t.busy_code, t.item_id),
    '[]'::JSONB
  )
  INTO v_rows
  FROM (
    SELECT DISTINCT ON (i.busy_code)
      i.busy_code::NUMERIC AS busy_code,
      i.id AS item_id,
      i.name AS item_name,
      ipd.confirmed_at,
      ipd.inner_pack_qty,
      ipd.outer_pack_qty
    FROM public.items i
    LEFT JOIN public.item_pack_definitions ipd ON ipd.busy_code = i.busy_code
    WHERE i.busy_code IS NOT NULL
      AND coalesce(i.is_active, true)
      AND (ipd.busy_code IS NULL OR ipd.confirmed_at IS NULL)
    ORDER BY i.busy_code, i.id
    LIMIT p_limit
  ) t;

  RETURN jsonb_build_object('success', true, 'rows', v_rows);
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_scan_to_uom(TEXT, TEXT[], INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_uom_definition(NUMERIC, INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_uom_coverage_gaps(INTEGER) TO anon, authenticated;
