-- PASPL — Receiving jobs + job lines (Phase 1). Purchase module will create rows with INVOICE/PO later.

CREATE TABLE IF NOT EXISTS public.receiving_jobs (
  id BIGSERIAL PRIMARY KEY,
  job_public_id TEXT UNIQUE,
  envelope_code TEXT UNIQUE,
  triggered_by TEXT NOT NULL
    CHECK (triggered_by IN ('INVOICE', 'PO', 'MANUAL_ARRIVAL')),
  source_ref TEXT NOT NULL DEFAULT 'WALK-IN',
  qty_basis TEXT NOT NULL
    CHECK (qty_basis IN ('CONFIRMED', 'SPECULATIVE')),
  receive_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (receive_status IN ('PENDING', 'MATCHED', 'SHORT', 'OVER')),
  po_ref TEXT,
  asn_ref TEXT,
  reprint_of_job_id BIGINT REFERENCES public.receiving_jobs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_receiving_jobs_created_at ON public.receiving_jobs(created_at DESC);

CREATE TABLE IF NOT EXISTS public.receiving_job_lines (
  id BIGSERIAL PRIMARY KEY,
  receiving_job_id BIGINT NOT NULL REFERENCES public.receiving_jobs(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL DEFAULT 1,
  busy_code NUMERIC NOT NULL,
  sku_description_snapshot TEXT NOT NULL,
  supplier_type_snapshot TEXT,
  supplier_code_resolved TEXT,
  supplier_code_status TEXT NOT NULL DEFAULT 'UNMAPPED'
    CHECK (supplier_code_status IN ('MAPPED', 'UNMAPPED', 'MULTIPLE')),
  lot_no TEXT NOT NULL,
  receive_mode TEXT NOT NULL
    CHECK (receive_mode IN ('structured', 'inner_only', 'loose')),
  master_carton_qty INTEGER NOT NULL DEFAULT 0 CHECK (master_carton_qty >= 0),
  inner_per_master INTEGER CHECK (inner_per_master IS NULL OR inner_per_master >= 0),
  inner_pack_count INTEGER NOT NULL DEFAULT 0 CHECK (inner_pack_count >= 0),
  ea_per_inner INTEGER NOT NULL DEFAULT 1 CHECK (ea_per_inner >= 1),
  total_ea INTEGER NOT NULL DEFAULT 0 CHECK (total_ea >= 0),
  ratio_matches_master BOOLEAN,
  nominal_outer_qty INTEGER,
  nominal_inner_qty INTEGER,
  master_labels_count INTEGER NOT NULL DEFAULT 0 CHECK (master_labels_count >= 0),
  inner_labels_count INTEGER NOT NULL DEFAULT 0 CHECK (inner_labels_count >= 0),
  each_labels_count INTEGER NOT NULL DEFAULT 0 CHECK (each_labels_count >= 0),
  mrp_per_ea NUMERIC,
  invoice_rate_per_ea NUMERIC,
  dock_damage_note TEXT,
  loose_target_bin_id TEXT,
  ratio_verified_at TIMESTAMPTZ,
  ratio_verified_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  ratio_verified_by_name TEXT,
  labels_printed_at TIMESTAMPTZ,
  sell_unit_snapshot TEXT NOT NULL DEFAULT 'EACH'
    CHECK (sell_unit_snapshot IN ('EACH', 'PACK', 'BOTH')),
  UNIQUE (receiving_job_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_receiving_job_lines_job ON public.receiving_job_lines(receiving_job_id);
CREATE INDEX IF NOT EXISTS idx_receiving_job_lines_busy ON public.receiving_job_lines(busy_code);

COMMENT ON COLUMN public.receiving_job_lines.each_labels_count IS 'Always 0 at job creation; each labels only on inner break event.';
COMMENT ON COLUMN public.receiving_job_lines.inner_pack_count IS 'Total inner packs in shipment; inner label count after ratio confirm.';

-- RLS: match anon-friendly admin pattern used elsewhere
ALTER TABLE public.receiving_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receiving_job_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receiving_jobs_authenticated_all ON public.receiving_jobs;
CREATE POLICY receiving_jobs_authenticated_all
  ON public.receiving_jobs FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS receiving_jobs_anon_all ON public.receiving_jobs;
CREATE POLICY receiving_jobs_anon_all
  ON public.receiving_jobs FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS receiving_job_lines_authenticated_all ON public.receiving_job_lines;
CREATE POLICY receiving_job_lines_authenticated_all
  ON public.receiving_job_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS receiving_job_lines_anon_all ON public.receiving_job_lines;
CREATE POLICY receiving_job_lines_anon_all
  ON public.receiving_job_lines FOR ALL TO anon USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.receiving_jobs TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receiving_job_lines TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.receiving_jobs_id_seq TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.receiving_job_lines_id_seq TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.format_receiving_job_public_id(p_id BIGINT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT 'PJ-' || lpad(p_id::text, 8, '0');
$$;

CREATE OR REPLACE FUNCTION public.format_receiving_envelope_code(p_id BIGINT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT 'ENV-PJ-' || lpad(p_id::text, 8, '0');
$$;

CREATE OR REPLACE FUNCTION public.create_receiving_job_manual_arrival(
  p_source_ref TEXT DEFAULT 'WALK-IN',
  p_user_id BIGINT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT;
  v_job_public_id TEXT;
  v_envelope TEXT;
BEGIN
  INSERT INTO public.receiving_jobs (
    job_public_id,
    envelope_code,
    triggered_by,
    source_ref,
    qty_basis,
    receive_status,
    created_by_user_id,
    created_by_name
  ) VALUES (
    NULL,
    NULL,
    'MANUAL_ARRIVAL',
    COALESCE(NULLIF(trim(coalesce(p_source_ref, '')), ''), 'WALK-IN'),
    'CONFIRMED',
    'MATCHED',
    p_user_id,
    p_user_name
  )
  RETURNING id INTO v_id;

  v_job_public_id := public.format_receiving_job_public_id(v_id);
  v_envelope := public.format_receiving_envelope_code(v_id);

  UPDATE public.receiving_jobs
  SET job_public_id = v_job_public_id,
      envelope_code = v_envelope
  WHERE id = v_id;

  RETURN jsonb_build_object(
    'success', true,
    'receiving_job_id', v_id,
    'job_public_id', v_job_public_id,
    'envelope_code', v_envelope
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_receiving_job_manual_arrival(TEXT, BIGINT, TEXT) TO anon, authenticated;

COMMENT ON TABLE public.receiving_jobs IS 'Inbound receiving job header; Label Studio + future Purchase triggers.';
COMMENT ON TABLE public.receiving_job_lines IS 'Per-SKU line with confirmed pack ratio and label counts.';
