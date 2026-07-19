-- A single FY-wide source-group mapping cannot represent target plans that use
-- different levels of detail for different salespeople. Resolve each Busy
-- ItemmainGrp into the best target owned by that salesperson, while retaining
-- the older global map as a fallback for billed categories outside their plan.
CREATE TABLE public.sales_target_segment_members (
  id BIGSERIAL PRIMARY KEY,
  financial_year_id BIGINT NOT NULL
    REFERENCES public.financial_years(id) ON DELETE CASCADE,
  salesperson_user_id BIGINT NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,
  sales_segment_id BIGINT NOT NULL
    REFERENCES public.sales_segments(id) ON DELETE CASCADE,
  source_product_group TEXT NOT NULL,
  normalized_source_group TEXT GENERATED ALWAYS AS (
    public.normalize_sales_dimension(source_product_group)
  ) STORED,
  match_rule TEXT NOT NULL,
  match_priority SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (financial_year_id, salesperson_user_id, normalized_source_group)
);

CREATE INDEX idx_sales_target_segment_members_lookup
  ON public.sales_target_segment_members(
    financial_year_id,
    salesperson_user_id,
    normalized_source_group
  );

CREATE INDEX idx_sales_target_segment_members_segment
  ON public.sales_target_segment_members(
    financial_year_id,
    salesperson_user_id,
    sales_segment_id
  );

