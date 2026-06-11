-- Offline Picking V1.
--
-- Supports the v1 policy: picker starts an order online, the device records the
-- pick locally, then submits one idempotent packet when network returns.

ALTER TABLE public.work_claims
  ADD COLUMN IF NOT EXISTS offline_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS offline_client_pick_key TEXT;

CREATE INDEX IF NOT EXISTS idx_work_claims_offline_lease
  ON public.work_claims(offline_lease_expires_at)
  WHERE status = 'active' AND offline_lease_expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.offline_pick_submissions (
  id BIGSERIAL PRIMARY KEY,
  client_pick_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  order_id BIGINT REFERENCES public.orders(id) ON DELETE SET NULL,
  claim_id BIGINT REFERENCES public.work_claims(id) ON DELETE SET NULL,
  picker_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  picker_name TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'applied', 'conflict', 'failed')),
  result JSONB,
  error TEXT,
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  offline_lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_offline_pick_submissions_order
  ON public.offline_pick_submissions(order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_offline_pick_submissions_picker
  ON public.offline_pick_submissions(picker_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_offline_pick_submissions_status
  ON public.offline_pick_submissions(status, updated_at DESC);

ALTER TABLE public.offline_pick_submissions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.offline_pick_submissions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.offline_pick_submissions_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_offline_pick(
  p_order_id BIGINT,
  p_claim_id BIGINT,
  p_user_id BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_claim public.work_claims%ROWTYPE;
  v_user_name TEXT;
  v_client_pick_key TEXT;
  v_lease_expires_at TIMESTAMPTZ := now() + INTERVAL '2 hours';
BEGIN
  IF p_order_id IS NULL OR p_claim_id IS NULL OR p_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'missing_params');
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'order_not_found');
  END IF;

  IF v_order.workflow_status IS DISTINCT FROM 'picking' THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'not_picking',
      'status', v_order.workflow_status
    );
  END IF;

  SELECT *
  INTO v_claim
  FROM public.work_claims
  WHERE id = p_claim_id
    AND order_id = p_order_id
    AND stage = 'picking'
    AND claimed_by_user_id = p_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'claim_lost');
  END IF;

  SELECT full_name
  INTO v_user_name
  FROM public.users
  WHERE id = p_user_id
    AND role = 'picking'
    AND is_active = true;

  IF v_user_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'picker_not_found');
  END IF;

  v_client_pick_key := COALESCE(
    NULLIF(v_claim.offline_client_pick_key, ''),
    'pick-' || gen_random_uuid()::TEXT
  );

  UPDATE public.work_claims
  SET
    offline_client_pick_key = v_client_pick_key,
    offline_lease_expires_at = v_lease_expires_at,
    last_heartbeat_at = now()
  WHERE id = p_claim_id;

  INSERT INTO public.offline_pick_submissions (
    client_pick_key,
    payload_hash,
    payload,
    order_id,
    claim_id,
    picker_user_id,
    picker_name,
    status,
    offline_lease_expires_at
  )
  VALUES (
    v_client_pick_key,
    'prepared',
    jsonb_build_object(
      'client_pick_key', v_client_pick_key,
      'order_id', p_order_id,
      'claim_id', p_claim_id,
      'picker_user_id', p_user_id
    ),
    p_order_id,
    p_claim_id,
    p_user_id,
    v_user_name,
    'queued',
    v_lease_expires_at
  )
  ON CONFLICT (client_pick_key) DO UPDATE
  SET
    order_id = EXCLUDED.order_id,
    claim_id = EXCLUDED.claim_id,
    picker_user_id = EXCLUDED.picker_user_id,
    picker_name = EXCLUDED.picker_name,
    offline_lease_expires_at = EXCLUDED.offline_lease_expires_at,
    updated_at = now()
  WHERE public.offline_pick_submissions.status IN ('queued', 'processing', 'failed');

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
  VALUES (
    p_order_id,
    'offline_pick_prepared',
    p_user_id,
    'picking',
    jsonb_build_object(
      'claim_id', p_claim_id,
      'client_pick_key', v_client_pick_key,
      'offline_lease_expires_at', v_lease_expires_at
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'client_pick_key', v_client_pick_key,
    'offline_lease_expires_at', v_lease_expires_at,
    'claim_id', p_claim_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_offline_pick(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_pick_key TEXT;
  v_payload_hash TEXT;
  v_existing public.offline_pick_submissions%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_claim public.work_claims%ROWTYPE;
  v_user_name TEXT;
  v_order_id BIGINT;
  v_claim_id BIGINT;
  v_user_id BIGINT;
  v_box_count INTEGER;
  v_has_flags BOOLEAN;
  v_completed_at TIMESTAMPTZ;
  v_line JSONB;
  v_line_id BIGINT;
  v_line_state TEXT;
  v_scan_result JSONB;
  v_flag_reason TEXT;
  v_flag_notes TEXT;
  v_flag_box_price NUMERIC;
  v_confirmed_mrp NUMERIC;
  v_picked_qty INTEGER;
  v_stock_bin_id TEXT;
  v_stock_result JSONB;
  v_stock_results JSONB := '[]'::JSONB;
  v_segment JSONB;
  v_segment_index INTEGER;
  v_segment_result JSONB;
  v_segment_order_item_id BIGINT;
  v_result JSONB;
  v_complete_result JSONB;
  v_target public.order_items%ROWTYPE;
  v_pending_exists BIGINT;
BEGIN
  IF p_payload IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'failed', 'error', 'missing_payload');
  END IF;

  v_client_pick_key := NULLIF(TRIM(p_payload->>'client_pick_key'), '');
  IF v_client_pick_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'status', 'failed', 'error', 'missing_client_pick_key');
  END IF;

  v_payload_hash := md5(p_payload::TEXT);

  INSERT INTO public.offline_pick_submissions (
    client_pick_key,
    payload_hash,
    payload,
    order_id,
    claim_id,
    picker_user_id,
    status,
    completed_at
  )
  VALUES (
    v_client_pick_key,
    v_payload_hash,
    p_payload,
    NULLIF(p_payload->>'order_id', '')::BIGINT,
    NULLIF(p_payload->>'claim_id', '')::BIGINT,
    NULLIF(p_payload->>'picker_user_id', '')::BIGINT,
    'processing',
    NULLIF(p_payload->>'completed_at', '')::TIMESTAMPTZ
  )
  ON CONFLICT (client_pick_key) DO NOTHING;

  SELECT *
  INTO v_existing
  FROM public.offline_pick_submissions
  WHERE client_pick_key = v_client_pick_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'status', 'failed', 'error', 'ledger_missing');
  END IF;

  IF v_existing.payload_hash NOT IN ('prepared', v_payload_hash) THEN
    v_result := jsonb_build_object(
      'success', false,
      'status', 'conflict',
      'reason', 'client_key_conflict',
      'detail', 'This offline pick key was already used for a different payload.'
    );
    UPDATE public.offline_pick_submissions
    SET status = 'conflict',
        result = v_result,
        error = 'client_key_conflict',
        updated_at = now()
    WHERE id = v_existing.id;
    RETURN v_result;
  END IF;

  IF v_existing.status = 'applied' AND v_existing.result IS NOT NULL THEN
    RETURN v_existing.result || jsonb_build_object('status', 'already_applied');
  END IF;

  UPDATE public.offline_pick_submissions
  SET payload_hash = v_payload_hash,
      payload = p_payload,
      status = 'processing',
      updated_at = now(),
      completed_at = NULLIF(p_payload->>'completed_at', '')::TIMESTAMPTZ
  WHERE id = v_existing.id;

  v_order_id := NULLIF(p_payload->>'order_id', '')::BIGINT;
  v_claim_id := NULLIF(p_payload->>'claim_id', '')::BIGINT;
  v_user_id := NULLIF(p_payload->>'picker_user_id', '')::BIGINT;
  v_box_count := NULLIF(p_payload->>'box_count', '')::INTEGER;
  v_has_flags := COALESCE((p_payload->>'has_flags')::BOOLEAN, false);
  v_completed_at := NULLIF(p_payload->>'completed_at', '')::TIMESTAMPTZ;

  IF v_order_id IS NULL OR v_claim_id IS NULL OR v_user_id IS NULL THEN
    v_result := jsonb_build_object('success', false, 'status', 'failed', 'error', 'missing_ids');
    UPDATE public.offline_pick_submissions
    SET status = 'failed', result = v_result, error = 'missing_ids', updated_at = now()
    WHERE id = v_existing.id;
    RETURN v_result;
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = v_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    v_result := jsonb_build_object('success', false, 'status', 'conflict', 'reason', 'order_not_found');
    UPDATE public.offline_pick_submissions
    SET status = 'conflict', result = v_result, error = 'order_not_found', updated_at = now()
    WHERE id = v_existing.id;
    RETURN v_result;
  END IF;

  IF v_order.workflow_status IN ('completed', 'flagged') THEN
    v_result := jsonb_build_object(
      'success', false,
      'status', 'conflict',
      'reason', 'already_finalised',
      'workflow_status', v_order.workflow_status
    );
    UPDATE public.offline_pick_submissions
    SET status = 'conflict', result = v_result, error = 'already_finalised', updated_at = now()
    WHERE id = v_existing.id;
    RETURN v_result;
  END IF;

  IF v_order.workflow_status IS DISTINCT FROM 'picking' THEN
    v_result := jsonb_build_object(
      'success', false,
      'status', 'conflict',
      'reason', 'not_picking',
      'workflow_status', v_order.workflow_status
    );
    UPDATE public.offline_pick_submissions
    SET status = 'conflict', result = v_result, error = 'not_picking', updated_at = now()
    WHERE id = v_existing.id;
    RETURN v_result;
  END IF;

  SELECT *
  INTO v_claim
  FROM public.work_claims
  WHERE id = v_claim_id
    AND order_id = v_order_id
    AND stage = 'picking'
    AND claimed_by_user_id = v_user_id
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    v_result := jsonb_build_object('success', false, 'status', 'conflict', 'reason', 'claim_lost');
    UPDATE public.offline_pick_submissions
    SET status = 'conflict', result = v_result, error = 'claim_lost', updated_at = now()
    WHERE id = v_existing.id;
    RETURN v_result;
  END IF;

  IF v_claim.offline_client_pick_key IS DISTINCT FROM v_client_pick_key THEN
    v_result := jsonb_build_object('success', false, 'status', 'conflict', 'reason', 'offline_key_mismatch');
    UPDATE public.offline_pick_submissions
    SET status = 'conflict', result = v_result, error = 'offline_key_mismatch', updated_at = now()
    WHERE id = v_existing.id;
    RETURN v_result;
  END IF;

  IF v_claim.offline_lease_expires_at IS NOT NULL AND v_claim.offline_lease_expires_at < now() THEN
    v_result := jsonb_build_object('success', false, 'status', 'conflict', 'reason', 'offline_lease_expired');
    UPDATE public.offline_pick_submissions
    SET status = 'conflict', result = v_result, error = 'offline_lease_expired', updated_at = now()
    WHERE id = v_existing.id;
    RETURN v_result;
  END IF;

  SELECT full_name INTO v_user_name FROM public.users WHERE id = v_user_id;

  FOR v_line IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'lines', '[]'::JSONB))
  LOOP
    v_line_id := NULLIF(v_line->>'order_item_id', '')::BIGINT;
    v_line_state := COALESCE(NULLIF(v_line->>'state', ''), 'pending');
    v_scan_result := COALESCE(v_line->'scan_result', 'null'::JSONB);
    v_flag_reason := NULLIF(v_line->>'flag_reason', '');
    v_flag_notes := NULLIF(v_line->>'flag_notes', '');
    v_flag_box_price := NULLIF(v_line->>'flag_box_price', '')::NUMERIC;
    v_confirmed_mrp := NULLIF(v_line->>'confirmed_mrp', '')::NUMERIC;
    v_picked_qty := GREATEST(0, COALESCE(NULLIF(v_line->>'picked_qty', '')::INTEGER, 0));
    v_stock_bin_id := NULLIF(v_line->>'stock_bin_id', '');
    v_pending_exists := NULL;

    IF v_line_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT *
    INTO v_target
    FROM public.order_items
    WHERE id = v_line_id
      AND order_id = v_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      v_result := jsonb_build_object(
        'success', false,
        'status', 'conflict',
        'reason', 'line_not_found',
        'order_item_id', v_line_id
      );
      UPDATE public.offline_pick_submissions
      SET status = 'conflict', result = v_result, error = 'line_not_found', updated_at = now()
      WHERE id = v_existing.id;
      RETURN v_result;
    END IF;

    IF jsonb_array_length(COALESCE(v_line->'segments', '[]'::JSONB)) > 0 THEN
      v_segment_index := 0;
      FOR v_segment IN
        SELECT value FROM jsonb_array_elements(COALESCE(v_line->'segments', '[]'::JSONB))
      LOOP
        v_segment_index := v_segment_index + 1;
        v_segment_result := public.split_order_item_at_pick(
          v_order_id,
          v_claim_id,
          v_user_id,
          v_line_id,
          GREATEST(1, COALESCE(NULLIF(v_segment->>'qty', '')::INTEGER, 1)),
          COALESCE(NULLIF(v_segment->>'mrp', '')::NUMERIC, v_confirmed_mrp, 0),
          COALESCE(v_segment->'scan_result', v_scan_result, '{}'::JSONB),
          v_segment_index = 1
        );

        IF COALESCE((v_segment_result->>'success')::BOOLEAN, false) IS NOT TRUE THEN
          v_result := jsonb_build_object(
            'success', false,
            'status', 'conflict',
            'reason', COALESCE(v_segment_result->>'error', 'mrp_split_failed'),
            'order_item_id', v_line_id
          );
          UPDATE public.offline_pick_submissions
          SET status = 'conflict', result = v_result, error = COALESCE(v_segment_result->>'error', 'mrp_split_failed'), updated_at = now()
          WHERE id = v_existing.id;
          RETURN v_result;
        END IF;

        v_segment_order_item_id := NULLIF(v_segment_result->>'order_item_id', '')::BIGINT;
        IF v_segment_order_item_id IS NOT NULL THEN
          v_stock_result := public.wms_consume_bin_layer_for_pick(
            v_segment_order_item_id,
            GREATEST(1, COALESCE(NULLIF(v_segment->>'qty', '')::INTEGER, 1)),
            v_user_id,
            NULL,
            'offline pick sync',
            v_stock_bin_id,
            NULL
          );
          v_stock_results := v_stock_results || jsonb_build_array(
            jsonb_build_object(
              'order_item_id', v_segment_order_item_id,
              'qty', GREATEST(1, COALESCE(NULLIF(v_segment->>'qty', '')::INTEGER, 1)),
              'result', v_stock_result
            )
          );
        END IF;
      END LOOP;
      CONTINUE;
    END IF;

    IF v_line_state = 'flagged' THEN
      UPDATE public.order_items
      SET state = 'flagged',
          flag_reason = v_flag_reason,
          flag_notes = v_flag_notes,
          flag_box_price = v_flag_box_price,
          scan_result = v_scan_result,
          confirmed_mrp = COALESCE(v_confirmed_mrp, confirmed_mrp)
      WHERE id = v_line_id;

      IF v_flag_reason = 'Out of Stock' THEN
        SELECT id
        INTO v_pending_exists
        FROM public.pending_items
        WHERE order_id = v_order_id
          AND item_id = v_target.item_id
          AND status = 'pending'
          AND source = 'picking'
        LIMIT 1;

        IF v_pending_exists IS NULL THEN
          INSERT INTO public.pending_items (
            order_id,
            order_number,
            customer_id,
            customer_name,
            item_id,
            item_name,
            qty_pending,
            source,
            created_by,
            note
          )
          VALUES (
            v_order_id,
            v_order.order_number,
            v_order.customer_id,
            v_order.customer_name,
            v_target.item_id,
            v_target.item_name,
            GREATEST(1, COALESCE(v_target.qty_approved, v_target.qty_shippable, v_target.qty_requested, 1)),
            'picking',
            COALESCE(v_user_name, 'Picker'),
            v_flag_notes
          );
        END IF;
      END IF;
    ELSIF v_line_state = 'picked' THEN
      UPDATE public.order_items
      SET state = 'picked',
          scan_result = v_scan_result,
          confirmed_mrp = COALESCE(v_confirmed_mrp, confirmed_mrp)
      WHERE id = v_line_id;

      IF v_picked_qty > 0 THEN
        v_stock_result := public.wms_consume_bin_layer_for_pick(
          v_line_id,
          v_picked_qty,
          v_user_id,
          NULL,
          'offline pick sync',
          v_stock_bin_id,
          NULL
        );
        v_stock_results := v_stock_results || jsonb_build_array(
          jsonb_build_object(
            'order_item_id', v_line_id,
            'qty', v_picked_qty,
            'result', v_stock_result
          )
        );
      END IF;
    ELSE
      UPDATE public.order_items
      SET scan_result = v_scan_result,
          confirmed_mrp = COALESCE(v_confirmed_mrp, confirmed_mrp)
      WHERE id = v_line_id;
    END IF;
  END LOOP;

  v_complete_result := public.complete_picking(
    v_order_id,
    v_claim_id,
    v_user_id,
    v_has_flags,
    v_box_count
  );

  IF COALESCE((v_complete_result->>'success')::BOOLEAN, false) IS NOT TRUE THEN
    v_result := jsonb_build_object(
      'success', false,
      'status', 'conflict',
      'reason', COALESCE(v_complete_result->>'reason', 'complete_failed'),
      'complete_result', v_complete_result
    );
    UPDATE public.offline_pick_submissions
    SET status = 'conflict', result = v_result, error = COALESCE(v_complete_result->>'reason', 'complete_failed'), updated_at = now()
    WHERE id = v_existing.id;
    RETURN v_result;
  END IF;

  IF v_completed_at IS NOT NULL THEN
    UPDATE public.orders
    SET picking_completed_at = COALESCE(picking_completed_at, v_completed_at)
    WHERE id = v_order_id;
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'status', 'applied',
    'order_id', v_order_id,
    'stock_results', v_stock_results
  );

  UPDATE public.offline_pick_submissions
  SET status = 'applied',
      result = v_result,
      error = NULL,
      updated_at = now(),
      applied_at = now(),
      picker_name = COALESCE(v_user_name, picker_name)
  WHERE id = v_existing.id;

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
  VALUES (
    v_order_id,
    'offline_pick_applied',
    v_user_id,
    'picking',
    jsonb_build_object(
      'client_pick_key', v_client_pick_key,
      'box_count', v_box_count,
      'has_flags', v_has_flags
    )
  );

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    v_result := jsonb_build_object(
      'success', false,
      'status', 'failed',
      'error', SQLERRM
    );
    UPDATE public.offline_pick_submissions
    SET status = 'failed',
        result = v_result,
        error = SQLERRM,
        updated_at = now()
    WHERE client_pick_key = v_client_pick_key;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_offline_pick_conflicts()
