-- App-owned label MRP overlay for pickers (never writes to stock_mrpwise / Busy sync).
-- Phase 1: record picker confirmations + merge into get_stock_mrp_history read path.

CREATE TABLE IF NOT EXISTS public.picker_label_mrp (
  id BIGSERIAL PRIMARY KEY,
  busy_code BIGINT NOT NULL,
  stock_location_code TEXT NOT NULL DEFAULT '',
  label_mrp NUMERIC NOT NULL,
  trust_level TEXT NOT NULL DEFAULT 'picker'
    CHECK (trust_level IN ('picker', 'billing_verified')),
  confirmation_count INTEGER NOT NULL DEFAULT 1,
  last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_confirmed_by TEXT,
  last_order_item_id BIGINT REFERENCES public.order_items (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT picker_label_mrp_busy_loc_mrp_unique
    UNIQUE (busy_code, stock_location_code, label_mrp)
);

CREATE INDEX IF NOT EXISTS idx_picker_label_mrp_lookup
  ON public.picker_label_mrp (busy_code, stock_location_code);

COMMENT ON TABLE public.picker_label_mrp IS
  'Warehouse-verified label MRP per SKU/location. Merged at read time into picker MRP history; ERP tables untouched.';

ALTER TABLE public.picker_label_mrp ENABLE ROW LEVEL SECURITY;

-- ─── Record picker label MRP after pick (called from app, not Busy sync) ───
CREATE OR REPLACE FUNCTION public.record_picker_label_mrp(p_order_item_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.order_items%ROWTYPE;
  v_busy_code BIGINT;
  v_norm_loc TEXT;
  v_label_mrp NUMERIC;
  v_confirmed_by TEXT;
BEGIN
  IF p_order_item_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_line');
  END IF;

  SELECT oi.*
  INTO v_row
  FROM public.order_items oi
  WHERE oi.id = p_order_item_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  IF COALESCE(v_row.is_foc, false) THEN
    RETURN jsonb_build_object('success', true, 'action', 'skipped_foc');
  END IF;

  v_label_mrp := v_row.confirmed_mrp;
  IF v_label_mrp IS NULL AND v_row.scan_result IS NOT NULL THEN
    BEGIN
      v_label_mrp := NULLIF((v_row.scan_result ->> 'confirmedMrp')::NUMERIC, NULL);
    EXCEPTION
      WHEN OTHERS THEN
        v_label_mrp := NULL;
    END;
  END IF;

  IF v_label_mrp IS NULL OR v_label_mrp < 0 THEN
    RETURN jsonb_build_object('success', true, 'action', 'no_label_mrp');
  END IF;

  SELECT i.busy_code::BIGINT
  INTO v_busy_code
  FROM public.items i
  WHERE i.id = v_row.item_id
    AND i.busy_code IS NOT NULL
    AND i.busy_code > 0;

  IF v_busy_code IS NULL THEN
    RETURN jsonb_build_object('success', true, 'action', 'no_busy_code');
  END IF;

  v_norm_loc := public.normalize_stock_location_code(v_row.stock_location_code);
  IF v_norm_loc IS NULL THEN
    SELECT public.normalize_stock_location_code(o.stock_location_code)
    INTO v_norm_loc
    FROM public.orders o
    WHERE o.id = v_row.order_id;
  END IF;
  v_norm_loc := COALESCE(v_norm_loc, 'main_store');

  v_confirmed_by := NULL;
  IF v_row.scan_result IS NOT NULL THEN
    v_confirmed_by := NULLIF(trim(v_row.scan_result #>> '{operatorContext,pickerName}'), '');
  END IF;

  INSERT INTO public.picker_label_mrp (
    busy_code,
    stock_location_code,
    label_mrp,
    trust_level,
    confirmation_count,
    last_confirmed_at,
    last_confirmed_by,
    last_order_item_id
  )
  VALUES (
    v_busy_code,
    v_norm_loc,
    ROUND(v_label_mrp),
    'picker',
    1,
    now(),
    v_confirmed_by,
    p_order_item_id
  )
  ON CONFLICT ON CONSTRAINT picker_label_mrp_busy_loc_mrp_unique
  DO UPDATE SET
    confirmation_count = public.picker_label_mrp.confirmation_count + 1,
    last_confirmed_at = now(),
    last_confirmed_by = COALESCE(EXCLUDED.last_confirmed_by, public.picker_label_mrp.last_confirmed_by),
    last_order_item_id = EXCLUDED.last_order_item_id;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'recorded',
    'busy_code', v_busy_code,
    'stock_location_code', v_norm_loc,
    'label_mrp', ROUND(v_label_mrp)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_picker_label_mrp(BIGINT) TO anon, authenticated;

COMMENT ON FUNCTION public.record_picker_label_mrp(BIGINT) IS
  'Upsert picker-confirmed label MRP into app overlay (does not touch ERP / stock_mrpwise).';

-- ─── Merge overlay into picker MRP history (stock_mrpwise query unchanged) ───
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
BEGIN
  IF p_busy_code IS NULL OR p_busy_code <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'busy_code_required',
      'latest_mrp', NULL,
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

  WITH overlay_elems AS (
    SELECT value AS elem, ordinality AS ord
    FROM jsonb_array_elements(coalesce(v_overlay_history, '[]'::jsonb)) WITH ORDINALITY
  ),
  stock_elems AS (
    SELECT value AS elem
    FROM jsonb_array_elements(coalesce(v_stock_history, '[]'::jsonb))
  ),
  stock_filtered AS (
    SELECT s.elem
    FROM stock_elems s
    WHERE NOT EXISTS (
      SELECT 1
      FROM overlay_elems o
      WHERE ROUND((o.elem ->> 'mrp')::NUMERIC) = ROUND((s.elem ->> 'mrp')::NUMERIC)
    )
  ),
  merged_raw AS (
    SELECT elem, ord AS sort_ord, 0 AS tier
    FROM overlay_elems
    UNION ALL
    SELECT elem, row_number() OVER () AS sort_ord, 1 AS tier
    FROM stock_filtered
  ),
  merged_ordered AS (
    SELECT
      elem,
      row_number() OVER (ORDER BY tier, sort_ord) AS final_ord
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

  v_latest_mrp := coalesce(v_overlay_latest_mrp, v_stock_latest_mrp);

  IF jsonb_array_length(coalesce(v_merged_history, '[]'::jsonb)) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'no_history',
      'busy_code', p_busy_code,
      'stock_location_code', v_norm_loc,
      'latest_mrp', NULL,
      'history', '[]'::jsonb
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'busy_code', p_busy_code,
    'stock_location_code', v_norm_loc,
    'latest_mrp', v_latest_mrp,
    'history', v_merged_history
  );
END;
$$;
