-- Receivables performance guardrails.
--
-- This migration keeps the Busy synced tables read-only and untouched:
-- - no ALTER/CREATE INDEX/TRIGGER on customers, customersos, ledger, or sales
-- - no copied receivable summary tables
-- - ledger is removed from the default customer snapshot path
--
-- The goal is to keep Phase 1 cheap on a memory-constrained Supabase project:
-- customer open = one scoped customersos aggregation, ledger = explicit on-demand action.

CREATE OR REPLACE FUNCTION public.get_customer_collection_snapshot(p_customer_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '4000ms'
AS $$
DECLARE
  v_customer_id BIGINT;
  v_customer_name TEXT;
  v_busy_code BIGINT;
  v_busy_code_text TEXT;
  v_mobile TEXT;
  v_salesman TEXT;
  v_city TEXT;
  v_gstin TEXT;
  v_credit_limit NUMERIC;
  v_credit_days INTEGER;
  v_os_payload JSONB;
BEGIN
  IF NOT public.receivables_can_view_customer(p_customer_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT
    c.id,
    c.name,
    c.busy_code,
    c.busy_code::TEXT,
    c.mobile,
    c.salesman,
    coalesce(c.city, c.station),
    c.gstno,
    c.creditlimitamt,
    CASE WHEN c.creditsalesdays IS NULL THEN NULL ELSE c.creditsalesdays::INTEGER END
  INTO
    v_customer_id,
    v_customer_name,
    v_busy_code,
    v_busy_code_text,
    v_mobile,
    v_salesman,
    v_city,
    v_gstin,
    v_credit_limit,
    v_credit_days
  FROM public.customers c
  WHERE c.id = p_customer_id;

  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'customer_not_found');
  END IF;

  IF v_busy_code IS NULL THEN
    v_os_payload := jsonb_build_object(
      'summary', jsonb_build_object(
        'total_pending', 0,
        'credit_adjustments', 0,
        'net_outstanding', 0,
        'bill_count', 0,
        'oldest_days', null,
        'largest_bill_amount', 0,
        'over_credit_days_amount', null
      ),
      'buckets', jsonb_build_object(
        '0_30', jsonb_build_object('label', '0-30', 'amount', 0, 'count', 0),
        '31_60', jsonb_build_object('label', '31-60', 'amount', 0, 'count', 0),
        '61_90', jsonb_build_object('label', '61-90', 'amount', 0, 'count', 0),
        '90_plus', jsonb_build_object('label', '90+', 'amount', 0, 'count', 0)
      ),
      'top_bills', '[]'::jsonb,
      'meta', jsonb_build_object(
        'source_available', false,
        'source', 'customersos',
        'reason', 'missing_busy_code',
        'busy_report_date', null,
        'os_updated_at', null
      )
    );
  ELSIF to_regclass('public.customersos') IS NULL THEN
    v_os_payload := jsonb_build_object(
      'summary', jsonb_build_object(
        'total_pending', 0,
        'credit_adjustments', 0,
        'net_outstanding', 0,
        'bill_count', 0,
        'oldest_days', null,
        'largest_bill_amount', 0,
        'over_credit_days_amount', null
      ),
      'buckets', jsonb_build_object(
        '0_30', jsonb_build_object('label', '0-30', 'amount', 0, 'count', 0),
        '31_60', jsonb_build_object('label', '31-60', 'amount', 0, 'count', 0),
        '61_90', jsonb_build_object('label', '61-90', 'amount', 0, 'count', 0),
        '90_plus', jsonb_build_object('label', '90+', 'amount', 0, 'count', 0)
      ),
      'top_bills', '[]'::jsonb,
      'meta', jsonb_build_object(
        'source_available', false,
        'source', 'customersos',
        'reason', 'table_missing',
        'busy_report_date', null,
        'os_updated_at', null
      )
    );
  ELSE
    WITH raw AS (
      SELECT
        os.amount,
        coalesce(os.days, 0) AS days,
        public.receivables_parse_date(os.report_dt) AS report_dt,
        os.updated_at,
        os.vch_bill_no AS bill_no,
        os.type AS bill_type,
        public.receivables_parse_date(os.date) AS bill_date,
        public.receivables_parse_date(os.duedate) AS due_date,
        os.ref_amt AS ref_amount,
        os.refcode::TEXT AS refcode
      FROM public.customersos os
      WHERE os.party_code = v_busy_code_text
    ),
    agg AS (
      SELECT
        coalesce(sum(amount) FILTER (WHERE amount > 0), 0) AS total_pending,
        abs(coalesce(sum(amount) FILTER (WHERE amount < 0), 0)) AS credit_adjustments,
        coalesce(sum(amount), 0) AS net_outstanding,
        count(*) FILTER (WHERE amount > 0)::INTEGER AS bill_count,
        max(days) FILTER (WHERE amount > 0) AS oldest_days,
        coalesce(max(amount) FILTER (WHERE amount > 0), 0) AS largest_bill_amount,
        CASE WHEN v_credit_days IS NULL THEN NULL ELSE
          coalesce(sum(amount) FILTER (WHERE amount > 0 AND days > v_credit_days), 0)
        END AS over_credit_days_amount,
        coalesce(sum(amount) FILTER (WHERE amount > 0 AND days BETWEEN 0 AND 30), 0) AS bucket_0_30,
        count(*) FILTER (WHERE amount > 0 AND days BETWEEN 0 AND 30)::INTEGER AS bucket_0_30_count,
        coalesce(sum(amount) FILTER (WHERE amount > 0 AND days BETWEEN 31 AND 60), 0) AS bucket_31_60,
        count(*) FILTER (WHERE amount > 0 AND days BETWEEN 31 AND 60)::INTEGER AS bucket_31_60_count,
        coalesce(sum(amount) FILTER (WHERE amount > 0 AND days BETWEEN 61 AND 90), 0) AS bucket_61_90,
        count(*) FILTER (WHERE amount > 0 AND days BETWEEN 61 AND 90)::INTEGER AS bucket_61_90_count,
        coalesce(sum(amount) FILTER (WHERE amount > 0 AND days > 90), 0) AS bucket_90_plus,
        count(*) FILTER (WHERE amount > 0 AND days > 90)::INTEGER AS bucket_90_plus_count,
        max(report_dt) AS busy_report_date,
        max(updated_at) AS os_updated_at
      FROM raw
    ),
    top_bills AS (
      SELECT coalesce(
        jsonb_agg(
          jsonb_build_object(
            'refcode', refcode,
            'bill_no', bill_no,
            'type', bill_type,
            'bill_date', bill_date,
            'due_date', due_date,
            'days', days,
            'ref_amount', coalesce(ref_amount, amount),
            'pending_amount', amount,
            'bucket', public.receivables_bucket_for_days(days)
          )
          ORDER BY days DESC, amount DESC
        ),
        '[]'::jsonb
      ) AS rows
      FROM (
        SELECT *
        FROM raw
        WHERE amount > 0
        ORDER BY days DESC, amount DESC
        LIMIT 5
      ) top_rows
    )
    SELECT jsonb_build_object(
      'summary', jsonb_build_object(
        'total_pending', agg.total_pending,
        'credit_adjustments', agg.credit_adjustments,
        'net_outstanding', agg.net_outstanding,
        'bill_count', agg.bill_count,
        'oldest_days', agg.oldest_days,
        'largest_bill_amount', agg.largest_bill_amount,
        'over_credit_days_amount', agg.over_credit_days_amount
      ),
      'buckets', jsonb_build_object(
        '0_30', jsonb_build_object('label', '0-30', 'amount', agg.bucket_0_30, 'count', agg.bucket_0_30_count),
        '31_60', jsonb_build_object('label', '31-60', 'amount', agg.bucket_31_60, 'count', agg.bucket_31_60_count),
        '61_90', jsonb_build_object('label', '61-90', 'amount', agg.bucket_61_90, 'count', agg.bucket_61_90_count),
        '90_plus', jsonb_build_object('label', '90+', 'amount', agg.bucket_90_plus, 'count', agg.bucket_90_plus_count)
      ),
      'top_bills', top_bills.rows,
      'meta', jsonb_build_object(
        'source_available', true,
        'source', 'customersos',
        'busy_report_date', agg.busy_report_date,
        'os_updated_at', agg.os_updated_at
      )
    )
    INTO v_os_payload
    FROM agg, top_bills;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'customer', jsonb_build_object(
      'id', p_customer_id,
      'name', v_customer_name,
      'busy_code', v_busy_code,
      'mobile', v_mobile,
      'salesman', v_salesman,
      'city', v_city,
      'gstin', v_gstin,
      'credit_limit', v_credit_limit,
      'credit_days', v_credit_days
    ),
    'summary', v_os_payload->'summary',
    'buckets', v_os_payload->'buckets',
    'top_bills', v_os_payload->'top_bills',
    'last_payment', NULL,
    'meta', (v_os_payload->'meta') || jsonb_build_object(
      'generated_at', now(),
      'ledger_match_confidence', CASE WHEN to_regclass('public.ledger') IS NULL THEN 'unavailable' ELSE 'on_demand' END
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_os_bucket(
  p_customer_id BIGINT,
  p_bucket TEXT DEFAULT 'all'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '4000ms'
AS $$
DECLARE
  v_busy_code BIGINT;
  v_bucket TEXT;
  v_payload JSONB;
BEGIN
  IF NOT public.receivables_can_view_customer(p_customer_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  v_bucket := lower(replace(regexp_replace(coalesce(NULLIF(btrim(p_bucket), ''), 'all'), '[-[:space:]]+', '_', 'g'), '+', '_plus'));
  IF v_bucket IN ('90', '90_', '90plus', '90_plus', '90__plus') THEN
    v_bucket := '90_plus';
  END IF;
  IF v_bucket NOT IN ('0_30', '31_60', '61_90', '90_plus', 'all', 'credits') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_bucket');
  END IF;

  SELECT c.busy_code
  INTO v_busy_code
  FROM public.customers c
  WHERE c.id = p_customer_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'customer_not_found');
  END IF;

  IF v_busy_code IS NULL OR to_regclass('public.customersos') IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'bucket', v_bucket,
      'total_amount', 0,
      'count', 0,
      'is_truncated', false,
      'rows', '[]'::jsonb,
      'meta', jsonb_build_object('source_available', false)
    );
  END IF;

  WITH raw AS (
    SELECT
      os.amount,
      coalesce(os.days, 0) AS days,
      public.receivables_parse_date(os.report_dt) AS report_dt,
      os.vch_bill_no AS bill_no,
      os.type AS bill_type,
      public.receivables_parse_date(os.date) AS bill_date,
      public.receivables_parse_date(os.duedate) AS due_date,
      os.ref_amt AS ref_amount,
      os.refcode::TEXT AS refcode
    FROM public.customersos os
    WHERE os.party_code = v_busy_code::TEXT
  ),
  filtered AS (
    SELECT *
    FROM raw
    WHERE CASE v_bucket
      WHEN 'all' THEN amount > 0
      WHEN '0_30' THEN amount > 0 AND days BETWEEN 0 AND 30
      WHEN '31_60' THEN amount > 0 AND days BETWEEN 31 AND 60
      WHEN '61_90' THEN amount > 0 AND days BETWEEN 61 AND 90
      WHEN '90_plus' THEN amount > 0 AND days > 90
      WHEN 'credits' THEN amount < 0
      ELSE false
    END
  ),
  limited AS (
    SELECT *
    FROM filtered
    ORDER BY days DESC, abs(amount) DESC, bill_date DESC NULLS LAST
    LIMIT 250
  )
  SELECT jsonb_build_object(
    'success', true,
    'bucket', v_bucket,
    'total_amount', coalesce((SELECT sum(amount) FROM filtered), 0),
    'count', (SELECT count(*)::INTEGER FROM filtered),
    'is_truncated', (SELECT count(*) FROM filtered) > 250,
    'rows', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'refcode', refcode,
            'bill_no', bill_no,
            'type', bill_type,
            'bill_date', bill_date,
            'due_date', due_date,
            'days', days,
            'ref_amount', coalesce(ref_amount, amount),
            'pending_amount', amount,
            'report_date', report_dt,
            'bucket', public.receivables_bucket_for_days(days)
          )
          ORDER BY days DESC, abs(amount) DESC, bill_date DESC NULLS LAST
        )
        FROM limited
      ),
      '[]'::jsonb
    ),
    'meta', jsonb_build_object('source_available', true, 'source', 'customersos')
  )
  INTO v_payload;

  RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_ledger_statement(
  p_customer_id BIGINT,
  p_from_date DATE DEFAULT NULL,
  p_to_date DATE DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '6000ms'
AS $$
DECLARE
  v_customer_name TEXT;
  v_from DATE;
  v_to DATE;
  v_limit INTEGER;
  v_payload JSONB;
BEGIN
  IF NOT public.receivables_can_view_customer(p_customer_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT c.name
  INTO v_customer_name
  FROM public.customers c
  WHERE c.id = p_customer_id;

  IF v_customer_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'customer_not_found');
  END IF;

  v_to := coalesce(p_to_date, current_date);
  v_from := coalesce(
    p_from_date,
    make_date(
      CASE WHEN extract(month FROM v_to)::INTEGER >= 4
        THEN extract(year FROM v_to)::INTEGER
        ELSE extract(year FROM v_to)::INTEGER - 1
      END,
      4,
      1
    )
  );

  IF v_from > v_to THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_date_range');
  END IF;

  v_limit := least(greatest(coalesce(p_limit, 100), 1), 200);

  IF to_regclass('public.ledger') IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'customer_id', p_customer_id,
      'from_date', v_from,
      'to_date', v_to,
      'row_count', 0,
      'is_truncated', false,
      'voucher_totals', '[]'::jsonb,
      'rows', '[]'::jsonb,
      'meta', jsonb_build_object('source_available', false)
    );
  END IF;

  WITH raw AS (
    SELECT
      l.id AS ledger_id,
      public.receivables_parse_date(l."Date") AS ledger_date,
      l."VchType" AS voucher_type,
      l."DocNo" AS doc_no,
      l."AccountName" AS account_name,
      l."ShortNar" AS narration,
      public.receivables_parse_numeric(l."Amount") AS amount
    FROM public.ledger l
    WHERE public.receivables_party_key(l."Party Name") = public.receivables_party_key(v_customer_name)
  ),
  ranged AS (
    SELECT *
    FROM raw
    WHERE ledger_date BETWEEN v_from AND v_to
  ),
  limited AS (
    SELECT *
    FROM ranged
    ORDER BY ledger_date DESC NULLS LAST, ledger_id DESC
    LIMIT v_limit
  ),
  voucher_totals AS (
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'voucher_type', coalesce(voucher_type, 'Unknown'),
          'count', row_count,
          'amount', amount
        )
        ORDER BY abs(amount) DESC
      ),
      '[]'::jsonb
    ) AS rows
    FROM (
      SELECT
        coalesce(voucher_type, 'Unknown') AS voucher_type,
        count(*)::INTEGER AS row_count,
        coalesce(sum(amount), 0) AS amount
      FROM ranged
      GROUP BY coalesce(voucher_type, 'Unknown')
    ) grouped
  )
  SELECT jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'from_date', v_from,
    'to_date', v_to,
    'row_count', (SELECT count(*)::INTEGER FROM ranged),
    'is_truncated', (SELECT count(*) FROM ranged) > v_limit,
    'voucher_totals', (SELECT rows FROM voucher_totals),
    'rows', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', ledger_id,
            'date', ledger_date,
            'voucher_type', voucher_type,
            'doc_no', doc_no,
            'account_name', account_name,
            'narration', narration,
            'amount', amount,
            'is_future_dated', ledger_date > current_date
          )
          ORDER BY ledger_date DESC NULLS LAST, ledger_id DESC
        )
        FROM limited
      ),
      '[]'::jsonb
    ),
    'meta', jsonb_build_object('source_available', true, 'source', 'ledger', 'match_confidence', 'name_match')
  )
  INTO v_payload;

  RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sales_receivables_meta()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '6000ms'