RETURNS TABLE (
  id BIGINT,
  client_pick_key TEXT,
  order_id BIGINT,
  order_number TEXT,
  customer_name TEXT,
  picker_user_id BIGINT,
  picker_name TEXT,
  status TEXT,
  result JSONB,
  payload JSONB,
  error TEXT,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ops.id,
    ops.client_pick_key,
    ops.order_id,
    o.order_number,
    o.customer_name,
    ops.picker_user_id,
    ops.picker_name,
    ops.status,
    ops.result,
    ops.payload,
    ops.error,
    ops.completed_at,
    ops.updated_at
  FROM public.offline_pick_submissions ops
  LEFT JOIN public.orders o ON o.id = ops.order_id
  WHERE ops.status IN ('conflict', 'failed')
  ORDER BY ops.updated_at DESC, ops.id DESC;
$$;

CREATE OR REPLACE FUNCTION public.expire_stale_claims()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_count INTEGER := 0;
  v_claim RECORD;
  v_stale_threshold INTERVAL := INTERVAL '3 minutes';
BEGIN
  FOR v_claim IN
    SELECT wc.id, wc.order_id, wc.stage, wc.claimed_by_user_id, u.full_name
    FROM public.work_claims wc
    JOIN public.users u ON u.id = wc.claimed_by_user_id
    WHERE wc.status = 'active'
      AND (now() - wc.last_heartbeat_at) > v_stale_threshold
      AND (
        wc.stage IS DISTINCT FROM 'picking'
        OR wc.offline_lease_expires_at IS NULL
        OR wc.offline_lease_expires_at <= now()
      )
  LOOP
    UPDATE public.work_claims
    SET status = 'expired',
        released_at = now()
    WHERE id = v_claim.id;

    INSERT INTO public.order_events (order_id, event_type, stage, payload)
    VALUES (v_claim.order_id, 'claim_expired', v_claim.stage,
            jsonb_build_object(
              'expired_claim_id', v_claim.id,
              'expired_user', v_claim.full_name,
              'reason', 'heartbeat_timeout'
            ));

    IF v_claim.stage = 'picking' THEN
      UPDATE public.orders
      SET workflow_status = 'approved',
          picker_name = NULL
      WHERE id = v_claim.order_id
        AND workflow_status = 'picking';
    END IF;

    v_expired_count := v_expired_count + 1;
  END LOOP;

  RETURN jsonb_build_object('expired_count', v_expired_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.prepare_offline_pick(BIGINT, BIGINT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_offline_pick(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_offline_pick_conflicts() TO authenticated;

COMMENT ON TABLE public.offline_pick_submissions IS
  'Idempotent offline picker completion packets. Conflicts are preserved for supervisor/billing review.';

COMMENT ON FUNCTION public.prepare_offline_pick(BIGINT, BIGINT, BIGINT) IS
  'Grants a 2-hour offline lease for an active started pick and returns a client_pick_key.';

COMMENT ON FUNCTION public.submit_offline_pick(JSONB) IS
  'Applies a locally completed pick packet atomically, or stores it as conflict/failed for review.';
