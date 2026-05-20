-- Sort desk: allow breakup print when only piece stickers (0 inner LPNs)

CREATE OR REPLACE FUNCTION public.receiving_print_inner_labels(
  p_job_line_id BIGINT,
  p_user_id BIGINT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line public.receiving_job_lines%ROWTYPE;
  v_job public.receiving_jobs%ROWTYPE;
  v_item_id BIGINT;
  v_item_name TEXT;
  v_inner_ea INTEGER;
  v_j INTEGER;
  v_lpn TEXT;
  v_seq INTEGER;
  v_inserted_inner INTEGER := 0;
  v_existing_max_seq INTEGER;
BEGIN
  SELECT * INTO v_line FROM public.receiving_job_lines WHERE id = p_job_line_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'line_not_found');
  END IF;

  SELECT * INTO v_job FROM public.receiving_jobs WHERE id = v_line.receiving_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'job_not_found');
  END IF;

  IF v_line.receive_mode = 'loose' THEN
    RETURN jsonb_build_object('success', true, 'inner_inserted', 0, 'reason', 'loose_mode_no_pack_labels');
  END IF;

  IF v_line.inner_labels_printed_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'inner_labels_already_printed');
  END IF;

  IF v_line.ratio_verified_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'ratio_not_verified');
  END IF;

  IF v_line.inner_labels_count <= 0 AND v_line.each_labels_count <= 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_breakup_labels_to_print');
  END IF;

  IF v_line.receive_mode = 'structured'
     AND v_line.master_labels_count > 0
     AND v_line.master_labels_printed_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'print_master_labels_first');
  END IF;

  -- Piece stickers only — mark printed; piece cards are generated at print time (no inner LPNs)
  IF v_line.inner_labels_count <= 0 THEN
    UPDATE public.receiving_job_lines
    SET inner_labels_printed_at = now(),
        labels_printed_at = coalesce(labels_printed_at, now())
    WHERE id = p_job_line_id;

    RETURN jsonb_build_object('success', true, 'inner_inserted', 0, 'piece_only', true);
  END IF;

  SELECT s.item_id_snapshot, s.item_name_snapshot INTO v_item_id, v_item_name
  FROM public.wms_item_snapshot(v_line.busy_code) AS s
  LIMIT 1;

  v_item_name := coalesce(nullif(trim(v_line.sku_description_snapshot), ''), v_item_name, 'SKU');
  v_inner_ea := greatest(1, v_line.ea_per_inner);

  SELECT coalesce(max(receiving_pack_seq), 0) INTO v_existing_max_seq
  FROM public.license_plates
  WHERE receiving_job_line_id = v_line.id;

  v_seq := v_existing_max_seq;

  FOR v_j IN 1..v_line.inner_labels_count LOOP
    v_seq := v_seq + 1;
    LOOP
      v_lpn := public.generate_lp_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.license_plates WHERE lpn_code = v_lpn);
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
      status,
      receiving_job_line_id,
      receiving_lot,
      receiving_pack_seq,
      receiving_lp_state
    ) VALUES (
      v_lpn,
      NULL,
      v_line.busy_code,
      v_item_id,
      v_item_name,
      'inner',
      v_inner_ea,
      v_inner_ea,
      'available',
      v_line.id,
      v_line.lot_no,
      v_seq,
      'printed'
    );
    v_inserted_inner := v_inserted_inner + 1;
  END LOOP;

  UPDATE public.receiving_job_lines
  SET inner_labels_printed_at = now(),
      labels_printed_at = coalesce(labels_printed_at, now())
  WHERE id = p_job_line_id;

  RETURN jsonb_build_object(
    'success', true,
    'inner_inserted', v_inserted_inner
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receiving_print_inner_labels(BIGINT, BIGINT, TEXT) TO anon, authenticated;
