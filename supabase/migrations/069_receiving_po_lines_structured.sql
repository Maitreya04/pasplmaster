-- PO/invoice receiving: seed structured lines (per-SKU gate + sort), not loose with PO qty as total_ea.

ALTER TABLE public.receiving_job_lines
  ADD COLUMN IF NOT EXISTS po_qty_expected_ea INTEGER;

COMMENT ON COLUMN public.receiving_job_lines.po_qty_expected_ea IS
  'Reference qty from PO/invoice for operators; confirmed total_ea comes from dock ratio only.';

-- Existing PO loose lines (no labels yet): convert to structured and preserve PO qty as reference.
UPDATE public.receiving_job_lines rjl
SET
  po_qty_expected_ea = CASE
    WHEN rjl.po_qty_expected_ea IS NOT NULL THEN rjl.po_qty_expected_ea
    WHEN rjl.total_ea > 0 THEN rjl.total_ea
    ELSE NULL
  END,
  receive_mode = 'structured',
  total_ea = 0,
  master_carton_qty = 0,
  inner_pack_count = 0,
  master_labels_count = 0,
  inner_labels_count = 0,
  loose_target_bin_id = NULL,
  ratio_verified_at = NULL
WHERE rjl.purchase_order_line_id IS NOT NULL
  AND rjl.receive_mode = 'loose'
  AND rjl.master_labels_printed_at IS NULL
  AND rjl.inner_labels_printed_at IS NULL;

CREATE OR REPLACE FUNCTION public.create_receiving_job_from_invoice(
  p_supplier_invoice_id BIGINT,
  p_user_id BIGINT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.supplier_invoices%ROWTYPE;
  v_po public.purchase_orders%ROWTYPE;
  v_job_id BIGINT;
  v_job_public_id TEXT;
  v_envelope TEXT;
  r_il public.supplier_invoice_lines%ROWTYPE;
  v_line_no INTEGER := 0;
  v_inserted INTEGER := 0;
  v_expected INTEGER;
BEGIN
  SELECT * INTO v_inv FROM public.supplier_invoices WHERE id = p_supplier_invoice_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invoice_not_found');
  END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE id = v_inv.purchase_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'purchase_order_not_found');
  END IF;

  INSERT INTO public.receiving_jobs (
    job_public_id,
    envelope_code,
    triggered_by,
    source_ref,
    qty_basis,
    receive_status,
    po_ref,
    purchase_order_id,
    supplier_invoice_id,
    created_by_user_id,
    created_by_name
  ) VALUES (
    NULL,
    NULL,
    'INVOICE',
    coalesce(nullif(trim(coalesce(v_inv.invoice_number, '')), ''), 'INVOICE-' || v_inv.id::text),
    'CONFIRMED',
    'PENDING',
    v_po.po_number,
    v_po.id,
    v_inv.id,
    p_user_id,
    p_user_name
  )
  RETURNING id INTO v_job_id;

  v_job_public_id := public.format_receiving_job_public_id(v_job_id);
  v_envelope := public.format_receiving_envelope_code(v_job_id);

  UPDATE public.receiving_jobs
  SET job_public_id = v_job_public_id,
      envelope_code = v_envelope
  WHERE id = v_job_id;

  FOR r_il IN
    SELECT * FROM public.supplier_invoice_lines
    WHERE supplier_invoice_id = p_supplier_invoice_id
      AND busy_code IS NOT NULL
    ORDER BY line_no
  LOOP
    v_expected := greatest(0, ceil(r_il.qty_billed))::integer;
    v_line_no := v_line_no + 1;
    INSERT INTO public.receiving_job_lines (
      receiving_job_id,
      line_no,
      busy_code,
      sku_description_snapshot,
      supplier_code_status,
      lot_no,
      receive_mode,
      master_carton_qty,
      inner_per_master,
      inner_pack_count,
      ea_per_inner,
      total_ea,
      po_qty_expected_ea,
      invoice_rate_per_ea,
      purchase_order_line_id,
      sell_unit_snapshot
    ) VALUES (
      v_job_id,
      v_line_no,
      r_il.busy_code,
      coalesce(nullif(trim(r_il.description_raw), ''), 'SKU ' || r_il.busy_code::text),
      'UNMAPPED',
      'INV-' || v_inv.id::text || '-' || r_il.line_no::text,
      'structured',
      0,
      NULL,
      0,
      1,
      0,
      NULLIF(v_expected, 0),
      r_il.rate_per_ea,
      r_il.purchase_order_line_id,
      'EACH'
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  PERFORM public.receiving_recompute_receive_status_for_job(v_job_id);

  RETURN jsonb_build_object(
    'success', true,
    'receiving_job_id', v_job_id,
    'job_public_id', v_job_public_id,
    'envelope_code', v_envelope,
    'lines_inserted', v_inserted
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_receiving_job_from_purchase_order(
  p_purchase_order_id BIGINT,
  p_user_id BIGINT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po public.purchase_orders%ROWTYPE;
  v_job_id BIGINT;
  v_job_public_id TEXT;
  v_envelope TEXT;
  r_pol public.purchase_order_lines%ROWTYPE;
  v_line_no INTEGER := 0;
  v_inserted INTEGER := 0;
BEGIN
  SELECT * INTO v_po FROM public.purchase_orders WHERE id = p_purchase_order_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'purchase_order_not_found');
  END IF;

  INSERT INTO public.receiving_jobs (
    job_public_id,
    envelope_code,
    triggered_by,
    source_ref,
    qty_basis,
    receive_status,
    po_ref,
    purchase_order_id,
    supplier_invoice_id,
    created_by_user_id,
    created_by_name
  ) VALUES (
    NULL,
    NULL,
    'PO',
    v_po.po_number,
    'CONFIRMED',
    'PENDING',
    v_po.po_number,
    v_po.id,
    NULL,
    p_user_id,
    p_user_name
  )
  RETURNING id INTO v_job_id;

  v_job_public_id := public.format_receiving_job_public_id(v_job_id);
  v_envelope := public.format_receiving_envelope_code(v_job_id);

  UPDATE public.receiving_jobs
  SET job_public_id = v_job_public_id,
      envelope_code = v_envelope
  WHERE id = v_job_id;

  FOR r_pol IN
    SELECT * FROM public.purchase_order_lines
    WHERE purchase_order_id = p_purchase_order_id
      AND qty_ordered > 0
    ORDER BY line_no
  LOOP
    v_line_no := v_line_no + 1;
    INSERT INTO public.receiving_job_lines (
      receiving_job_id,
      line_no,
      busy_code,
      sku_description_snapshot,
      supplier_code_status,
      lot_no,
      receive_mode,
      master_carton_qty,
      inner_per_master,
      inner_pack_count,
      ea_per_inner,
      total_ea,
      po_qty_expected_ea,
      invoice_rate_per_ea,
      purchase_order_line_id,
      sell_unit_snapshot
    ) VALUES (
      v_job_id,
      v_line_no,
      r_pol.busy_code,
      r_pol.description_snapshot,
      'UNMAPPED',
      'PO-' || v_po.id::text || '-' || r_pol.line_no::text,
      'structured',
      0,
      NULL,
      0,
      1,
      0,
      r_pol.qty_ordered,
      r_pol.unit_rate,
      r_pol.id,
      'EACH'
    );
    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'receiving_job_id', v_job_id,
    'job_public_id', v_job_public_id,
    'envelope_code', v_envelope,
    'lines_inserted', v_inserted
  );
END;
$$;