ALTER TABLE public.sales_target_segment_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sales_target_segment_members FROM anon, authenticated;

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
  DELETE FROM public.sales_target_segment_members
  WHERE financial_year_id = p_financial_year_id;

  WITH source_pairs AS (
    SELECT DISTINCT
      fy.id AS financial_year_id,
      trim(s."ItemmainGrp") AS source_main_group,
      public.normalize_sales_dimension(s."ItemmainGrp") AS normalized_main_group,
      public.normalize_sales_dimension(s."ItemGrp") AS normalized_item_group
    FROM public.sales s
    JOIN public.financial_years fy
      ON fy.history_fyear_key = trim(s."FYear")
    WHERE fy.id = p_financial_year_id
      AND nullif(trim(s."ItemmainGrp"), '') IS NOT NULL
  ), target_segments AS (
    SELECT
      st.financial_year_id,
      st.salesperson_user_id,
      st.sales_segment_id,
      st.annual_target_lakhs,
      public.normalize_sales_dimension(st.product_group) AS normalized_target
    FROM public.sales_targets st
    WHERE st.financial_year_id = p_financial_year_id
      AND st.salesperson_user_id IS NOT NULL
      AND st.sales_segment_id IS NOT NULL
      AND st.annual_target_lakhs > 0
  ), candidates AS (
    SELECT
      sp.financial_year_id,
      ts.salesperson_user_id,
      sp.source_main_group,
      sp.normalized_main_group,
      ts.sales_segment_id,
      ts.annual_target_lakhs,
      CASE
        WHEN ts.normalized_target = sp.normalized_main_group THEN 1
        WHEN (ts.normalized_target, sp.normalized_main_group) IN (
          ('bfanmotorassy', 'bfanmotoraasy'),
          ('fagbearing', 'scfag'),
          ('fagcross', 'sccross'),
          ('fagcross', 'sccrs'),
          ('scables', 'sjcables'),
          ('swarajoil', 'swaraj')
        ) THEN 2
        WHEN ts.normalized_target = sp.normalized_item_group THEN 3
        WHEN ts.normalized_target = 'lucasinl'
          AND sp.normalized_item_group = 'lucas' THEN 4
        WHEN ts.normalized_target = 'usha3w'
          AND sp.normalized_item_group = 'usha'
          AND sp.normalized_main_group LIKE 'u3%' THEN 5
        WHEN ts.normalized_target = 'usha4w'
          AND sp.normalized_item_group = 'usha'
          AND sp.normalized_main_group LIKE 'u4%' THEN 5
        WHEN ts.normalized_target IN ('fastners', 'gfastners')
          AND sp.normalized_item_group = 'gratco'
          AND sp.normalized_main_group LIKE 'gf%' THEN 5
        WHEN ts.normalized_target = 'u3wheeler'
          AND sp.normalized_item_group = 'usha'
          AND sp.normalized_main_group LIKE 'u3%' THEN 6
        WHEN ts.normalized_target = 'u4wheeler'
          AND sp.normalized_item_group = 'usha'
          AND sp.normalized_main_group LIKE 'u4%' THEN 6
        ELSE 99
      END AS priority,
      CASE
        WHEN ts.normalized_target = sp.normalized_main_group THEN 'exact_item_main_group'
        WHEN (ts.normalized_target, sp.normalized_main_group) IN (
          ('bfanmotorassy', 'bfanmotoraasy'),
          ('fagbearing', 'scfag'),
          ('fagcross', 'sccross'),
          ('fagcross', 'sccrs'),
          ('scables', 'sjcables'),
          ('swarajoil', 'swaraj')
        ) THEN 'governed_alias'
        WHEN ts.normalized_target = sp.normalized_item_group THEN 'exact_item_group'
        WHEN ts.normalized_target = 'lucasinl'
          AND sp.normalized_item_group = 'lucas' THEN 'governed_alias'
        WHEN ts.normalized_target IN ('usha3w', 'usha4w') THEN 'usha_vehicle_family'
        WHEN ts.normalized_target IN ('fastners', 'gfastners') THEN 'fastener_family'
        ELSE 'legacy_vehicle_family'
      END AS match_rule
    FROM source_pairs sp
    JOIN target_segments ts
      ON ts.financial_year_id = sp.financial_year_id
     AND (
       ts.normalized_target = sp.normalized_main_group
       OR ts.normalized_target = sp.normalized_item_group
       OR (ts.normalized_target, sp.normalized_main_group) IN (
         ('bfanmotorassy', 'bfanmotoraasy'),
         ('fagbearing', 'scfag'),
         ('fagcross', 'sccross'),
         ('fagcross', 'sccrs'),
         ('scables', 'sjcables'),
         ('swarajoil', 'swaraj')
       )
       OR (ts.normalized_target = 'lucasinl' AND sp.normalized_item_group = 'lucas')
       OR (
         ts.normalized_target IN ('usha3w', 'u3wheeler')
         AND sp.normalized_item_group = 'usha'
         AND sp.normalized_main_group LIKE 'u3%'
       )
       OR (
         ts.normalized_target IN ('usha4w', 'u4wheeler')
         AND sp.normalized_item_group = 'usha'
         AND sp.normalized_main_group LIKE 'u4%'
       )
       OR (
         ts.normalized_target IN ('fastners', 'gfastners')
         AND sp.normalized_item_group = 'gratco'
         AND sp.normalized_main_group LIKE 'gf%'
       )
     )
  ), selected AS (
    SELECT *
    FROM (
      SELECT
        c.*,
        row_number() OVER (
          PARTITION BY
            c.financial_year_id,
            c.salesperson_user_id,
            c.normalized_main_group
          ORDER BY c.priority, c.annual_target_lakhs DESC, c.sales_segment_id
        ) AS choice
      FROM candidates c
      WHERE c.priority < 99
    ) ranked
    WHERE choice = 1
  )
  INSERT INTO public.sales_target_segment_members(
    financial_year_id,
    salesperson_user_id,
    sales_segment_id,
    source_product_group,
    match_rule,
    match_priority
  )
  SELECT
    financial_year_id,
    salesperson_user_id,
    sales_segment_id,
    source_main_group,
    match_rule,
    priority
  FROM selected;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_sales_target_segment_members(BIGINT)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_sales_achievement_daily(
  p_start_date DATE,
  p_end_date DATE,
  p_refresh_kind TEXT DEFAULT 'recent'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id BIGINT;
  v_source_rows INTEGER := 0;
  v_aggregate_rows INTEGER := 0;
  v_source_max DATE;
  v_unmatched_salesperson_rows INTEGER := 0;
  v_unmatched_salesperson_value NUMERIC := 0;
  v_unmatched_category_rows INTEGER := 0;
  v_unmatched_category_value NUMERIC := 0;
  v_unmapped_segment_id BIGINT;
  v_previous_source_rows INTEGER := 0;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
    RAISE EXCEPTION 'invalid_refresh_range';
  END IF;

  IF p_refresh_kind NOT IN ('recent', 'financial_year', 'mapping', 'backfill') THEN
    RAISE EXCEPTION 'invalid_refresh_kind';
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('refresh_sales_achievement_daily')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'refresh_already_running');
  END IF;

  SELECT id INTO v_unmapped_segment_id
  FROM public.sales_segments WHERE is_unmapped = true LIMIT 1;

  INSERT INTO public.sales_achievement_refresh_runs(refresh_kind, range_start, range_end, status)
  VALUES (p_refresh_kind, p_start_date, p_end_date, 'running')
  RETURNING id INTO v_run_id;

  SELECT
    count(*),
    max(public.busy_sales_date(s."VchDate")),
    count(*) FILTER (WHERE a.salesperson_user_id IS NULL),
    coalesce(sum(abs(public.busy_sales_number(s."Taxableamt")))
      FILTER (WHERE a.salesperson_user_id IS NULL), 0),
    count(*) FILTER (
      WHERE a.salesperson_user_id IS NOT NULL
        AND tm.sales_segment_id IS NULL
        AND gm.sales_segment_id IS NULL
    ),
    coalesce(sum(abs(public.busy_sales_number(s."Taxableamt"))) FILTER (
      WHERE a.salesperson_user_id IS NOT NULL
        AND tm.sales_segment_id IS NULL
        AND gm.sales_segment_id IS NULL
    ), 0)
  INTO
    v_source_rows,
    v_source_max,
    v_unmatched_salesperson_rows,
    v_unmatched_salesperson_value,
    v_unmatched_category_rows,
    v_unmatched_category_value
  FROM public.sales s
  JOIN public.financial_years fy ON fy.history_fyear_key = trim(s."FYear")
  LEFT JOIN public.salesperson_source_aliases a
    ON a.normalized_source_name = public.normalize_sales_dimension(s."Salesman")
  LEFT JOIN public.sales_target_segment_members tm
    ON tm.financial_year_id = fy.id
   AND tm.salesperson_user_id = a.salesperson_user_id
   AND tm.normalized_source_group = public.normalize_sales_dimension(s."ItemmainGrp")
  LEFT JOIN public.sales_segment_members gm
    ON gm.financial_year_id = fy.id
   AND gm.normalized_source_group = public.normalize_sales_dimension(s."ItemmainGrp")
  WHERE public.busy_sales_date(s."VchDate") BETWEEN p_start_date AND p_end_date;

  SELECT coalesce(max(source_rows), 0)
  INTO v_previous_source_rows
  FROM public.sales_achievement_refresh_runs
  WHERE status = 'completed'
    AND range_start = p_start_date
    AND range_end = p_end_date
    AND id <> v_run_id;

  IF v_previous_source_rows > 0 AND v_source_rows < v_previous_source_rows * 0.8 THEN
    UPDATE public.sales_achievement_refresh_runs
    SET status = 'failed',
        source_rows = v_source_rows,
        source_max_voucher_date = v_source_max,
        error_message = 'source_volume_guard',
        completed_at = now()
    WHERE id = v_run_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'source_volume_guard',
      'source_rows', v_source_rows,
      'expected_minimum_rows', floor(v_previous_source_rows * 0.8)
    );
  END IF;

  DELETE FROM public.sales_achievement_daily
  WHERE sales_date BETWEEN p_start_date AND p_end_date;

  INSERT INTO public.sales_achievement_daily(
    sales_date,
    financial_year_id,
    salesperson_user_id,
    sales_segment_id,
    taxable_sales,
    return_value,
    net_achievement,
    invoice_count,
    sales_line_count,
    refreshed_at
  )
  SELECT
    public.busy_sales_date(s."VchDate"),
    fy.id,
    a.salesperson_user_id,
    coalesce(tm.sales_segment_id, gm.sales_segment_id, v_unmapped_segment_id),
    sum(greatest(public.busy_sales_number(s."Taxableamt"), 0)),
    sum(abs(least(public.busy_sales_number(s."Taxableamt"), 0))),
    sum(public.busy_sales_number(s."Taxableamt")),
    count(DISTINCT concat_ws('|', s."FYear", s."VchCode")),
    count(*),
    now()
  FROM public.sales s
  JOIN public.financial_years fy ON fy.history_fyear_key = trim(s."FYear")
  JOIN public.salesperson_source_aliases a
    ON a.normalized_source_name = public.normalize_sales_dimension(s."Salesman")
  LEFT JOIN public.sales_target_segment_members tm
    ON tm.financial_year_id = fy.id
   AND tm.salesperson_user_id = a.salesperson_user_id
   AND tm.normalized_source_group = public.normalize_sales_dimension(s."ItemmainGrp")
  LEFT JOIN public.sales_segment_members gm
    ON gm.financial_year_id = fy.id
   AND gm.normalized_source_group = public.normalize_sales_dimension(s."ItemmainGrp")
  WHERE public.busy_sales_date(s."VchDate") BETWEEN p_start_date AND p_end_date
  GROUP BY
    public.busy_sales_date(s."VchDate"),
    fy.id,
    a.salesperson_user_id,
    coalesce(tm.sales_segment_id, gm.sales_segment_id, v_unmapped_segment_id);

  GET DIAGNOSTICS v_aggregate_rows = ROW_COUNT;

  UPDATE public.sales_achievement_refresh_runs
  SET status = 'completed',
      source_rows = v_source_rows,
      aggregate_rows = v_aggregate_rows,
      source_max_voucher_date = v_source_max,
      unmatched_salesperson_rows = v_unmatched_salesperson_rows,
      unmatched_salesperson_value = v_unmatched_salesperson_value,
      unmatched_category_rows = v_unmatched_category_rows,
      unmatched_category_value = v_unmatched_category_value,
      completed_at = now()
  WHERE id = v_run_id;

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id,
    'source_rows', v_source_rows,
    'aggregate_rows', v_aggregate_rows,
    'source_max_voucher_date', v_source_max,
    'unmatched_salesperson_rows', v_unmatched_salesperson_rows,
    'unmatched_salesperson_value', v_unmatched_salesperson_value,
    'unmatched_category_rows', v_unmatched_category_rows,
    'unmatched_category_value', v_unmatched_category_value
  );
EXCEPTION WHEN OTHERS THEN
  IF v_run_id IS NOT NULL THEN
    UPDATE public.sales_achievement_refresh_runs
    SET status = 'failed', error_message = SQLERRM, completed_at = now()
    WHERE id = v_run_id;
  END IF;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_sales_achievement_daily(DATE, DATE, TEXT)
  FROM PUBLIC, anon, authenticated;

-- Build the current FY mappings and regenerate the compact dashboard facts.
DO $$
DECLARE
  v_fy public.financial_years%ROWTYPE;
BEGIN
  SELECT * INTO v_fy
  FROM public.financial_years
  WHERE is_active = true
  LIMIT 1;

  IF FOUND THEN
    PERFORM public.reconcile_sales_target_segment_members(v_fy.id);
    PERFORM public.refresh_sales_achievement_daily(
      v_fy.starts_on,
      least(v_fy.ends_on, (now() AT TIME ZONE 'Asia/Kolkata')::date),
      'mapping'
    );
  END IF;
END;
$$;
