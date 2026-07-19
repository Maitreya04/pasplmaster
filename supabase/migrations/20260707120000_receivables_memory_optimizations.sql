-- Receivables memory optimizations.
--
-- Problem: get_customer_payment_signal and get_customer_ledger_statement used
-- MATERIALIZED CTEs that loaded entire lifetime ledger history per customer into
-- temp memory. Combined with SalesLayout warming all stock every 30s, this
-- pushed a small Supabase instance into heavy swap usage.
--
-- Fixes:
-- - Drop MATERIALIZED; push date filters into WHERE before aggregation
-- - Rewrite payment signal as small bounded queries (latest + window stats)
-- - Revoke unused admin-scale summary RPC from client roles

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
SET statement_timeout = '4000ms'
AS $$
DECLARE
  v_customer_name TEXT;
  v_window_days INTEGER;
  v_limit INTEGER;
  v_from DATE;
  v_use_normalized BOOLEAN := false;
  v_match_confidence TEXT := 'none';
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

  IF EXISTS (
    SELECT 1
    FROM public.ledger l
    WHERE l."Party Name" = v_customer_name
      AND l."VchType" = 'Receipt'
    LIMIT 1
  ) THEN
    v_match_confidence := 'exact_name';
  ELSIF EXISTS (
    SELECT 1
    FROM public.ledger l
    WHERE l."VchType" = 'Receipt'
      AND public.receivables_party_key(l."Party Name") = public.receivables_party_key(v_customer_name)
    LIMIT 1
  ) THEN
    v_match_confidence := 'normalized_name';
    v_use_normalized := true;
  ELSE
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
      'meta', jsonb_build_object(
        'source_available', true,
        'source', 'ledger',
        'voucher_type', 'Receipt',
        'match_confidence', 'none'
      )
    );
  END IF;

  WITH ranged AS (
    SELECT
      l.id AS ledger_id,
      public.receivables_parse_date(l."Date") AS receipt_date,
      l."DocNo" AS doc_no,
      l."AccountName" AS account_name,
      l."ShortNar" AS narration,
      public.receivables_parse_numeric(l."Amount") AS amount
    FROM public.ledger l
    WHERE l."VchType" = 'Receipt'
      AND public.receivables_parse_date(l."Date") >= v_from
      AND public.receivables_parse_date(l."Date") <= current_date
      AND (
        (NOT v_use_normalized AND l."Party Name" = v_customer_name)
        OR (
          v_use_normalized
          AND public.receivables_party_key(l."Party Name") = public.receivables_party_key(v_customer_name)
        )
      )
  ),
  latest AS (
    SELECT
      l.id AS ledger_id,
      public.receivables_parse_date(l."Date") AS receipt_date,
      l."DocNo" AS doc_no,
      l."AccountName" AS account_name,
      l."ShortNar" AS narration,
      public.receivables_parse_numeric(l."Amount") AS amount
    FROM public.ledger l
    WHERE l."VchType" = 'Receipt'
      AND public.receivables_parse_date(l."Date") <= current_date
      AND (
        (NOT v_use_normalized AND l."Party Name" = v_customer_name)
        OR (
          v_use_normalized
          AND public.receivables_party_key(l."Party Name") = public.receivables_party_key(v_customer_name)
        )
      )
    ORDER BY public.receivables_parse_date(l."Date") DESC NULLS LAST, l.id DESC
    LIMIT 1
  ),
  limited AS (
    SELECT *
    FROM ranged
    ORDER BY receipt_date DESC, ledger_id DESC
    LIMIT v_limit
  ),
  receipt_gaps AS (
    SELECT receipt_date - lag(receipt_date) OVER (ORDER BY receipt_date) AS gap_days
    FROM (SELECT DISTINCT receipt_date FROM ranged) receipt_dates
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
    'receipt_count', (SELECT count(*)::INTEGER FROM ranged),
    'total_received', (SELECT coalesce(sum(amount), 0) FROM ranged),
    'average_receipt_gap_days', (
      SELECT round(avg(gap_days)::NUMERIC, 1)
      FROM receipt_gaps
      WHERE gap_days IS NOT NULL
    ),
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
      'match_confidence', v_match_confidence
    )
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
  v_use_normalized BOOLEAN := false;
  v_match_confidence TEXT := 'none';
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

COMMENT ON FUNCTION public.get_customer_payment_signal(BIGINT, INTEGER, INTEGER) IS
  'Bounded receipt cadence signal; date-filtered ledger reads without MATERIALIZED CTEs.';

COMMENT ON FUNCTION public.get_customer_ledger_statement(BIGINT, DATE, DATE, INTEGER) IS
  'Bounded ledger preview; date-filtered reads without MATERIALIZED CTEs.';

-- Not used by the app yet; admin-scale join would scan all customersos rows.
REVOKE EXECUTE ON FUNCTION public.get_sales_receivables_summary() FROM authenticated;
