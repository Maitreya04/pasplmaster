-- Extend ledger statement RPC with brought-forward opening balance from Busy OS.

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
  v_busy_code BIGINT;
  v_from DATE;
  v_to DATE;
  v_limit INTEGER;
  v_use_normalized BOOLEAN := false;
  v_match_confidence TEXT := 'none';
  v_payload JSONB;
  v_opening_balance JSONB;
  v_opening_bills JSONB;
BEGIN
  IF NOT public.receivables_can_view_customer(p_customer_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT c.name, c.busy_code
  INTO v_customer_name, v_busy_code
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

  v_opening_balance := jsonb_build_object(
    'amount', 0,
    'count', 0,
    'as_of', v_from,
    'is_truncated', false
  );
  v_opening_bills := '[]'::jsonb;

  IF v_busy_code IS NOT NULL AND to_regclass('public.customersos') IS NOT NULL THEN
    WITH os_raw AS (
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
    opening_filtered AS (
      SELECT *
      FROM os_raw
      WHERE amount > 0
        AND bill_date IS NOT NULL
        AND bill_date < v_from
    ),
    opening_limited AS (
      SELECT *
      FROM opening_filtered
      ORDER BY days DESC, abs(amount) DESC, bill_date DESC NULLS LAST
      LIMIT 100
    )
    SELECT
      jsonb_build_object(
        'amount', coalesce((SELECT sum(amount) FROM opening_filtered), 0),
        'count', coalesce((SELECT count(*)::INTEGER FROM opening_filtered), 0),
        'as_of', v_from,
        'is_truncated', coalesce((SELECT count(*) FROM opening_filtered), 0) > 100
      ),
      coalesce(
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
          FROM opening_limited
        ),
        '[]'::jsonb
      )
    INTO v_opening_balance, v_opening_bills;
  END IF;

  IF to_regclass('public.ledger') IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'customer_id', p_customer_id,
      'from_date', v_from,
      'to_date', v_to,
      'row_count', 0,
      'is_truncated', false,
      'opening_balance', v_opening_balance,
      'opening_bills', v_opening_bills,
      'voucher_totals', '[]'::jsonb,
      'rows', '[]'::jsonb,
      'meta', jsonb_build_object('source_available', false)
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledger l
    WHERE l."Party Name" = v_customer_name
      AND public.receivables_parse_date(l."Date") BETWEEN v_from AND v_to
    LIMIT 1
  ) THEN
    v_match_confidence := 'exact_name';
  ELSIF EXISTS (
    SELECT 1
    FROM public.ledger l
    WHERE public.receivables_parse_date(l."Date") BETWEEN v_from AND v_to
      AND public.receivables_party_key(l."Party Name") = public.receivables_party_key(v_customer_name)
    LIMIT 1
  ) THEN
    v_match_confidence := 'normalized_name';
    v_use_normalized := true;
  ELSE
    RETURN jsonb_build_object(
      'success', true,
      'customer_id', p_customer_id,
      'from_date', v_from,
      'to_date', v_to,
      'row_count', 0,
      'is_truncated', false,
      'opening_balance', v_opening_balance,
      'opening_bills', v_opening_bills,
      'voucher_totals', '[]'::jsonb,
      'rows', '[]'::jsonb,
      'meta', jsonb_build_object(
        'source_available', true,
        'source', 'ledger',
        'match_confidence', 'none'
      )
    );
  END IF;

  WITH ledger_source AS (
    SELECT
      l.id AS ledger_id,
      public.receivables_parse_date(l."Date") AS ledger_date,
      l."VchType" AS voucher_type,
      l."DocNo" AS doc_no,
      l."AccountName" AS account_name,
      l."ShortNar" AS narration,
      public.receivables_parse_numeric(l."Amount") AS amount
    FROM public.ledger l
    WHERE public.receivables_parse_date(l."Date") BETWEEN v_from AND v_to
      AND (
        (NOT v_use_normalized AND l."Party Name" = v_customer_name)
        OR (
          v_use_normalized
          AND public.receivables_party_key(l."Party Name") = public.receivables_party_key(v_customer_name)
        )
      )
  ),
  limited AS (
    SELECT *
    FROM ledger_source
    ORDER BY ledger_date DESC NULLS LAST, ledger_id DESC
    LIMIT v_limit
  )
  SELECT jsonb_build_object(
    'success', true,
    'customer_id', p_customer_id,
    'from_date', v_from,
    'to_date', v_to,
    'row_count', (SELECT count(*)::INTEGER FROM ledger_source),
    'is_truncated', (SELECT count(*) FROM ledger_source) > v_limit,
    'opening_balance', v_opening_balance,
    'opening_bills', v_opening_bills,
    'voucher_totals', coalesce(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'voucher_type', voucher_type,
            'count', row_count,
            'amount', amount
          )
          ORDER BY abs(amount) DESC
        )
        FROM (
          SELECT
            coalesce(voucher_type, 'Unknown') AS voucher_type,
            count(*)::INTEGER AS row_count,
            coalesce(sum(amount), 0) AS amount
          FROM ledger_source
          GROUP BY coalesce(voucher_type, 'Unknown')
        ) grouped
      ),
      '[]'::jsonb
    ),
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
    'meta', jsonb_build_object(
      'source_available', true,
      'source', 'ledger',
      'match_confidence', v_match_confidence
    )
  )
  INTO v_payload;

  RETURN v_payload;
END;
$$;

COMMENT ON FUNCTION public.get_customer_ledger_statement(BIGINT, DATE, DATE, INTEGER) IS
  'Bounded ledger preview with brought-forward opening balance from customersos bills before from_date.';
