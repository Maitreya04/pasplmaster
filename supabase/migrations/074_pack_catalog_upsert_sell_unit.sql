-- Pack Catalog: persist sell_unit on bulk upsert and dashboard edits.

CREATE OR REPLACE FUNCTION public.upsert_item_pack_definitions(
  p_rows JSONB,
  p_source_file TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row JSONB;
  v_busy_code NUMERIC;
  v_item_id BIGINT;
  v_item_name TEXT;
  v_inner INTEGER;
  v_outer INTEGER;
  v_sell_unit TEXT;
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

    v_sell_unit := upper(trim(coalesce(v_row->>'sell_unit', '')));
    IF v_sell_unit NOT IN ('EACH', 'PACK', 'BOTH') THEN
      v_sell_unit := 'EACH';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.item_pack_definitions WHERE busy_code = v_busy_code
    ) INTO v_existing;

    INSERT INTO public.item_pack_definitions (
      busy_code,
      item_id_snapshot,
      item_name_snapshot,
      inner_pack_qty,
      outer_pack_qty,
      sell_unit,
      source_file,
      updated_at
    ) VALUES (
      v_busy_code,
      v_item_id,
      v_item_name,
      v_inner,
      v_outer,
      v_sell_unit,
      p_source_file,
      now()
    )
    ON CONFLICT (busy_code) DO UPDATE
    SET item_id_snapshot = EXCLUDED.item_id_snapshot,
        item_name_snapshot = EXCLUDED.item_name_snapshot,
        inner_pack_qty = EXCLUDED.inner_pack_qty,
        outer_pack_qty = EXCLUDED.outer_pack_qty,
        sell_unit = EXCLUDED.sell_unit,
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
