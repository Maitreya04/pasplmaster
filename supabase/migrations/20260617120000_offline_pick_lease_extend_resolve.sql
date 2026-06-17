-- Extend offline pick lease while picker has brief connectivity.
-- Resolve conflict/failed packets from billing review.

CREATE OR REPLACE FUNCTION public.extend_offline_pick_lease(
  p_client_pick_key TEXT,
  p_user_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission public.offline_pick_submissions%ROWTYPE;
  v_claim public.work_claims%ROWTYPE;
  v_lease_expires_at TIMESTAMPTZ := now() + INTERVAL '2 hours';
BEGIN
  IF p_client_pick_key IS NULL OR TRIM(p_client_pick_key) = '' OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_params');
  END IF;

  SELECT *
  INTO v_submission
  FROM public.offline_pick_submissions
  WHERE client_pick_key = p_client_pick_key
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'submission_not_found');
  END IF;

  IF v_submission.picker_user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'wrong_picker');
  END IF;

  SELECT *
  INTO v_claim
  FROM public.work_claims
  WHERE id = v_submission.claim_id
    AND status = 'active'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'claim_not_active');
  END IF;

  IF v_claim.offline_client_pick_key IS DISTINCT FROM p_client_pick_key THEN
    RETURN jsonb_build_object('success', false, 'reason', 'offline_key_mismatch');
  END IF;

  UPDATE public.work_claims
  SET offline_lease_expires_at = v_lease_expires_at,
      last_heartbeat_at = now()
  WHERE id = v_claim.id;

  UPDATE public.offline_pick_submissions
  SET offline_lease_expires_at = v_lease_expires_at,
      updated_at = now()
  WHERE client_pick_key = p_client_pick_key;

  RETURN jsonb_build_object(
    'success', true,
    'offline_lease_expires_at', v_lease_expires_at
  );
END;
$$;

ALTER TABLE public.offline_pick_submissions
  DROP CONSTRAINT IF EXISTS offline_pick_submissions_status_check;

ALTER TABLE public.offline_pick_submissions
  ADD CONSTRAINT offline_pick_submissions_status_check
  CHECK (status IN ('queued', 'processing', 'applied', 'conflict', 'failed', 'discarded'));

CREATE OR REPLACE FUNCTION public.resolve_offline_pick_conflict(
  p_submission_id BIGINT,
  p_action TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission public.offline_pick_submissions%ROWTYPE;
  v_action TEXT := lower(trim(coalesce(p_action, '')));
BEGIN
  IF p_submission_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_submission_id');
  END IF;

  IF v_action NOT IN ('discard', 'release_claim') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_action');
  END IF;

  SELECT *
  INTO v_submission
  FROM public.offline_pick_submissions
  WHERE id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'submission_not_found');
  END IF;

  IF v_submission.status NOT IN ('conflict', 'failed') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_actionable');
  END IF;

  IF v_action = 'release_claim' AND v_submission.claim_id IS NOT NULL THEN
    UPDATE public.work_claims
    SET status = 'expired',
        released_at = now(),
        offline_lease_expires_at = NULL,
        offline_client_pick_key = NULL
    WHERE id = v_submission.claim_id
      AND status = 'active';

    IF v_submission.order_id IS NOT NULL THEN
      UPDATE public.orders
      SET workflow_status = 'approved',
          picker_name = NULL
      WHERE id = v_submission.order_id
        AND workflow_status = 'picking';

      INSERT INTO public.order_events (order_id, event_type, stage, payload)
      VALUES (
        v_submission.order_id,
        'offline_pick_conflict_released',
        'picking',
        jsonb_build_object(
          'submission_id', v_submission.id,
          'client_pick_key', v_submission.client_pick_key,
          'action', v_action
        )
      );
    END IF;
  END IF;

  UPDATE public.offline_pick_submissions
  SET status = 'discarded',
      error = coalesce(error, v_action),
      updated_at = now()
  WHERE id = v_submission.id;

  RETURN jsonb_build_object(
    'success', true,
    'submission_id', v_submission.id,
    'action', v_action
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.extend_offline_pick_lease(TEXT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_offline_pick_conflict(BIGINT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.extend_offline_pick_lease(TEXT, BIGINT) IS
  'Extends the offline picking lease by 2 hours when the picker briefly reconnects.';

COMMENT ON FUNCTION public.resolve_offline_pick_conflict(BIGINT, TEXT) IS
  'Billing action on conflict/failed offline pick packets: discard or release claim and return order to pool.';
