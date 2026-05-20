-- PASPL — Extend license_plates for receiving labels (inner/master instances) + allow pack_qty >= 1 for small inners.

ALTER TABLE public.license_plates
  DROP CONSTRAINT IF EXISTS license_plates_pack_qty_check;

ALTER TABLE public.license_plates
  ADD CONSTRAINT license_plates_pack_qty_check
  CHECK (pack_qty >= 1);

ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS receiving_job_line_id BIGINT REFERENCES public.receiving_job_lines(id) ON DELETE SET NULL;

ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS receiving_lot TEXT;

ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS receiving_pack_seq INTEGER CHECK (receiving_pack_seq IS NULL OR receiving_pack_seq >= 1);

ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS receiving_lp_state TEXT
    CHECK (
      receiving_lp_state IS NULL OR receiving_lp_state IN (
        'printed',
        'received_dock',
        'overflow',
        'broken',
        'sold_whole',
        'voided',
        'voided_unissued'
      )
    );

ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;

ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS reprint_supersedes_lp_id BIGINT REFERENCES public.license_plates(id) ON DELETE SET NULL;

ALTER TABLE public.license_plates
  ADD COLUMN IF NOT EXISTS overflow_location_bin_id TEXT;

CREATE INDEX IF NOT EXISTS idx_license_plates_receiving_line
  ON public.license_plates(receiving_job_line_id)
  WHERE receiving_job_line_id IS NOT NULL;

COMMENT ON COLUMN public.license_plates.receiving_lp_state IS 'Receiving workflow state; NULL means legacy LPN not tied to a receiving job line.';
COMMENT ON COLUMN public.license_plates.invalidated_at IS 'Superseded serial before reprint; original must be physically destroyed.';

CREATE OR REPLACE FUNCTION public.receiving_invalidate_license_plate_before_reprint(p_lp_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.license_plates
  SET invalidated_at = now()
  WHERE id = p_lp_id
    AND invalidated_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_invalidated_or_missing');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.receiving_invalidate_license_plate_before_reprint(BIGINT) TO anon, authenticated;
