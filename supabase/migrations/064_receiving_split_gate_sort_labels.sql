-- PASPL — Split receiving label print: gate (master/outer only) vs sort (inner only).

ALTER TABLE public.receiving_job_lines
  ADD COLUMN IF NOT EXISTS master_labels_printed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inner_labels_printed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS po_verification_status TEXT NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (po_verification_status IN ('UNVERIFIED', 'VERIFIED', 'DISCREPANCY')),
  ADD COLUMN IF NOT EXISTS po_verification_note TEXT,
  ADD COLUMN IF NOT EXISTS po_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS po_verified_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS po_verified_by_name TEXT;

COMMENT ON COLUMN public.receiving_job_lines.master_labels_printed_at IS 'Gate: outer/master license_plates created.';
COMMENT ON COLUMN public.receiving_job_lines.inner_labels_printed_at IS 'Sort: inner license_plates created after ratio confirmed.';
COMMENT ON COLUMN public.receiving_job_lines.po_verification_status IS 'Optional human PO/challan check; not auto three-way match.';

-- Backfill from legacy single timestamp
UPDATE public.receiving_job_lines
SET
  master_labels_printed_at = COALESCE(master_labels_printed_at, labels_printed_at),
  inner_labels_printed_at = COALESCE(inner_labels_printed_at, labels_printed_at)
WHERE labels_printed_at IS NOT NULL;

-- Master labels only (gate), structured mode with master cartons
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
  v_outer_ea := greatest(1, coalesce(v_line.inner_per_master, 0)) * v_inner_ea;
  IF v_outer_ea < v_inner_ea THEN
    v_outer_ea := v_inner_ea;
  END IF;

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

-- Inner labels only (after sort ratio confirmed)
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

  IF v_line.receive_mode = 'structured' AND v_line.master_labels_printed_at IS NULL THEN
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
  SET
    inner_labels_printed_at = now(),
    labels_printed_at = now()
  WHERE id = p_job_line_id;

  RETURN jsonb_build_object(
    'success', true,
    'inner_inserted', v_inserted_inner
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receiving_print_inner_labels(BIGINT, BIGINT, TEXT) TO anon, authenticated;

-- Deprecated: combined print — forward to clearer errors
CREATE OR REPLACE FUNCTION public.receiving_print_job_line_labels(
  p_job_line_id BIGINT,
  p_user_id BIGINT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN jsonb_build_object(
    'success', false,
    'reason', 'deprecated_use_receiving_print_master_labels_and_receiving_print_inner_labels'
  );
END;
$$;
