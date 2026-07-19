-- Sales New Order receivables snapshot and payment signal.
--
-- Guardrails:
-- - Busy synced tables remain read-only.
-- - No indexes, triggers, or writes on customers, customersos, ledger, or sales.
-- - OS snapshot stays ledger-free; payment signal is a separate bounded RPC.

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
        'over_credit_days_amount', null,
        'over_credit_days_count', 0
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
        'over_credit_days_amount', null,
        'over_credit_days_count', 0
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
        CASE WHEN v_credit_days IS NULL THEN 0 ELSE
          count(*) FILTER (WHERE amount > 0 AND days > v_credit_days)::INTEGER
        END AS over_credit_days_count,
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
        'over_credit_days_amount', agg.over_credit_days_amount,
        'over_credit_days_count', agg.over_credit_days_count
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
  v_credit_days INTEGER;
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
  IF v_bucket = 'overterms' THEN
    v_bucket := 'over_terms';
  END IF;
  IF v_bucket NOT IN ('0_30', '31_60', '61_90', '90_plus', 'all', 'credits', 'over_terms') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_bucket');
  END IF;

  SELECT
    c.busy_code,
    CASE WHEN c.creditsalesdays IS NULL THEN NULL ELSE c.creditsalesdays::INTEGER END
  INTO v_busy_code, v_credit_days
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

  IF v_bucket = 'over_terms' AND v_credit_days IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'bucket', v_bucket,
      'total_amount', 0,
      'count', 0,
      'is_truncated', false,
      'rows', '[]'::jsonb,
      'meta', jsonb_build_object(
        'source_available', true,
        'source', 'customersos',
        'reason', 'terms_missing'
      )
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
      WHEN 'over_terms' THEN amount > 0 AND days > coalesce(v_credit_days, 2147483647)
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
    'meta', jsonb_build_object(
      'source_available', true,
      'source', 'customersos',
      'credit_days', v_credit_days
    )
  )
  INTO v_payload;

  RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_payment_signal(
  p_customer_id BIGINT,
  p_window_days INTEGER DEFAULT 180,
  p_limit INTEGER DEFAULT 5
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
  v_window_days INTEGER;
  v_limit INTEGER;
  v_from DATE;
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

  v_window_days := least(greatest(coalesce(p_window_days, 180), 30), 730);
  v_limit := least(greatest(coalesce(p_limit, 5), 1), 25);
  v_from := current_date - v_window_days;

  IF to_regclass('public.ledger') IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'customer_id', p_customer_id,
      'window_days', v_window_days,
      'from_date', v_from,
      'to_date', current_date,
      'latest_receipt', null,
      'days_since_last_payment', null,
      'receipt_count', 0,
      'total_received', 0,
      'average_receipt_gap_days', null,
      'rows', '[]'::jsonb,
      'meta', jsonb_build_object('source_available', false)
    );
  END IF;

  WITH exact_raw AS MATERIALIZED (
    SELECT
      l.id AS ledger_id,
      public.receivables_parse_date(l."Date") AS receipt_date,
      l."DocNo" AS doc_no,
      l."AccountName" AS account_name,
      l."ShortNar" AS narration,
      public.receivables_parse_numeric(l."Amount") AS amount,
      'exact_name'::TEXT AS match_confidence
    FROM public.ledger l
    WHERE l."Party Name" = v_customer_name
      AND l."VchType" = 'Receipt'
  ),
  exact_count AS MATERIALIZED (
    SELECT count(*) AS rows_found
    FROM exact_raw
  ),
  normalized_raw AS MATERIALIZED (
    SELECT
      l.id AS ledger_id,
      public.receivables_parse_date(l."Date") AS receipt_date,
      l."DocNo" AS doc_no,
      l."AccountName" AS account_name,
      l."ShortNar" AS narration,
      public.receivables_parse_numeric(l."Amount") AS amount,
      'normalized_name'::TEXT AS match_confidence
    FROM public.ledger l
    WHERE (SELECT rows_found FROM exact_count) = 0
      AND l."VchType" = 'Receipt'
      AND public.receivables_party_key(l."Party Name") = public.receivables_party_key(v_customer_name)
  ),
  raw AS (
    SELECT * FROM exact_raw
    UNION ALL
    SELECT * FROM normalized_raw
  ),
  valid_receipts AS (
    SELECT *
    FROM raw
    WHERE receipt_date IS NOT NULL
      AND receipt_date <= current_date
  ),
  ranged AS (
    SELECT *
    FROM valid_receipts
    WHERE receipt_date >= v_from
  ),
  limited AS (
    SELECT *
    FROM ranged
    ORDER BY receipt_date DESC, ledger_id DESC
    LIMIT v_limit
  ),
  latest AS (
    SELECT *
    FROM valid_receipts
    ORDER BY receipt_date DESC, ledger_id DESC
    LIMIT 1
  ),
  receipt_dates AS (
    SELECT DISTINCT receipt_date
    FROM ranged
  ),
  receipt_gaps AS (
    SELECT
      receipt_date - lag(receipt_date) OVER (ORDER BY receipt_date) AS gap_days
    FROM receipt_dates
  ),
  agg AS (
    SELECT
      count(*)::INTEGER AS receipt_count,
      coalesce(sum(amount), 0) AS total_received
    FROM ranged
  ),
  gap_agg AS (
    SELECT round(avg(gap_days)::NUMERIC, 1) AS average_receipt_gap_days
    FROM receipt_gaps
    WHERE gap_days IS NOT NULL
  ),
  match_meta AS (
    SELECT coalesce(max(match_confidence), 'none') AS match_confidence
    FROM raw
  )
  SELECT jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'window_days', v_window_days,
    'from_date', v_from,
    'to_date', current_date,
    'latest_receipt', (
      SELECT CASE WHEN latest.ledger_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', latest.ledger_id,
        'date', latest.receipt_date,
        'amount', latest.amount,
        'doc_no', latest.doc_no,
        'account_name', latest.account_name,
        'narration', latest.narration
      ) END
      FROM latest
    ),
    'days_since_last_payment', (
      SELECT CASE WHEN latest.receipt_date IS NULL THEN NULL ELSE current_date - latest.receipt_date END
      FROM latest
    ),
    'receipt_count', agg.receipt_count,
    'total_received', agg.total_received,
    'average_receipt_gap_days', gap_agg.average_receipt_gap_days,
    'rows', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', ledger_id,
            'date', receipt_date,
            'amount', amount,
            'doc_no', doc_no,
            'account_name', account_name,
            'narration', narration
          )
          ORDER BY receipt_date DESC, ledger_id DESC
        )
        FROM limited
      ),
      '[]'::jsonb
    ),
    'meta', jsonb_build_object(
      'source_available', true,
      'source', 'ledger',
      'voucher_type', 'Receipt',
      'match_confidence', (SELECT match_confidence FROM match_meta)
    )
  )
  INTO v_payload
  FROM agg, gap_agg;

  RETURN v_payload;
END;
$$;

COMMENT ON FUNCTION public.get_customer_collection_snapshot(BIGINT) IS
  'Read-only customer collection snapshot from live customersos only; includes over-credit-days count and no ledger scan.';

COMMENT ON FUNCTION public.get_customer_os_bucket(BIGINT, TEXT) IS
  'Read-only outstanding bills for one customer and aging/terms bucket from live customersos with bounded output.';

COMMENT ON FUNCTION public.get_customer_payment_signal(BIGINT, INTEGER, INTEGER) IS
  'Read-only bounded receipt cadence signal for Sales New Order; exact name fast path with normalized fallback.';

REVOKE ALL ON FUNCTION public.get_customer_collection_snapshot(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_customer_os_bucket(BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_customer_payment_signal(BIGINT, INTEGER, INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_customer_collection_snapshot(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_os_bucket(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_payment_signal(BIGINT, INTEGER, INTEGER) TO authenticated;
