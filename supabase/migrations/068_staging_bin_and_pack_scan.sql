-- STAGING bin convention (STG-*) + putaway scan accepts PASPL-PACK inner + promote layer RPC

-- STG-DEFAULT is a convention (see src/lib/wms/stagingBin.ts); layers are created on first putaway.

-- Extend putaway scan: LPN first, then PASPL-PACK:busy:inner for open inners on job line
DROP FUNCTION IF EXISTS public.receiving_resolve_lp_scan(TEXT);

CREATE OR REPLACE FUNCTION public.receiving_resolve_lp_scan(
  p_scan_raw TEXT,
  p_job_line_id BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lp_code TEXT;
  v_pack JSONB;
  v_busy NUMERIC;
  v_pack_type TEXT;
  r_lp public.license_plates%ROWTYPE;
  r_line public.receiving_job_lines%ROWTYPE;
  r_job public.receiving_jobs%ROWTYPE;
  v_disp TEXT[] := ARRAY[]::TEXT[];
  v_candidates JSONB := '[]'::JSONB;
  v_open_count INTEGER := 0;
BEGIN
  v_lp_code := upper(trim(coalesce(public.extract_lpn_code(p_scan_raw), '')));

  IF v_lp_code IS NULL OR v_lp_code = '' THEN
    v_pack := public.extract_pack_pick_payload(p_scan_raw);
    IF v_pack IS NULL OR (v_pack->>'pack_type') IS DISTINCT FROM 'inner' THEN
      RETURN jsonb_build_object('success', false, 'reason', 'lpn_or_inner_pack_required');
    END IF;
    v_busy := (v_pack->>'busy_code')::NUMERIC;
    v_pack_type := lower(trim(v_pack->>'pack_type'));

    IF p_job_line_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'reason', 'job_line_required_for_pack_scan');
    END IF;

    SELECT * INTO r_line FROM public.receiving_job_lines WHERE id = p_job_line_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'reason', 'job_line_not_found');
    END IF;

    IF r_line.busy_code IS DISTINCT FROM v_busy THEN
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'pack_busy_mismatch',
        'expected_busy', r_line.busy_code,
        'scanned_busy', v_busy
      );
    END IF;

    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'id', lp.id,
        'lpn_code', lp.lpn_code,
        'receiving_pack_seq', lp.receiving_pack_seq,
        'receiving_lot', lp.receiving_lot,
        'pack_qty', lp.pack_qty
      ) ORDER BY lp.receiving_pack_seq NULLS LAST, lp.id
    ), '[]'::JSONB),
    count(*)::INTEGER
    INTO v_candidates, v_open_count
    FROM public.license_plates lp
    WHERE lp.receiving_job_line_id = p_job_line_id
      AND lp.pack_type = 'inner'
      AND lp.invalidated_at IS NULL
      AND lp.receiving_lp_state IN ('printed', 'received_dock');

    IF v_open_count = 0 THEN
      RETURN jsonb_build_object('success', false, 'reason', 'no_open_inner_for_pack_scan');
    END IF;

    IF v_open_count > 1 THEN
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'pick_inner_lp',
        'candidates', v_candidates,
        'scanned_pack', v_pack
      );
    END IF;

    SELECT * INTO r_lp
    FROM public.license_plates lp
    WHERE lp.receiving_job_line_id = p_job_line_id
      AND lp.pack_type = 'inner'
      AND lp.invalidated_at IS NULL
      AND lp.receiving_lp_state IN ('printed', 'received_dock')
    ORDER BY lp.receiving_pack_seq NULLS LAST, lp.id
    LIMIT 1;
  ELSE
    SELECT * INTO r_lp
    FROM public.license_plates
    WHERE upper(trim(lpn_code)) = v_lp_code
      AND invalidated_at IS NULL;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'reason', 'lp_not_found');
    END IF;
  END IF;

  IF r_lp.receiving_job_line_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'lp_not_tied_to_receiving_job',
      'license_plate', to_jsonb(r_lp)
    );
  END IF;

  SELECT * INTO r_line FROM public.receiving_job_lines WHERE id = r_lp.receiving_job_line_id;
  SELECT * INTO r_job FROM public.receiving_jobs WHERE id = r_line.receiving_job_id;

  IF r_line.receive_mode = 'loose' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'loose_line_no_putaway');
  END IF;

  IF r_lp.pack_type <> 'inner' THEN
    v_disp := ARRAY['note_outer_lp'];
  ELSE
    IF r_lp.receiving_lp_state IN ('printed', 'received_dock') THEN
      v_disp := ARRAY['overflow', 'whole', 'break'];
    ELSIF r_lp.receiving_lp_state = 'broken' THEN
      v_disp := ARRAY['putaway_bulk', 'putaway_each'];
    ELSIF r_lp.receiving_lp_state = 'overflow' THEN
      v_disp := ARRAY[]::TEXT[];
    ELSIF r_lp.receiving_lp_state = 'sold_whole' THEN
      v_disp := ARRAY[]::TEXT[];
    ELSE
      v_disp := ARRAY['overflow', 'whole', 'break'];
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'license_plate', to_jsonb(r_lp),
    'job_line', to_jsonb(r_line),
    'job', to_jsonb(r_job),
    'allowed_dispositions', to_jsonb(v_disp),
    'mrp_required', r_line.mrp_per_ea IS NOT NULL,
    'putaway_ea_remaining', r_lp.receiving_putaway_ea_remaining,
    'resolved_by', CASE WHEN v_lp_code IS NOT NULL AND v_lp_code <> '' THEN 'lpn' ELSE 'pack' END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receiving_resolve_lp_scan(TEXT, BIGINT) TO anon, authenticated;

