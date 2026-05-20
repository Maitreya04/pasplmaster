-- PASPL — Dock arrival confirmation for receiving workflow stepper.

ALTER TABLE public.receiving_jobs
  ADD COLUMN IF NOT EXISTS dock_arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dock_note TEXT;

COMMENT ON COLUMN public.receiving_jobs.dock_arrived_at IS 'Set when warehouse confirms truck at dock; gates Count+labels step.';
COMMENT ON COLUMN public.receiving_jobs.dock_note IS 'Optional dock note (damage, vehicle ref, etc.).';

CREATE OR REPLACE FUNCTION public.receiving_confirm_dock_arrival(
  p_job_id BIGINT,
  p_user_id BIGINT DEFAULT NULL,
  p_user_name TEXT DEFAULT NULL,
  p_asn_ref TEXT DEFAULT NULL,
  p_dock_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.receiving_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public.receiving_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'job_not_found');
  END IF;

  UPDATE public.receiving_jobs
  SET
    dock_arrived_at = coalesce(dock_arrived_at, now()),
    asn_ref = CASE
      WHEN p_asn_ref IS NOT NULL AND trim(p_asn_ref) <> '' THEN trim(p_asn_ref)
      ELSE asn_ref
    END,
    dock_note = CASE
      WHEN p_dock_note IS NOT NULL AND trim(p_dock_note) <> '' THEN trim(p_dock_note)
      ELSE dock_note
    END
  WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'success', true,
    'dock_arrived_at', (SELECT dock_arrived_at FROM public.receiving_jobs WHERE id = p_job_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.receiving_confirm_dock_arrival(BIGINT, BIGINT, TEXT, TEXT, TEXT) TO anon, authenticated;
