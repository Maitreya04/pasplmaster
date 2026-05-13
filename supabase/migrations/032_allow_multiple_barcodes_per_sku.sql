-- Migration 032: Allow multiple barcodes per SKU.
-- 
-- The previous migration (031) prevented mapping multiple barcode keys to the same SKU.
-- This was too restrictive — products often have multiple barcodes from different batches,
-- manufacturers, or package sizes. 
--
-- This migration removes that check while keeping the important constraint:
-- one barcode_key can only map to ONE SKU (prevents conflicts).

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
  v_normalized_key TEXT;
BEGIN
  -- Normalize the barcode key: trim whitespace
  v_normalized_key := trim(coalesce(p_barcode_key, ''));

  IF NULLIF(trim(coalesce(p_barcode_raw, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid', 'message', 'barcode_raw is required');
  END IF;

  IF NULLIF(v_normalized_key, '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid', 'message', 'barcode_key is required');
  END IF;

  IF p_match_strategy NOT IN ('exact', 'prefix_hyphen', 'prefix_space', 'slash_separated', 'structured_field', 'manual') THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid', 'message', 'Invalid match strategy');
  END IF;

  IF p_sku_busy_code IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'invalid', 'message', 'sku_busy_code is required');
  END IF;

  -- Get the item name for the new SKU
  SELECT name INTO v_new_item_name
  FROM public.items
  WHERE busy_code::NUMERIC = p_sku_busy_code
  ORDER BY id
  LIMIT 1;

  -- Check if THIS SPECIFIC barcode_key is already mapped (to any SKU)
  SELECT * INTO v_existing
  FROM public.item_barcodes
  WHERE barcode_key = v_normalized_key;

  IF FOUND THEN
    -- If already mapped to the SAME SKU, just report success (idempotent)
    IF v_existing.sku_busy_code = p_sku_busy_code THEN
      RETURN jsonb_build_object(
        'success', true,
        'status', 'already_mapped',
        'barcode_key', v_normalized_key,
        'sku_busy_code', p_sku_busy_code,
        'item_name', v_new_item_name,
        'message', 'This barcode is already mapped to this SKU.'
      );
    END IF;

    -- Mapped to a DIFFERENT SKU — this is a conflict
    SELECT name INTO v_existing_item_name
    FROM public.items
    WHERE busy_code::NUMERIC = v_existing.sku_busy_code
    ORDER BY id
    LIMIT 1;

    IF NOT p_force THEN
      RETURN jsonb_build_object(
        'success', false,
        'status', 'conflict',
        'barcode_key', v_normalized_key,
        'existing_sku', v_existing.sku_busy_code,
        'existing_item_name', v_existing_item_name,
        'existing_bin_id', v_existing.bin_id,
        'new_sku', p_sku_busy_code,
        'new_item_name', v_new_item_name,
        'message', 'This barcode is already mapped to a different SKU.'
      );
    END IF;

    -- Force override: update the existing mapping to point to new SKU
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
    WHERE barcode_key = v_normalized_key;

    RETURN jsonb_build_object(
      'success', true,
      'status', 'overridden',
      'barcode_key', v_normalized_key,
      'sku_busy_code', p_sku_busy_code,
      'item_name', v_new_item_name,
      'previous_sku', v_existing.sku_busy_code,
      'previous_item_name', v_existing_item_name
    );
  END IF;

  -- No existing mapping for this barcode_key — insert new mapping
  -- Note: We allow multiple barcode_keys to map to the same SKU
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
    v_normalized_key,
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
    'barcode_key', v_normalized_key,
    'sku_busy_code', p_sku_busy_code,
    'match_strategy', p_match_strategy,
    'item_name', v_new_item_name
  );
END;
$$;

-- Add a comment explaining the design decision
COMMENT ON FUNCTION public.save_barcode_mapping IS 
'Maps manufacturer barcodes to SKUs for verification.
One barcode_key can only map to ONE SKU (enforced).
One SKU can have MULTIPLE barcode_keys (allowed - different batches, manufacturers, etc).';