AS $$
DECLARE
  v_payload JSONB;
BEGIN
  IF public.current_user_role() NOT IN ('admin', 'billing', 'sales') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF to_regclass('public.customersos') IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'source_available', false,
      'fingerprint', null,
      'customer_count', 0,
      'row_count', 0,
      'total_pending', 0,
      'credit_adjustments', 0,
      'busy_report_date', null,
      'os_updated_at', null,
      'generated_at', now()
    );
  END IF;

  WITH actor AS (
    SELECT
      public.current_user_id() AS user_id,
      public.current_user_role() AS role,
      u.full_name
    FROM (SELECT public.current_user_id() AS user_id) me
    LEFT JOIN public.users u ON u.id = me.user_id
  ),
  scoped_customers AS (
    SELECT
      c.id,
      c.busy_code
    FROM public.customers c
    CROSS JOIN actor a
    WHERE c.busy_code IS NOT NULL
      AND (
        a.role IN ('admin', 'billing')
        OR (
          a.role = 'sales'
          AND public.normalize_salesperson_key(c.salesman) = public.normalize_salesperson_key(a.full_name)
        )
      )
  ),
  os_rows AS (
    SELECT
      sc.id AS customer_id,
      os.amount,
      public.receivables_parse_date(os.report_dt) AS report_dt,
      os.updated_at
    FROM scoped_customers sc
    JOIN public.customersos os ON os.party_code = sc.busy_code::TEXT
  ),
  agg AS (
    SELECT
      count(DISTINCT customer_id)::INTEGER AS customer_count,
      count(*)::INTEGER AS row_count,
      coalesce(sum(amount) FILTER (WHERE amount > 0), 0) AS total_pending,
      abs(coalesce(sum(amount) FILTER (WHERE amount < 0), 0)) AS credit_adjustments,
      max(report_dt) AS busy_report_date,
      max(updated_at) AS os_updated_at
    FROM os_rows
  )
  SELECT jsonb_build_object(
    'success', true,
    'source_available', true,
    'fingerprint', md5(concat_ws(
      '|',
      customer_count::TEXT,
      row_count::TEXT,
      total_pending::TEXT,
      credit_adjustments::TEXT,
      coalesce(busy_report_date::TEXT, ''),
      coalesce(os_updated_at::TEXT, '')
    )),
    'customer_count', customer_count,
    'row_count', row_count,
    'total_pending', total_pending,
    'credit_adjustments', credit_adjustments,
    'busy_report_date', busy_report_date,
    'os_updated_at', os_updated_at,
    'generated_at', now()
  )
  INTO v_payload
  FROM agg;

  RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sales_receivables_summary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '8000ms'
