-- PASPL — stock_mrpwise schema snapshot (table already live in prod) + picker MRP history read RPC.
-- Populated from Busy ERP; picker uses this to prefill / disambiguate MRP at pick time.

CREATE TABLE IF NOT EXISTS public.stock_mrpwise (
  busy_code BIGINT NOT NULL,
  stock_location TEXT NOT NULL DEFAULT '',
  mrp NUMERIC NOT NULL,
  salesprice NUMERIC NOT NULL DEFAULT 0,
  stock_qty NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (busy_code, stock_location, mrp)
);

CREATE INDEX IF NOT EXISTS idx_stock_mrpwise_busy_code
  ON public.stock_mrpwise (busy_code);

COMMENT ON TABLE public.stock_mrpwise IS
  'Busy ERP MRP bands per SKU and warehouse location. Synced externally; read-only for app pickers.';

-- ─── Picker: MRP history for label confirmation ───
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
  v_history JSONB;
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
            'is_latest', r.rn = 1
          )
          ORDER BY r.updated_at DESC, r.mrp DESC
        )
        FROM ranked r
      ),
      '[]'::jsonb
    ),
    (SELECT r2.mrp FROM ranked r2 WHERE r2.rn = 1 LIMIT 1)
  INTO v_history, v_latest_mrp;

  RETURN jsonb_build_object(
    'success', true,
    'busy_code', p_busy_code,
    'stock_location_code', v_norm_loc,
    'latest_mrp', v_latest_mrp,
    'history', coalesce(v_history, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_stock_mrp_history(NUMERIC, TEXT) TO anon, authenticated;

GRANT SELECT ON public.stock_mrpwise TO anon, authenticated;
