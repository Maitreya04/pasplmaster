-- Rack / bin-wise barcode mapping progress for admin visibility.
-- Unifies WMS bin_inventory slots with Busy stock rack_no on items, normalizing
-- codes the same way as the app (uppercase, strip spaces, keep A-Z0-9-).

CREATE OR REPLACE FUNCTION public.normalize_mapping_rack_code(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(
    regexp_replace(
      upper(regexp_replace(trim(coalesce(p_raw, '')), E'\\s+', '', 'g')),
      '[^A-Z0-9-]',
      '',
      'g'
    ),
    ''
  );
$$;

COMMENT ON FUNCTION public.normalize_mapping_rack_code(text) IS
  'Normalizes rack/bin labels for barcode coverage rollups (matches client normalizeRackCode).';

CREATE OR REPLACE FUNCTION public.get_barcode_rack_coverage()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
BEGIN
  WITH rack_skus AS (
    SELECT DISTINCT
      public.normalize_mapping_rack_code(bin_id) AS rack_id,
      sku_busy_code::numeric AS sku
    FROM public.bin_inventory
    WHERE sku_busy_code IS NOT NULL
      AND public.normalize_mapping_rack_code(bin_id) IS NOT NULL
    UNION
    SELECT DISTINCT
      public.normalize_mapping_rack_code(rack_no) AS rack_id,
      busy_code::numeric AS sku
    FROM public.items
    WHERE is_active IS TRUE
      AND busy_code IS NOT NULL
      AND public.normalize_mapping_rack_code(rack_no) IS NOT NULL
  ),
  mapped_skus AS (
    SELECT DISTINCT sku_busy_code::numeric AS sku
    FROM public.item_barcodes
    WHERE sku_busy_code IS NOT NULL
  ),
  agg AS (
    SELECT
      r.rack_id,
      COUNT(DISTINCT r.sku)::bigint AS total_skus,
      COUNT(DISTINCT CASE WHEN m.sku IS NOT NULL THEN r.sku END)::bigint AS mapped_skus
    FROM rack_skus r
    LEFT JOIN mapped_skus m ON m.sku = r.sku
    GROUP BY r.rack_id
    HAVING COUNT(DISTINCT r.sku) > 0
  ),
  rows_ordered AS (
    SELECT
      rack_id,
      total_skus,
      mapped_skus,
      (total_skus - mapped_skus) AS unmapped_skus,
      COALESCE(
        ROUND((mapped_skus::numeric / NULLIF(total_skus, 0)) * 100, 1),
        0
      ) AS coverage_pct
    FROM agg
  ),
  summary AS (
    SELECT
      COUNT(*)::int AS rack_count,
      COUNT(*) FILTER (WHERE mapped_skus = total_skus)::int AS racks_complete,
      COUNT(*) FILTER (WHERE mapped_skus > 0 AND mapped_skus < total_skus)::int AS racks_in_progress,
      COUNT(*) FILTER (WHERE mapped_skus = 0)::int AS racks_without_mappings
    FROM rows_ordered
  )
  SELECT jsonb_build_object(
    'summary',
    (SELECT to_jsonb(summary.*) FROM summary),
    'racks',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'rack_id', rack_id,
            'total_skus', total_skus,
            'mapped_skus', mapped_skus,
            'unmapped_skus', unmapped_skus,
            'coverage_pct', coverage_pct
          )
          ORDER BY coverage_pct ASC, unmapped_skus DESC, rack_id
        )
        FROM rows_ordered
      ),
      '[]'::jsonb
    )
  )
  INTO v_payload;

  RETURN v_payload;
END;
$$;

COMMENT ON FUNCTION public.get_barcode_rack_coverage() IS
  'Per-rack SKU counts vs item_barcodes mappings for barcode mapping progress UI.';

GRANT EXECUTE ON FUNCTION public.normalize_mapping_rack_code(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_barcode_rack_coverage() TO anon, authenticated;
