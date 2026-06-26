-- 30-day picker MRP frequency ranking + auto bill rate on MRP pick commit.

CREATE INDEX IF NOT EXISTS idx_order_items_confirmed_mrp_pick_state
  ON public.order_items (item_id)
  WHERE confirmed_mrp IS NOT NULL
    AND state IN ('picked', 'flagged', 'overridden');

-- ─── MRP history with 30-day picker frequency + suggested_mrp ───
CREATE OR REPLACE FUNCTION public.get_stock_mrp_history(
  p_busy_code NUMERIC,
  p_stock_location_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm_loc TEXT;
  v_stock_history JSONB;
  v_stock_latest_mrp NUMERIC;
  v_overlay_history JSONB;
  v_overlay_latest_mrp NUMERIC;
  v_merged_history JSONB;
  v_latest_mrp NUMERIC;
  v_suggested_mrp NUMERIC;
  v_suggestion_source TEXT;
  v_recent_top_mrp NUMERIC;
BEGIN
  IF p_busy_code IS NULL OR p_busy_code <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'busy_code_required',
      'latest_mrp', NULL,
      'suggested_mrp', NULL,
      'stock_mrp', NULL,
      'suggestion_source', 'empty',
      'history', '[]'::jsonb
    );
  END IF;

  v_norm_loc := NULL;
  IF p_stock_location_code IS NOT NULL AND trim(p_stock_location_code) <> '' THEN
    v_norm_loc := public.normalize_stock_location_code(p_stock_location_code);
    IF v_norm_loc IS NULL THEN
      v_norm_loc := public.normalize_stock_location_code(
        public.stock_location_label(p_stock_location_code)
      );
    END IF;
    IF v_norm_loc IS NULL AND lower(trim(p_stock_location_code)) IN ('main_store', 'jabalpur') THEN
      v_norm_loc := lower(trim(p_stock_location_code));
    END IF;
  END IF;

  WITH base AS (
    SELECT
      sm.mrp,
      sm.stock_qty,
      sm.salesprice,
      sm.stock_location,
      sm.updated_at,
      public.normalize_stock_location_code(sm.stock_location) AS loc_code
    FROM public.stock_mrpwise sm
    WHERE sm.busy_code = p_busy_code::BIGINT
      AND sm.stock_qty > 0
  ),
  loc_filtered AS (
    SELECT * FROM base
    WHERE v_norm_loc IS NULL OR loc_code = v_norm_loc
  ),
  scoped AS (
    SELECT * FROM loc_filtered
    WHERE EXISTS (SELECT 1 FROM loc_filtered LIMIT 1)
    UNION ALL
    SELECT * FROM base
    WHERE NOT EXISTS (SELECT 1 FROM loc_filtered LIMIT 1)
  ),
  deduped AS (
    SELECT DISTINCT ON (s.mrp)
      s.mrp,
      s.stock_qty,
      s.salesprice,
      s.stock_location,
      s.updated_at,
      s.loc_code
    FROM scoped s
    ORDER BY s.mrp, s.updated_at DESC
  ),
  ranked AS (
    SELECT
      d.*,
      row_number() OVER (ORDER BY d.updated_at DESC, d.mrp DESC) AS rn
    FROM deduped d
  )
  SELECT
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'mrp', r.mrp,
            'qty', r.stock_qty,
            'salesprice', r.salesprice,
            'location', r.stock_location,
            'location_code', r.loc_code,
            'date', to_char(r.updated_at AT TIME ZONE 'Asia/Kolkata', 'Mon YYYY'),
            'updated_at', r.updated_at,
            'is_latest', false,
            'source', 'stock_mrpwise'
          )
          ORDER BY r.updated_at DESC, r.mrp DESC
        )
        FROM ranked r
      ),
      '[]'::jsonb
    ),
    (SELECT r2.mrp FROM ranked r2 WHERE r2.rn = 1 LIMIT 1)
  INTO v_stock_history, v_stock_latest_mrp;

  WITH overlay_ranked AS (
    SELECT
      plm.label_mrp,
      plm.stock_location_code,
      plm.trust_level,
      plm.confirmation_count,
      plm.last_confirmed_at,
      row_number() OVER (
        ORDER BY
          CASE plm.trust_level WHEN 'billing_verified' THEN 0 ELSE 1 END,
          plm.confirmation_count DESC,
          plm.last_confirmed_at DESC
      ) AS rn
    FROM public.picker_label_mrp plm
    WHERE plm.busy_code = p_busy_code::BIGINT
      AND (
        v_norm_loc IS NULL
        OR plm.stock_location_code = v_norm_loc
        OR plm.stock_location_code = ''
      )
  )
  SELECT
    coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'mrp', o.label_mrp,
            'qty', 0,
            'salesprice', NULL,
            'location', NULL,
            'location_code', o.stock_location_code,
            'date', to_char(o.last_confirmed_at AT TIME ZONE 'Asia/Kolkata', 'Mon YYYY'),
            'updated_at', o.last_confirmed_at,
            'is_latest', false,
            'source', CASE
              WHEN o.trust_level = 'billing_verified' THEN 'billing_verified'
              ELSE 'picker_verified'
            END,
            'confirmation_count', o.confirmation_count
          )
          ORDER BY o.rn
        )
        FROM overlay_ranked o
      ),
      '[]'::jsonb
    ),
    (SELECT o2.label_mrp FROM overlay_ranked o2 WHERE o2.rn = 1 LIMIT 1)
  INTO v_overlay_history, v_overlay_latest_mrp;

  -- Top MRP by 30-day pick frequency (ground reality)
  SELECT rp.mrp
  INTO v_recent_top_mrp
  FROM (
    SELECT
      ROUND(oi.confirmed_mrp) AS mrp,
      COUNT(*)::INT AS recent_pick_count,
      MAX(COALESCE((oi.scan_result ->> 'timestamp')::TIMESTAMPTZ, oi.created_at)) AS last_picked_at,
      MAX(
        CASE plm.trust_level WHEN 'billing_verified' THEN 0 ELSE 1 END
      ) AS trust_rank
    FROM public.order_items oi
    JOIN public.items i ON i.id = oi.item_id
    LEFT JOIN public.picker_label_mrp plm
      ON plm.busy_code = i.busy_code::BIGINT
      AND ROUND(plm.label_mrp) = ROUND(oi.confirmed_mrp)
      AND (
        v_norm_loc IS NULL
        OR plm.stock_location_code = v_norm_loc
        OR plm.stock_location_code = ''
      )
    WHERE i.busy_code = p_busy_code::BIGINT
      AND oi.confirmed_mrp IS NOT NULL
      AND oi.state IN ('picked', 'flagged', 'overridden')
      AND COALESCE((oi.scan_result ->> 'timestamp')::TIMESTAMPTZ, oi.created_at)
        >= now() - interval '30 days'
    GROUP BY ROUND(oi.confirmed_mrp)
    ORDER BY
      COUNT(*) DESC,
      MAX(CASE plm.trust_level WHEN 'billing_verified' THEN 0 ELSE 1 END),
      MAX(COALESCE((oi.scan_result ->> 'timestamp')::TIMESTAMPTZ, oi.created_at)) DESC
    LIMIT 1
  ) rp;

  IF v_recent_top_mrp IS NOT NULL THEN
    v_suggested_mrp := v_recent_top_mrp;
    v_suggestion_source := 'picker_30d';
  ELSIF v_stock_latest_mrp IS NOT NULL THEN
    v_suggested_mrp := v_stock_latest_mrp;
    v_suggestion_source := 'stock_mrpwise';
  ELSIF v_overlay_latest_mrp IS NOT NULL THEN
    v_suggested_mrp := v_overlay_latest_mrp;
    v_suggestion_source := 'picker_verified';
  ELSE
    v_suggested_mrp := NULL;
    v_suggestion_source := 'empty';
  END IF;

  WITH recent_counts AS (
    SELECT
      ROUND(oi.confirmed_mrp) AS mrp,
      COUNT(*)::INT AS recent_pick_count
    FROM public.order_items oi
    JOIN public.items i ON i.id = oi.item_id
    WHERE i.busy_code = p_busy_code::BIGINT
      AND oi.confirmed_mrp IS NOT NULL
      AND oi.state IN ('picked', 'flagged', 'overridden')
      AND COALESCE((oi.scan_result ->> 'timestamp')::TIMESTAMPTZ, oi.created_at)
        >= now() - interval '30 days'
    GROUP BY ROUND(oi.confirmed_mrp)
  ),
  overlay_elems AS (
    SELECT value AS elem, ordinality AS ord
    FROM jsonb_array_elements(coalesce(v_overlay_history, '[]'::jsonb)) WITH ORDINALITY
  ),
  overlay_enriched AS (
    SELECT
      jsonb_set(
        o.elem,
        '{recent_pick_count}',
        to_jsonb(COALESCE(rc.recent_pick_count, 0)),
        true
      ) AS elem,
      o.ord,
      COALESCE(rc.recent_pick_count, 0) AS recent_pick_count
    FROM overlay_elems o
    LEFT JOIN recent_counts rc
      ON ROUND((o.elem ->> 'mrp')::NUMERIC) = rc.mrp
  ),
  stock_elems AS (
    SELECT value AS elem
    FROM jsonb_array_elements(coalesce(v_stock_history, '[]'::jsonb))
  ),
  stock_enriched AS (
    SELECT
      jsonb_set(
        s.elem,
        '{recent_pick_count}',
        to_jsonb(COALESCE(rc.recent_pick_count, 0)),
        true
      ) AS elem,
      COALESCE(rc.recent_pick_count, 0) AS recent_pick_count,
      row_number() OVER () AS stock_ord
    FROM stock_elems s
    LEFT JOIN recent_counts rc
      ON ROUND((s.elem ->> 'mrp')::NUMERIC) = rc.mrp
    WHERE NOT EXISTS (
      SELECT 1
      FROM overlay_enriched o
      WHERE ROUND((o.elem ->> 'mrp')::NUMERIC) = ROUND((s.elem ->> 'mrp')::NUMERIC)
    )
  ),
  merged_raw AS (
    SELECT elem, ord AS sort_ord, 0 AS tier, recent_pick_count
    FROM overlay_enriched
    UNION ALL
    SELECT elem, stock_ord AS sort_ord, 1 AS tier, recent_pick_count
    FROM stock_enriched
  ),
  merged_ordered AS (
    SELECT
      elem,
      row_number() OVER (
        ORDER BY
          recent_pick_count DESC,
          tier,
          sort_ord
      ) AS final_ord
    FROM merged_raw
  )
  SELECT coalesce(
    (
      SELECT jsonb_agg(
        jsonb_set(
          m.elem,
          '{is_latest}',
          to_jsonb(m.final_ord = 1),
          true
        )
        ORDER BY m.final_ord
      )
      FROM merged_ordered m
    ),
    '[]'::jsonb
  )
  INTO v_merged_history;

  v_latest_mrp := coalesce(v_suggested_mrp, v_overlay_latest_mrp, v_stock_latest_mrp);

  IF jsonb_array_length(coalesce(v_merged_history, '[]'::jsonb)) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'no_history',
      'busy_code', p_busy_code,
      'stock_location_code', v_norm_loc,
      'latest_mrp', NULL,
      'suggested_mrp', NULL,
      'stock_mrp', v_stock_latest_mrp,
      'suggestion_source', 'empty',
      'history', '[]'::jsonb
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'busy_code', p_busy_code,
    'stock_location_code', v_norm_loc,
    'latest_mrp', v_latest_mrp,
    'suggested_mrp', v_suggested_mrp,
    'stock_mrp', v_stock_latest_mrp,
    'suggestion_source', v_suggestion_source,
    'history', v_merged_history
  );
