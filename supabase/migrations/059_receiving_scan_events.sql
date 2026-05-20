-- PASPL — Receiving scan event ledger (dock / overflow / break / BIN stock / pick).

CREATE TABLE IF NOT EXISTS public.receiving_scan_events (
  id BIGSERIAL PRIMARY KEY,
  receiving_job_id BIGINT NOT NULL REFERENCES public.receiving_jobs(id) ON DELETE CASCADE,
  receiving_job_line_id BIGINT REFERENCES public.receiving_job_lines(id) ON DELETE CASCADE,
  license_plate_id BIGINT REFERENCES public.license_plates(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'master_carton_in',
    'inner_to_overflow',
    'inner_break',
    'bin_stock',
    'bin_pick'
  )),
  overflow_location_bin_id TEXT,
  qty_delta INTEGER,
  bin_id TEXT,
  payload_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_receiving_scan_events_job ON public.receiving_scan_events(receiving_job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receiving_scan_events_lp ON public.receiving_scan_events(license_plate_id);

ALTER TABLE public.receiving_scan_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receiving_scan_events_authenticated_all ON public.receiving_scan_events;
CREATE POLICY receiving_scan_events_authenticated_all
  ON public.receiving_scan_events FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS receiving_scan_events_anon_all ON public.receiving_scan_events;
CREATE POLICY receiving_scan_events_anon_all
  ON public.receiving_scan_events FOR ALL TO anon USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.receiving_scan_events TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.receiving_scan_events_id_seq TO anon, authenticated;

DROP FUNCTION IF EXISTS public.receiving_apply_inner_overflow(BIGINT, TEXT, BIGINT, TEXT, BIGINT, BIGINT);

CREATE OR REPLACE FUNCTION public.receiving_apply_inner_overflow(
  p_lp_id BIGINT,
  p_overflow_bin_id TEXT,
  p_job_id BIGINT,
  p_job_line_id BIGINT,
  p_user_id BIGINT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm TEXT := upper(trim(coalesce(p_overflow_bin_id, '')));
BEGIN
  IF p_job_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'job_id_required');
  END IF;

  IF v_norm !~ '^OVF-' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'overflow_must_match_OVF_prefix');
  END IF;

  PERFORM 1 FROM public.receiving_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'job_not_found');
  END IF;

  UPDATE public.license_plates
  SET receiving_lp_state = 'overflow',
      overflow_location_bin_id = v_norm
  WHERE id = p_lp_id
    AND invalidated_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'license_plate_not_found_or_invalidated');
  END IF;

  INSERT INTO public.receiving_scan_events (
    receiving_job_id,
    receiving_job_line_id,
    license_plate_id,
    event_type,
    overflow_location_bin_id,
    created_by_user_id,
    created_by_name
  ) VALUES (
    p_job_id,
    p_job_line_id,
    p_lp_id,
    'inner_to_overflow',
    v_norm,
    p_user_id,
    p_user_name
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.receiving_apply_inner_overflow(BIGINT, TEXT, BIGINT, BIGINT, BIGINT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.receiving_apply_inner_break(
  p_lp_id BIGINT,
  p_job_id BIGINT,
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
BEGIN
  IF p_job_id IS NULL OR p_job_line_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'job_and_line_required');
  END IF;

  SELECT * INTO v_line FROM public.receiving_job_lines WHERE id = p_job_line_id AND receiving_job_id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'line_not_found');
  END IF;

  IF v_line.sell_unit_snapshot = 'PACK' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'sell_unit_pack_no_each_labels');
  END IF;

  UPDATE public.license_plates
  SET receiving_lp_state = 'broken',
      status = 'opened',
      opened_at = coalesce(opened_at, now()),
      remaining_qty = 0
  WHERE id = p_lp_id
    AND invalidated_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'license_plate_not_found_or_invalidated');
  END IF;

  INSERT INTO public.receiving_scan_events (
    receiving_job_id,
    receiving_job_line_id,
    license_plate_id,
    event_type,
    created_by_user_id,
    created_by_name
  ) VALUES (
    p_job_id,
    p_job_line_id,
    p_lp_id,
    'inner_break',
    p_user_id,
    p_user_name
  );

  RETURN jsonb_build_object('success', true, 'each_label_batch_ea', v_line.ea_per_inner);
END;
$$;

GRANT EXECUTE ON FUNCTION public.receiving_apply_inner_break(BIGINT, BIGINT, BIGINT, BIGINT, TEXT) TO anon, authenticated;

COMMENT ON TABLE public.receiving_scan_events IS 'Five receiving scan event types; BIN qty lives in bin_inventory.';
