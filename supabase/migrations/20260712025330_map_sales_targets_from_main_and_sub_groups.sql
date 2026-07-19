-- Resolve Busy's two category levels into the target-sheet segment. The
-- specific ItemmainGrp wins; ItemGrp is a fallback when the plan targets the
-- broader brand/group.
CREATE OR REPLACE FUNCTION public.reconcile_sales_target_segment_members(
  p_financial_year_id BIGINT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  WITH source_pairs AS (
    SELECT DISTINCT
      fy.id AS financial_year_id,
      trim(s."ItemmainGrp") AS source_main_group,
      public.normalize_sales_dimension(s."ItemmainGrp") AS normalized_main_group,
      public.normalize_sales_dimension(s."ItemGrp") AS normalized_sub_group
    FROM public.sales s
    JOIN public.financial_years fy ON fy.history_fyear_key = trim(s."FYear")
    WHERE fy.id = p_financial_year_id
      AND nullif(trim(s."ItemmainGrp"), '') IS NOT NULL
  ), target_segments AS (
    SELECT DISTINCT
      st.financial_year_id,
      st.sales_segment_id,
      public.normalize_sales_dimension(st.product_group) AS normalized_target
    FROM public.sales_targets st
    WHERE st.financial_year_id = p_financial_year_id
      AND st.sales_segment_id IS NOT NULL
  ), candidates AS (
    SELECT
      sp.financial_year_id,
      sp.source_main_group,
      ts.sales_segment_id,
      CASE
        WHEN ts.normalized_target = sp.normalized_main_group THEN 1
        WHEN ts.normalized_target = sp.normalized_sub_group THEN 2
        ELSE 99
      END AS priority
    FROM source_pairs sp
    JOIN target_segments ts
      ON ts.financial_year_id = sp.financial_year_id
     AND ts.normalized_target IN (sp.normalized_main_group, sp.normalized_sub_group)
  ), selected AS (
    SELECT financial_year_id, source_main_group, sales_segment_id
    FROM (
      SELECT c.*,
             row_number() OVER (
               PARTITION BY c.financial_year_id,
                            public.normalize_sales_dimension(c.source_main_group)
               ORDER BY c.priority, c.sales_segment_id
             ) AS choice
      FROM candidates c
    ) ranked
    WHERE choice = 1
  )
  INSERT INTO public.sales_segment_members(
    financial_year_id,
    sales_segment_id,
    source_product_group
  )
  SELECT financial_year_id, sales_segment_id, source_main_group
  FROM selected
  ON CONFLICT (financial_year_id, normalized_source_group)
  DO UPDATE SET sales_segment_id = EXCLUDED.sales_segment_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reconcile_sales_target_mappings(
  p_financial_year_label TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_fy public.financial_years%ROWTYPE;
  v_mapped INTEGER;
  v_refresh JSONB;
BEGIN
  PERFORM public.assert_current_admin();

  SELECT * INTO v_fy
  FROM public.financial_years
  WHERE label = p_financial_year_label;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'financial_year_not_found');
  END IF;

  v_mapped := public.reconcile_sales_target_segment_members(v_fy.id);
  v_refresh := public.refresh_sales_achievement_daily(
    v_fy.starts_on,
    least(v_fy.ends_on, (now() AT TIME ZONE 'Asia/Kolkata')::date),
    'mapping'
  );

  RETURN jsonb_build_object(
    'success', coalesce((v_refresh->>'success')::boolean, false),
    'mapped_groups', v_mapped,
    'refresh', v_refresh
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_sales_target_segment_members(BIGINT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_reconcile_sales_target_mappings(TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_sales_target_mappings(TEXT)
  TO authenticated, service_role;

-- Repair current data when this migration is applied. The importer calls the
-- admin RPC after every future target upload.
SELECT public.reconcile_sales_target_segment_members(id)
FROM public.financial_years
WHERE is_active = true;

DO $$
DECLARE
  v_fy public.financial_years%ROWTYPE;
BEGIN
  SELECT * INTO v_fy
  FROM public.financial_years
  WHERE is_active = true
  LIMIT 1;

  IF FOUND THEN
    PERFORM public.refresh_sales_achievement_daily(
      v_fy.starts_on,
      least(v_fy.ends_on, (now() AT TIME ZONE 'Asia/Kolkata')::date),
      'mapping'
    );
  END IF;
END;
$$;
