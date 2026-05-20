-- PASPL — Insert receiving license plates (master=outer + inner) after ratio confirmed.

CREATE OR REPLACE FUNCTION public.receiving_print_job_line_labels(
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
  v_outer_ea INTEGER;
  v_inner_ea INTEGER;
  v_i INTEGER;
  v_j INTEGER;
  v_lpn TEXT;
  v_seq INTEGER := 0;
  v_inserted_inner INTEGER := 0;
  v_inserted_master INTEGER := 0;
BEGIN
  SELECT * INTO v_line FROM public.receiving_job_lines WHERE id = p_job_line_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'line_not_found');
  END IF;

  SELECT * INTO v_job FROM public.receiving_jobs WHERE id = v_line.receiving_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'job_not_found');
  END IF;

  SELECT s.item_id_snapshot, s.item_name_snapshot INTO v_item_id, v_item_name
  FROM public.wms_item_snapshot(v_line.busy_code) AS s
  LIMIT 1;

  v_item_name := coalesce(nullif(trim(v_line.sku_description_snapshot), ''), v_item_name, 'SKU');

  v_inner_ea := v_line.ea_per_inner;
  v_outer_ea := CASE
    WHEN v_line.receive_mode = 'structured'
      THEN greatest(1, coalesce(v_line.inner_per_master, 0)) * greatest(1, v_inner_ea)
    ELSE v_inner_ea
  END;

  IF v_line.receive_mode = 'loose' THEN
    RETURN jsonb_build_object('success', true, 'master_inserted', 0, 'inner_inserted', 0, 'reason', 'loose_mode_no_pack_labels');
  END IF;

  IF v_line.labels_printed_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_printed');
  END IF;

  -- Master (outer) labels
  IF v_line.master_labels_count > 0 AND v_line.receive_mode = 'structured' THEN
    FOR v_i IN 1..v_line.master_labels_count LOOP
      v_seq := v_seq + 1;
      v_lpn := 'M-' || replace(v_job.job_public_id, '-', '') || '-' || v_line.line_no::text || '-' || v_i::text;
      IF EXISTS (SELECT 1 FROM public.license_plates WHERE lpn_code = v_lpn) THEN
        v_lpn := v_lpn || '-' || substr(md5(random()::text), 1, 4);
      END IF;
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
        'outer',
        greatest(1, v_outer_ea),
        greatest(1, v_outer_ea),
        'available',
        v_line.id,
        v_line.lot_no,
        v_seq,
        'printed'
      );
      v_inserted_master := v_inserted_master + 1;
    END LOOP;
  END IF;

  -- Inner labels
  IF v_line.inner_labels_count > 0 THEN
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
        greatest(1, v_inner_ea),
        greatest(1, v_inner_ea),
        'available',
        v_line.id,
        v_line.lot_no,
        v_j,
        'printed'
      );
      v_inserted_inner := v_inserted_inner + 1;
    END LOOP;
  END IF;

  UPDATE public.receiving_job_lines
  SET labels_printed_at = now()
  WHERE id = p_job_line_id;

  RETURN jsonb_build_object(
    'success', true,
    'master_inserted', v_inserted_master,
    'inner_inserted', v_inserted_inner
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receiving_print_job_line_labels(BIGINT, BIGINT, TEXT) TO anon, authenticated;
