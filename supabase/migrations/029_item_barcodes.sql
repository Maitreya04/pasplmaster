-- PASPL Master — Manufacturer barcode to SKU mappings.
--
-- Warehouse/admin users can build this lookup progressively by scanning a bin
-- QR for SKU context, then scanning the manufacturer's barcode on the item.

CREATE TABLE IF NOT EXISTS public.item_barcodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode_key TEXT NOT NULL UNIQUE,
  barcode_raw TEXT NOT NULL,
  sku_busy_code NUMERIC NOT NULL,
  match_strategy TEXT NOT NULL DEFAULT 'exact'
    CHECK (match_strategy IN ('exact', 'prefix_hyphen', 'prefix_space', 'manual')),
  mapped_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  mapped_by_name TEXT,
  mapped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bin_id TEXT,
  manufacturer TEXT,
  had_conflict BOOLEAN NOT NULL DEFAULT false,
  conflict_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_item_barcodes_key
  ON public.item_barcodes(barcode_key);
CREATE INDEX IF NOT EXISTS idx_item_barcodes_sku
  ON public.item_barcodes(sku_busy_code);
CREATE INDEX IF NOT EXISTS idx_item_barcodes_mapped_at
  ON public.item_barcodes(mapped_at DESC);

CREATE OR REPLACE FUNCTION public.save_barcode_mapping(
  p_barcode_raw TEXT,
  p_barcode_key TEXT,
  p_match_strategy TEXT,
  p_sku_busy_code NUMERIC,
  p_bin_id TEXT DEFAULT NULL,
  p_manufacturer TEXT DEFAULT NULL,
  p_mapped_by_user_id BIGINT DEFAULT NULL,
  p_mapped_by_name TEXT DEFAULT NULL,
  p_force BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.item_barcodes%ROWTYPE;
  v_existing_item_name TEXT;
  v_new_item_name TEXT;
BEGIN
  IF NULLIF(trim(coalesce(p_barcode_raw, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid', 'message', 'barcode_raw is required');
  END IF;

  IF NULLIF(trim(coalesce(p_barcode_key, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid', 'message', 'barcode_key is required');
  END IF;

  IF p_match_strategy NOT IN ('exact', 'prefix_hyphen', 'prefix_space', 'manual') THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid', 'message', 'Invalid match strategy');
  END IF;

  IF p_sku_busy_code IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid', 'message', 'sku_busy_code is required');
  END IF;

  SELECT name INTO v_new_item_name
  FROM public.items
  WHERE busy_code::NUMERIC = p_sku_busy_code
  ORDER BY id
  LIMIT 1;

  SELECT * INTO v_existing
  FROM public.item_barcodes
  WHERE barcode_key = trim(p_barcode_key);

  IF FOUND THEN
    IF v_existing.sku_busy_code = p_sku_busy_code THEN
      RETURN jsonb_build_object(
        'success', true,
        'status', 'already_mapped',
        'barcode_key', trim(p_barcode_key),
        'sku_busy_code', p_sku_busy_code,
        'item_name', v_new_item_name
      );
    END IF;

    SELECT name INTO v_existing_item_name
    FROM public.items
    WHERE busy_code::NUMERIC = v_existing.sku_busy_code
    ORDER BY id
    LIMIT 1;

    IF NOT p_force THEN
      RETURN jsonb_build_object(
        'success', false,
        'status', 'conflict',
        'barcode_key', trim(p_barcode_key),
        'existing_sku', v_existing.sku_busy_code,
        'existing_item_name', v_existing_item_name,
        'existing_bin_id', v_existing.bin_id,
        'new_sku', p_sku_busy_code,
        'new_item_name', v_new_item_name,
        'message', 'This barcode is already mapped to a different SKU.'
      );
    END IF;

    UPDATE public.item_barcodes
    SET sku_busy_code = p_sku_busy_code,
        barcode_raw = trim(p_barcode_raw),
        match_strategy = p_match_strategy,
        mapped_by_user_id = p_mapped_by_user_id,
        mapped_by_name = p_mapped_by_name,
        mapped_at = now(),
        bin_id = NULLIF(trim(coalesce(p_bin_id, '')), ''),
        manufacturer = NULLIF(trim(coalesce(p_manufacturer, '')), ''),
        had_conflict = true,
        conflict_note = 'Overridden from SKU ' || v_existing.sku_busy_code::text
    WHERE barcode_key = trim(p_barcode_key);

    RETURN jsonb_build_object(
      'success', true,
      'status', 'overridden',
      'barcode_key', trim(p_barcode_key),
      'sku_busy_code', p_sku_busy_code,
      'item_name', v_new_item_name
    );
  END IF;

  INSERT INTO public.item_barcodes (
    barcode_key,
    barcode_raw,
    sku_busy_code,
    match_strategy,
    mapped_by_user_id,
    mapped_by_name,
    mapped_at,
    bin_id,
    manufacturer
  ) VALUES (
    trim(p_barcode_key),
    trim(p_barcode_raw),
    p_sku_busy_code,
    p_match_strategy,
    p_mapped_by_user_id,
    p_mapped_by_name,
    now(),
    NULLIF(trim(coalesce(p_bin_id, '')), ''),
    NULLIF(trim(coalesce(p_manufacturer, '')), '')
  );

  RETURN jsonb_build_object(
    'success', true,
    'status', 'saved',
    'barcode_key', trim(p_barcode_key),
    'sku_busy_code', p_sku_busy_code,
    'match_strategy', p_match_strategy,
    'item_name', v_new_item_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_barcode_coverage()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total_skus INTEGER;
  v_mapped_skus INTEGER;
BEGIN
  SELECT COUNT(DISTINCT busy_code)
  INTO v_total_skus
  FROM public.items
  WHERE is_active IS TRUE
    AND busy_code IS NOT NULL;

  SELECT COUNT(DISTINCT sku_busy_code)
  INTO v_mapped_skus
  FROM public.item_barcodes;

  RETURN jsonb_build_object(
    'total_active_skus', v_total_skus,
    'mapped_skus', v_mapped_skus,
    'unmapped_skus', GREATEST(v_total_skus - v_mapped_skus, 0),
    'coverage_pct', COALESCE(ROUND((v_mapped_skus::NUMERIC / NULLIF(v_total_skus, 0)) * 100, 1), 0)
  );
END;
$$;
