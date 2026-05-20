-- Label-count-first receiving: direct outer/inner/piece label counts; piece labels at job time.

COMMENT ON COLUMN public.receiving_job_lines.each_labels_count IS
  'Piece (ITEM QR) labels to print at receiving; identical stickers, not serialized LPNs.';

COMMENT ON COLUMN public.receiving_job_lines.master_labels_count IS
  'Outer/master labels to print (operator-entered in label-plan mode).';

COMMENT ON COLUMN public.receiving_job_lines.inner_labels_count IS
  'Inner pack labels to print (operator-entered; not derived from outer × ratio).';

-- PO rollup: allow after labels printed when label plan saved (piece-only lines may have no inner LPNs).
CREATE OR REPLACE FUNCTION public.receiving_try_roll_up_po_for_job_line(p_job_line_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line public.receiving_job_lines%ROWTYPE;
  v_po_line public.purchase_order_lines%ROWTYPE;
  v_job public.receiving_jobs%ROWTYPE;
  v_eligible BOOLEAN := false;
  v_labels_done BOOLEAN := false;
BEGIN
  SELECT * INTO v_line FROM public.receiving_job_lines WHERE id = p_job_line_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'line_not_found');
  END IF;

  IF v_line.purchase_order_line_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'no_purchase_order_line');
  END IF;

  IF v_line.purchase_roll_up_applied_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'already_applied');
  END IF;

  SELECT * INTO v_po_line FROM public.purchase_order_lines WHERE id = v_line.purchase_order_line_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'purchase_order_line_not_found');
  END IF;

  SELECT * INTO v_job FROM public.receiving_jobs WHERE id = v_line.receiving_job_id;

  IF v_line.receive_mode = 'loose' THEN
    v_eligible :=
      v_line.ratio_verified_at IS NOT NULL
      AND v_line.mrp_per_ea IS NOT NULL
      AND v_line.loose_target_bin_id IS NOT NULL
      AND trim(v_line.loose_target_bin_id) <> '';
  ELSE
    v_labels_done :=
      (v_line.master_labels_count <= 0 OR v_line.master_labels_printed_at IS NOT NULL)
      AND (v_line.inner_labels_count <= 0 OR v_line.inner_labels_printed_at IS NOT NULL);

  v_eligible :=
      v_line.ratio_verified_at IS NOT NULL
      AND v_labels_done
      AND (
        v_line.each_labels_count > 0
        OR public.receiving_inner_line_putaway_complete(p_job_line_id)
        OR (
          v_line.inner_labels_count <= 0
          AND v_line.master_labels_count > 0
          AND v_line.master_labels_printed_at IS NOT NULL
        )
      );
  END IF;

  IF NOT v_eligible THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'putaway_or_ratio_not_complete');
  END IF;

  UPDATE public.purchase_order_lines
  SET qty_received = qty_received + greatest(0, v_line.total_ea)
  WHERE id = v_line.purchase_order_line_id;

  UPDATE public.receiving_job_lines
  SET purchase_roll_up_applied_at = now()
  WHERE id = p_job_line_id;

  PERFORM public.purchase_recompute_order_status(v_po_line.purchase_order_id);

  IF v_job.id IS NOT NULL AND v_job.supplier_invoice_id IS NOT NULL THEN
    PERFORM public.receiving_recompute_receive_status_for_job(v_job.id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'skipped', false,
    'qty_added', v_line.total_ea,
    'purchase_order_line_id', v_line.purchase_order_line_id
  );
END;
$$;

-- Allow inner labels when no outer labels were requested (label-plan: 0 outer, N inner).
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

  IF v_line.inner_labels_count <= 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'inner_labels_count_zero');
  END IF;

  IF v_line.receive_mode = 'structured'
     AND v_line.master_labels_count > 0
     AND v_line.master_labels_printed_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'print_master_labels_first');
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
