-- Receivables ledger fast path.
--
-- Keeps ledger preview read-only and on-demand, but avoids normalized-name
-- matching unless exact customer-name matching finds no rows.

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

  WITH exact_raw AS MATERIALIZED (
    SELECT
      l.id AS ledger_id,
      public.receivables_parse_date(l."Date") AS ledger_date,
      l."VchType" AS voucher_type,
      l."DocNo" AS doc_no,
      l."AccountName" AS account_name,
      l."ShortNar" AS narration,
      public.receivables_parse_numeric(l."Amount") AS amount,
      'exact_name'::TEXT AS match_confidence
    FROM public.ledger l
    WHERE l."Party Name" = v_customer_name
  ),
  exact_count AS MATERIALIZED (
    SELECT count(*) AS rows_found
    FROM exact_raw
  ),
  normalized_raw AS MATERIALIZED (
    SELECT
      l.id AS ledger_id,
      public.receivables_parse_date(l."Date") AS ledger_date,
      l."VchType" AS voucher_type,
      l."DocNo" AS doc_no,
      l."AccountName" AS account_name,
      l."ShortNar" AS narration,
      public.receivables_parse_numeric(l."Amount") AS amount,
      'normalized_name'::TEXT AS match_confidence
    FROM public.ledger l
    WHERE (SELECT rows_found FROM exact_count) = 0
      AND public.receivables_party_key(l."Party Name") = public.receivables_party_key(v_customer_name)
  ),
  raw AS (
    SELECT * FROM exact_raw
    UNION ALL
    SELECT * FROM normalized_raw
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
  ),
  match_meta AS (
    SELECT coalesce(max(match_confidence), 'none') AS match_confidence
    FROM raw
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
    'meta', jsonb_build_object(
      'source_available', true,
      'source', 'ledger',
      'match_confidence', (SELECT match_confidence FROM match_meta)
    )
  )
  INTO v_payload;

  RETURN v_payload;
END;
$$;

COMMENT ON FUNCTION public.get_customer_ledger_statement(BIGINT, DATE, DATE, INTEGER) IS
  'Read-only bounded ledger statement preview; exact name fast path with normalized fallback only when needed.';

REVOKE ALL ON FUNCTION public.get_customer_ledger_statement(BIGINT, DATE, DATE, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_ledger_statement(BIGINT, DATE, DATE, INTEGER) TO authenticated;