-- Move qty from a staging layer to a real bin (preserve MRP + lot)
CREATE OR REPLACE FUNCTION public.wms_promote_staging_layer(
  p_layer_id BIGINT,
  p_to_bin_id TEXT,
  p_qty_ea INTEGER,
  p_user_id BIGINT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r_layer public.bin_inventory_layers%ROWTYPE;
  v_to TEXT := public.wms_normalize_bin_id(p_to_bin_id);
  v_qty INTEGER;
  v_moved INTEGER;
BEGIN
  IF v_to IS NULL OR v_to = '' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'to_bin_required');
  END IF;

  IF upper(v_to) LIKE 'STG-%' OR upper(v_to) = 'STG-DEFAULT' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'cannot_promote_to_staging');
  END IF;

  SELECT * INTO r_layer FROM public.bin_inventory_layers WHERE id = p_layer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'layer_not_found');
  END IF;

  IF upper(r_layer.bin_id) NOT LIKE 'STG-%' AND upper(r_layer.bin_id) <> 'STG-DEFAULT' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'source_not_staging');
  END IF;

  v_qty := greatest(1, coalesce(p_qty_ea, r_layer.qty_ea));
  IF v_qty > r_layer.qty_ea THEN
    RETURN jsonb_build_object('success', false, 'reason', 'qty_exceeds_layer', 'available', r_layer.qty_ea);
  END IF;

  UPDATE public.bin_inventory_layers
  SET qty_ea = qty_ea - v_qty
  WHERE id = p_layer_id;

  DELETE FROM public.bin_inventory_layers WHERE id = p_layer_id AND qty_ea <= 0;

  PERFORM public.wms_recompute_bin_inventory_rollup(r_layer.bin_id, r_layer.sku_busy_code);

  v_moved := public.wms_apply_bin_layer_delta(
    v_to,
    r_layer.sku_busy_code,
    v_qty,
    r_layer.mrp_per_ea,
    r_layer.lot_no,
    r_layer.receiving_job_line_id,
    r_layer.source_license_plate_id,
    r_layer.item_id_snapshot,
    r_layer.item_name_snapshot,
    NULL
  );

  RETURN jsonb_build_object(
    'success', true,
    'from_bin', r_layer.bin_id,
    'to_bin', v_to,
    'qty_ea', v_qty,
    'layer_id', v_moved
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.wms_promote_staging_layer(BIGINT, TEXT, INTEGER, BIGINT, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.receiving_resolve_lp_scan IS 'Resolve inner LPN by code or PASPL-PACK inner when one open inner exists on job line.';
COMMENT ON FUNCTION public.wms_promote_staging_layer IS 'Move EA from STG-* layer to a real rack bin.';