AS $$
DECLARE
  v_payload JSONB;
BEGIN
  IF public.current_user_role() NOT IN ('admin', 'billing', 'sales') THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF to_regclass('public.customersos') IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'source_available', false,
      'rows', '[]'::jsonb,
      'generated_at', now()
    );
  END IF;

  WITH actor AS (
    SELECT
      public.current_user_id() AS user_id,
      public.current_user_role() AS role,
      u.full_name
    FROM (SELECT public.current_user_id() AS user_id) me
    LEFT JOIN public.users u ON u.id = me.user_id
  ),
  scoped_customers AS (
    SELECT
      c.id,
      c.name,
      c.mobile,
      c.salesman,
      coalesce(c.city, c.station) AS city,
      c.busy_code
    FROM public.customers c
    CROSS JOIN actor a
    WHERE c.busy_code IS NOT NULL
      AND c.is_active IS DISTINCT FROM false
      AND (
        a.role IN ('admin', 'billing')
        OR (
          a.role = 'sales'
          AND public.normalize_salesperson_key(c.salesman) = public.normalize_salesperson_key(a.full_name)
        )
      )
  ),
  os_rows AS (
    SELECT
      sc.id AS customer_id,
      sc.name,
      sc.mobile,
      sc.salesman,
      sc.city,
      os.amount,
      coalesce(os.days, 0) AS days,
      public.receivables_parse_date(os.report_dt) AS report_dt
    FROM scoped_customers sc
    JOIN public.customersos os ON os.party_code = sc.busy_code::TEXT
  ),
  grouped AS (
    SELECT
      customer_id,
      max(name) AS name,
      max(mobile) AS mobile,
      max(salesman) AS salesman,
      max(city) AS city,
      coalesce(sum(amount) FILTER (WHERE amount > 0), 0) AS total_pending,
      abs(coalesce(sum(amount) FILTER (WHERE amount < 0), 0)) AS credit_adjustments,
      count(*) FILTER (WHERE amount > 0)::INTEGER AS bill_count,
      max(days) FILTER (WHERE amount > 0) AS oldest_days,
      coalesce(sum(amount) FILTER (WHERE amount > 0 AND days BETWEEN 0 AND 30), 0) AS bucket_0_30,
      coalesce(sum(amount) FILTER (WHERE amount > 0 AND days BETWEEN 31 AND 60), 0) AS bucket_31_60,
      coalesce(sum(amount) FILTER (WHERE amount > 0 AND days BETWEEN 61 AND 90), 0) AS bucket_61_90,
      coalesce(sum(amount) FILTER (WHERE amount > 0 AND days > 90), 0) AS bucket_90_plus,
      max(report_dt) AS busy_report_date
    FROM os_rows
    GROUP BY customer_id
  )
  SELECT jsonb_build_object(
    'success', true,
    'source_available', true,
    'rows', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'customer_id', customer_id,
          'name', name,
          'mobile', mobile,
          'salesman', salesman,
          'city', city,
          'total_pending', total_pending,
          'credit_adjustments', credit_adjustments,
          'bill_count', bill_count,
          'oldest_days', oldest_days,
          'busy_report_date', busy_report_date,
          'buckets', jsonb_build_object(
            '0_30', bucket_0_30,
            '31_60', bucket_31_60,
            '61_90', bucket_61_90,
            '90_plus', bucket_90_plus
          )
        )
        ORDER BY bucket_90_plus DESC, bucket_61_90 DESC, total_pending DESC
      ),
      '[]'::jsonb
    ),
    'generated_at', now()
  )
  INTO v_payload
  FROM grouped;

  RETURN v_payload;