END;
$$;

COMMENT ON FUNCTION public.get_stock_mrp_history(NUMERIC, TEXT) IS
  'Merged MRP history: 30-day picker frequency ranks first; falls back to stock_mrpwise.';

-- ─── Auto-set bill rate to confirmed label MRP on MRP-split pick ───
CREATE OR REPLACE FUNCTION public.split_order_item_at_pick(
  p_order_id BIGINT,
  p_claim_id BIGINT,
  p_user_id BIGINT,
  p_root_order_item_id BIGINT,
  p_segment_qty INTEGER,
  p_confirmed_mrp NUMERIC,
  p_scan_result JSONB,
  p_is_first_segment BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim RECORD;
  v_order RECORD;
  v_root public.order_items%ROWTYPE;
  v_user_name TEXT;
  v_new_id BIGINT;
  v_reservation RECORD;
  v_po_ratio NUMERIC;
  v_segment_po INTEGER;
  v_bill_line_no INTEGER;
  v_bill_mrp NUMERIC;
BEGIN
  IF p_segment_qty IS NULL OR p_segment_qty < 1 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_qty');
  END IF;

  IF p_confirmed_mrp IS NULL OR p_confirmed_mrp < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_mrp');
  END IF;

  v_bill_mrp := ROUND(p_confirmed_mrp);

  IF p_claim_id IS NOT NULL THEN
    SELECT id, order_id, stage, claimed_by_user_id
    INTO v_claim
    FROM public.work_claims
    WHERE id = p_claim_id
      AND order_id = p_order_id
      AND stage = 'picking'
      AND claimed_by_user_id = p_user_id
      AND status = 'active';

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'claim_lost');
    END IF;
  END IF;

  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  IF v_order.workflow_status IS DISTINCT FROM 'picking' THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_picking');
  END IF;

  SELECT full_name INTO v_user_name FROM public.users WHERE id = p_user_id;
  IF v_user_name IS NULL THEN
    v_user_name := 'Picker';
  END IF;

  SELECT *
  INTO v_root
  FROM public.order_items
  WHERE id = p_root_order_item_id
    AND order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'line_not_found');
  END IF;

  IF p_is_first_segment THEN
    IF p_segment_qty > v_root.qty_requested THEN
      RETURN jsonb_build_object('success', false, 'error', 'qty_exceeds_line');
    END IF;

    v_po_ratio := CASE
      WHEN COALESCE(v_root.qty_requested, 0) > 0
        THEN COALESCE(v_root.qty_po, 0)::NUMERIC / v_root.qty_requested::NUMERIC
      ELSE 0
    END;
    v_segment_po := FLOOR(p_segment_qty * v_po_ratio)::INT;

    UPDATE public.order_items
    SET
      qty_requested = p_segment_qty,
      qty_shippable = p_segment_qty,
      qty_approved = p_segment_qty,
      qty_po = v_segment_po,
      confirmed_mrp = p_confirmed_mrp,
      price_quoted = CASE WHEN COALESCE(is_foc, false) THEN price_quoted ELSE v_bill_mrp END,
      scan_result = p_scan_result,
      state = 'picked'
    WHERE id = p_root_order_item_id;

    SELECT *
    INTO v_reservation
    FROM public.stock_reservations
    WHERE order_item_id = p_root_order_item_id
      AND status IN ('active', 'awaiting_erp_sync')
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.stock_reservations
      SET qty_reserved = p_segment_qty
      WHERE id = v_reservation.id;
    END IF;

    INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
    VALUES (
      p_order_id,
      'pick_line_mrp_split',
      p_user_id,
      'picking',
      jsonb_build_object(
        'root_order_item_id', p_root_order_item_id,
        'order_item_id', p_root_order_item_id,
        'segment_qty', p_segment_qty,
        'confirmed_mrp', p_confirmed_mrp,
        'is_first_segment', true
      )
    );

    UPDATE public.orders o
    SET
      item_count = sub.cnt,
      total_value = sub.tval
    FROM (
      SELECT
        COUNT(*)::INT AS cnt,
        COALESCE(SUM(COALESCE(oi.price_quoted, 0) * GREATEST(COALESCE(oi.qty_shippable, 0), 0)), 0)::NUMERIC AS tval
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
    ) sub
    WHERE o.id = p_order_id;

    RETURN jsonb_build_object(
      'success', true,
      'order_item_id', p_root_order_item_id,
      'is_new_row', false
    );
  END IF;

  v_po_ratio := CASE
    WHEN COALESCE(v_root.qty_requested, 0) > 0
      THEN COALESCE(v_root.qty_po, 0)::NUMERIC / v_root.qty_requested::NUMERIC
    ELSE 0
  END;
  v_segment_po := FLOOR(p_segment_qty * v_po_ratio)::INT;

  v_bill_line_no := public.allocate_split_bill_line_no(p_order_id, p_root_order_item_id);

  INSERT INTO public.order_items (
    order_id,
    item_id,
    item_name,
    item_alias,
    rack_no,
    qty_requested,
    qty_shippable,
    qty_po,
    qty_approved,
    price_quoted,
    price_system,
    state,
    stock_location_code,
    is_foc,
    split_from_id,
    confirmed_mrp,
    scan_result,
    bill_line_no
  )
  VALUES (
    p_order_id,
    v_root.item_id,
    v_root.item_name,
    v_root.item_alias,
    v_root.rack_no,
    p_segment_qty,
    p_segment_qty,
    v_segment_po,
    p_segment_qty,
    CASE WHEN COALESCE(v_root.is_foc, false) THEN v_root.price_quoted ELSE v_bill_mrp END,
    v_root.price_system,
    'picked',
    v_root.stock_location_code,
    COALESCE(v_root.is_foc, false),
    p_root_order_item_id,
    p_confirmed_mrp,
    p_scan_result,
    v_bill_line_no
  )
  RETURNING id INTO v_new_id;

  SELECT *
  INTO v_reservation
  FROM public.stock_reservations
  WHERE order_item_id = p_root_order_item_id
    AND status IN ('active', 'awaiting_erp_sync')
  LIMIT 1;

  IF FOUND AND v_root.item_id IS NOT NULL THEN
    INSERT INTO public.stock_reservations (
      order_id,
      order_item_id,
      item_id,
      busy_code,
      stock_location_code,
      qty_reserved,
      status,
      source,
      created_by_user_id,
      created_by
    )
    SELECT
      v_reservation.order_id,
      v_new_id,
      v_reservation.item_id,
      v_reservation.busy_code,
      v_reservation.stock_location_code,
      p_segment_qty,
      'active',
      'pick_mrp_split',
      p_user_id,
      v_user_name
    FROM public.stock_reservations sr
    WHERE sr.id = v_reservation.id;
  END IF;

  INSERT INTO public.order_events (order_id, event_type, actor_user_id, stage, payload)
  VALUES (
    p_order_id,
    'pick_line_mrp_split',
    p_user_id,
    'picking',
    jsonb_build_object(
      'root_order_item_id', p_root_order_item_id,
      'order_item_id', v_new_id,
      'segment_qty', p_segment_qty,
      'confirmed_mrp', p_confirmed_mrp,
      'is_first_segment', false
    )
  );

  UPDATE public.orders o
  SET
    item_count = sub.cnt,
    total_value = sub.tval
  FROM (
    SELECT
      COUNT(*)::INT AS cnt,
      COALESCE(SUM(COALESCE(oi.price_quoted, 0) * GREATEST(COALESCE(oi.qty_shippable, 0), 0)), 0)::NUMERIC AS tval
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  ) sub
  WHERE o.id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'order_item_id', v_new_id,
    'is_new_row', true
  );
END;
$$;
