-- Batch read billing-verified label MRP for sales default pricing (app overlay only).

CREATE OR REPLACE FUNCTION public.get_billing_verified_label_mrp_batch(
  p_busy_codes BIGINT[],
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
  v_result JSONB;
BEGIN
  IF p_busy_codes IS NULL OR array_length(p_busy_codes, 1) IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  v_norm_loc := NULL;
  IF p_stock_location_code IS NOT NULL AND trim(p_stock_location_code) <> '' THEN
    v_norm_loc := public.normalize_stock_location_code(p_stock_location_code);
    IF v_norm_loc IS NULL AND lower(trim(p_stock_location_code)) IN ('main_store', 'jabalpur') THEN
      v_norm_loc := lower(trim(p_stock_location_code));
    END IF;
  END IF;
  v_norm_loc := COALESCE(v_norm_loc, 'main_store');

  SELECT coalesce(
    jsonb_object_agg(r.busy_code::TEXT, r.label_mrp),
    '{}'::jsonb
  )
  INTO v_result
  FROM (
    SELECT DISTINCT ON (plm.busy_code)
      plm.busy_code,
      ROUND(plm.label_mrp) AS label_mrp
    FROM public.picker_label_mrp plm
    WHERE plm.busy_code = ANY (p_busy_codes)
      AND plm.trust_level = 'billing_verified'
      AND (
        plm.stock_location_code = v_norm_loc
        OR plm.stock_location_code = ''
      )
    ORDER BY
      plm.busy_code,
      CASE WHEN plm.stock_location_code = v_norm_loc THEN 0 ELSE 1 END,
      plm.last_confirmed_at DESC
  ) r;

  RETURN coalesce(v_result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_billing_verified_label_mrp_batch(BIGINT[], TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.get_billing_verified_label_mrp_batch(BIGINT[], TEXT) IS
  'Map busy_code → billing-verified label MRP for sales order default pricing (overlay only).';