END;
$$;

COMMENT ON FUNCTION public.get_customer_collection_snapshot(BIGINT) IS
  'Read-only customer collection snapshot from live customersos only; ledger is intentionally on-demand for performance.';

COMMENT ON FUNCTION public.get_customer_os_bucket(BIGINT, TEXT) IS
  'Read-only outstanding bills for one customer and aging bucket from live customersos with bounded output.';

COMMENT ON FUNCTION public.get_customer_ledger_statement(BIGINT, DATE, DATE, INTEGER) IS
  'Read-only bounded ledger statement preview for one customer and date range; used only on explicit action.';

COMMENT ON FUNCTION public.get_sales_receivables_meta() IS
  'Small assigned-customer receivables fingerprint for client cache validation, bounded by statement timeout.';

COMMENT ON FUNCTION public.get_sales_receivables_summary() IS
  'Assigned-customer receivables summary from live customersos, reserved for Sales Home/My Beat.';

REVOKE ALL ON FUNCTION public.get_customer_collection_snapshot(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_customer_os_bucket(BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_customer_ledger_statement(BIGINT, DATE, DATE, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_sales_receivables_meta() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_sales_receivables_summary() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_customer_collection_snapshot(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_os_bucket(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_ledger_statement(BIGINT, DATE, DATE, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_receivables_meta() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_receivables_summary() TO authenticated;
