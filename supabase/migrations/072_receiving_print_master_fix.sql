-- Fix outer label print: null job_public_id LPN codes + 2-level (no inner) pack qty on outer LPN

CREATE OR REPLACE FUNCTION public.receiving_print_master_labels(
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
  v_job_tag TEXT;
  v_i INTEGER;
  v_lpn TEXT;
  v_seq INTEGER := 0;
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

  IF v_line.receive_mode <> 'structured' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'master_labels_only_for_structured_mode');
  END IF;

  IF v_line.master_labels_printed_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'master_labels_already_printed');
  END IF;

  IF v_line.master_labels_count <= 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'master_labels_count_zero');
  END IF;

  SELECT s.item_id_snapshot, s.item_name_snapshot INTO v_item_id, v_item_name
  FROM public.wms_item_snapshot(v_line.busy_code) AS s
  LIMIT 1;

  v_item_name := coalesce(nullif(trim(v_line.sku_description_snapshot), ''), v_item_name, 'SKU');
  v_inner_ea := greatest(1, v_line.ea_per_inner);

  -- 2-level: no inner cartons — outer sticker qty = pcs per outer (ea_per_inner)
  IF v_line.inner_per_master IS NULL OR v_line.inner_per_master <= 0 THEN
    v_outer_ea := v_inner_ea;
  ELSE
    v_outer_ea := v_line.inner_per_master * v_inner_ea;
  END IF;

  v_job_tag := coalesce(nullif(replace(v_job.job_public_id, '-', ''), ''), 'J' || v_job.id::text);

  FOR v_i IN 1..v_line.master_labels_count LOOP
    v_seq := v_seq + 1;
    v_lpn := 'M-' || v_job_tag || '-' || v_line.line_no::text || '-' || v_i::text;
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
      v_outer_ea,
      v_outer_ea,
      'available',
      v_line.id,
      v_line.lot_no,
      v_seq,
      'printed'
    );
    v_inserted_master := v_inserted_master + 1;
  END LOOP;

  UPDATE public.receiving_job_lines
  SET master_labels_printed_at = now()
  WHERE id = p_job_line_id;

  RETURN jsonb_build_object(
    'success', true,
    'master_inserted', v_inserted_master
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receiving_print_master_labels(BIGINT, BIGINT, TEXT) TO anon, authenticated;
