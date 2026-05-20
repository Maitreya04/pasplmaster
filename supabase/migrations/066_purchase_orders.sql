-- PASPL — Supplier purchase orders, invoices, linkage to receiving jobs.

CREATE SEQUENCE IF NOT EXISTS public.purchase_order_number_seq;

CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id BIGSERIAL PRIMARY KEY,
  po_number TEXT NOT NULL UNIQUE,
  supplier_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'partially_received', 'closed', 'cancelled')),
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('excel_upload', 'manual')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_created_at ON public.purchase_orders(created_at DESC);

CREATE OR REPLACE FUNCTION public.set_purchase_order_po_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.po_number IS NULL OR trim(NEW.po_number) = '' THEN
    NEW.po_number := 'PO-' || to_char(timezone('utc', now()), 'YYYY') || '-' ||
      lpad(nextval('public.purchase_order_number_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchase_orders_po_number ON public.purchase_orders;
CREATE TRIGGER trg_purchase_orders_po_number
  BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_purchase_order_po_number();

CREATE TABLE IF NOT EXISTS public.purchase_order_lines (
  id BIGSERIAL PRIMARY KEY,
  purchase_order_id BIGINT NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL DEFAULT 1,
  busy_code NUMERIC NOT NULL,
  description_snapshot TEXT NOT NULL,
  qty_ordered INTEGER NOT NULL DEFAULT 0 CHECK (qty_ordered >= 0),
  qty_received INTEGER NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  suggested_qty_from_demand INTEGER,
  unit_rate NUMERIC,
  match_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (match_status IN ('pending', 'matched', 'short', 'over')),
  UNIQUE (purchase_order_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_po ON public.purchase_order_lines(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_busy ON public.purchase_order_lines(busy_code);

CREATE TABLE IF NOT EXISTS public.supplier_invoices (
  id BIGSERIAL PRIMARY KEY,
  purchase_order_id BIGINT NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  invoice_number TEXT,
  invoice_date DATE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'reviewed', 'matched', 'discrepancy')),
  storage_path TEXT,
  file_name TEXT,
  extracted_at TIMESTAMPTZ,
  raw_extract_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_po ON public.supplier_invoices(purchase_order_id);

CREATE TABLE IF NOT EXISTS public.supplier_invoice_lines (
  id BIGSERIAL PRIMARY KEY,
  supplier_invoice_id BIGINT NOT NULL REFERENCES public.supplier_invoices(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL DEFAULT 1,
  part_no_raw TEXT,
  description_raw TEXT,
  qty_billed NUMERIC NOT NULL DEFAULT 0 CHECK (qty_billed >= 0),
  rate_per_ea NUMERIC,
  busy_code NUMERIC,
  purchase_order_line_id BIGINT REFERENCES public.purchase_order_lines(id) ON DELETE SET NULL,
  match_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (match_status IN ('pending', 'matched', 'short', 'over')),
  review_note TEXT,
  UNIQUE (supplier_invoice_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_lines_inv ON public.supplier_invoice_lines(supplier_invoice_id);

ALTER TABLE public.receiving_jobs
  ADD COLUMN IF NOT EXISTS purchase_order_id BIGINT REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_invoice_id BIGINT REFERENCES public.supplier_invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receiving_jobs_purchase_order ON public.receiving_jobs(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_receiving_jobs_supplier_invoice ON public.receiving_jobs(supplier_invoice_id);

ALTER TABLE public.receiving_job_lines
  ADD COLUMN IF NOT EXISTS purchase_order_line_id BIGINT REFERENCES public.purchase_order_lines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_roll_up_applied_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_receiving_job_lines_po_line ON public.receiving_job_lines(purchase_order_line_id);

-- ─── RLS (match receiving_jobs pattern) ───
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_invoice_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_orders_authenticated_all ON public.purchase_orders;
CREATE POLICY purchase_orders_authenticated_all
  ON public.purchase_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS purchase_orders_anon_all ON public.purchase_orders;
CREATE POLICY purchase_orders_anon_all
  ON public.purchase_orders FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS purchase_order_lines_authenticated_all ON public.purchase_order_lines;
CREATE POLICY purchase_order_lines_authenticated_all
  ON public.purchase_order_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS purchase_order_lines_anon_all ON public.purchase_order_lines;
CREATE POLICY purchase_order_lines_anon_all
  ON public.purchase_order_lines FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS supplier_invoices_authenticated_all ON public.supplier_invoices;
CREATE POLICY supplier_invoices_authenticated_all
  ON public.supplier_invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS supplier_invoices_anon_all ON public.supplier_invoices;
CREATE POLICY supplier_invoices_anon_all
  ON public.supplier_invoices FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS supplier_invoice_lines_authenticated_all ON public.supplier_invoice_lines;
CREATE POLICY supplier_invoice_lines_authenticated_all
  ON public.supplier_invoice_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS supplier_invoice_lines_anon_all ON public.supplier_invoice_lines;
CREATE POLICY supplier_invoice_lines_anon_all
  ON public.supplier_invoice_lines FOR ALL TO anon USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_order_lines TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_invoices TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_invoice_lines TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.purchase_orders_id_seq TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.purchase_order_lines_id_seq TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.supplier_invoices_id_seq TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.supplier_invoice_lines_id_seq TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.purchase_order_number_seq TO anon, authenticated;

-- ─── Helpers ───

CREATE OR REPLACE FUNCTION public.purchase_recompute_order_status(p_po_id BIGINT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_ordered BIGINT;
  v_total_received BIGINT;
  v_status TEXT;
BEGIN
  SELECT coalesce(sum(qty_ordered), 0), coalesce(sum(qty_received), 0)
    INTO v_total_ordered, v_total_received
  FROM public.purchase_order_lines
  WHERE purchase_order_id = p_po_id;

  SELECT status INTO v_status FROM public.purchase_orders WHERE id = p_po_id;
  IF NOT FOUND OR v_status = 'cancelled' THEN
    RETURN;
  END IF;

  IF v_total_received <= 0 THEN
    RETURN;
  ELSIF v_total_received >= v_total_ordered AND v_total_ordered > 0 THEN
    UPDATE public.purchase_orders SET status = 'closed' WHERE id = p_po_id;
  ELSE
    UPDATE public.purchase_orders SET status = 'partially_received' WHERE id = p_po_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.receiving_recompute_receive_status_for_job(p_job_id BIGINT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.receiving_jobs%ROWTYPE;
  v_exp NUMERIC;
  v_act NUMERIC;
  v_status TEXT;
BEGIN
  SELECT * INTO v_job FROM public.receiving_jobs WHERE id = p_job_id;
  IF NOT FOUND OR v_job.supplier_invoice_id IS NULL THEN
    RETURN;
  END IF;

  SELECT coalesce(sum(qty_billed), 0) INTO v_exp
  FROM public.supplier_invoice_lines
  WHERE supplier_invoice_id = v_job.supplier_invoice_id;

  SELECT coalesce(sum(total_ea), 0) INTO v_act
  FROM public.receiving_job_lines
  WHERE receiving_job_id = p_job_id;

  IF v_exp <= 0 THEN
    RETURN;
  END IF;

  IF v_act < v_exp THEN
    v_status := 'SHORT';
  ELSIF v_act > v_exp THEN
    v_status := 'OVER';
  ELSE
    v_status := 'MATCHED';
  END IF;

  UPDATE public.receiving_jobs SET receive_status = v_status WHERE id = p_job_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.receiving_inner_line_putaway_complete(p_job_line_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.license_plates lp
    WHERE lp.receiving_job_line_id = p_job_line_id
      AND lp.invalidated_at IS NULL
      AND lp.pack_type = 'inner'
      AND NOT (
        lp.status = 'depleted'
        OR lp.receiving_lp_state IN ('sold_whole', 'overflow')
        OR (
          lp.receiving_lp_state = 'broken'
          AND coalesce(lp.receiving_putaway_ea_remaining, 0) <= 0
        )
      )
  );
END;
$$;

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
    v_eligible :=
      v_line.inner_labels_printed_at IS NOT NULL
      AND public.receiving_inner_line_putaway_complete(p_job_line_id)
      AND EXISTS (
        SELECT 1 FROM public.license_plates lp
        WHERE lp.receiving_job_line_id = p_job_line_id
          AND lp.invalidated_at IS NULL
          AND lp.pack_type = 'inner'
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

GRANT EXECUTE ON FUNCTION public.receiving_try_roll_up_po_for_job_line(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receiving_recompute_receive_status_for_job(BIGINT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_recompute_order_status(BIGINT) TO anon, authenticated;

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
      'loose',
      0,
      NULL,
      0,
      1,
      greatest(0, ceil(r_il.qty_billed))::integer,
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

GRANT EXECUTE ON FUNCTION public.create_receiving_job_from_invoice(BIGINT, BIGINT, TEXT) TO anon, authenticated;

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
      'loose',
      0,
      NULL,
      0,
      1,
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

GRANT EXECUTE ON FUNCTION public.create_receiving_job_from_purchase_order(BIGINT, BIGINT, TEXT) TO anon, authenticated;

COMMENT ON TABLE public.purchase_orders IS 'Supplier purchase orders; Purchase UI creates rows; receiving links via purchase_order_id.';
COMMENT ON COLUMN public.receiving_job_lines.purchase_roll_up_applied_at IS 'Set when qty_received was incremented on linked purchase_order_lines (once per receiving line).';
