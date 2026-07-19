-- Customer receivables phase 1.
--
-- Design guardrails:
-- - Busy tables remain the only financial source of truth.
-- - This migration does not alter customers, customersos, ledger, or sales.
-- - App UI reads receivables through scoped RPCs, never by scanning raw finance tables.

CREATE TABLE IF NOT EXISTS public.customer_collection_events (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  actor_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'reminder_drafted',
      'statement_previewed',
      'statement_shared',
      'note'
    )
  ),
  channel TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_collection_events_customer_created
  ON public.customer_collection_events(customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_collection_events_actor_created
  ON public.customer_collection_events(actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

ALTER TABLE public.customer_collection_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.customer_collection_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.customer_collection_events_id_seq FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.receivables_party_key(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(regexp_replace(coalesce(btrim(p_value), ''), '[^a-z0-9]+', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.receivables_parse_numeric(p_value TEXT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v TEXT;
BEGIN
  v := regexp_replace(coalesce(btrim(p_value), ''), '[,[:space:]]', '', 'g');
  IF v = '' THEN
    RETURN NULL;
  END IF;

  IF v ~ '^-?([0-9]+(\.[0-9]*)?|\.[0-9]+)$' THEN
    RETURN v::NUMERIC;
  END IF;

  RETURN NULL;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.receivables_parse_date(p_value TEXT)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v TEXT;
BEGIN
  v := NULLIF(btrim(coalesce(p_value, '')), '');
  IF v IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    IF v ~ '^\d{4}-\d{1,2}-\d{1,2}$' THEN
      RETURN v::DATE;
    END IF;

    IF v ~ '^\d{1,2}-\d{1,2}-\d{4}$' THEN
      RETURN to_date(v, 'DD-MM-YYYY');
    END IF;

    IF v ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN
      RETURN to_date(v, 'DD/MM/YYYY');
    END IF;

    RETURN v::DATE;
  EXCEPTION
    WHEN others THEN
      RETURN NULL;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.receivables_parse_timestamptz(p_value TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v TEXT;
BEGIN
  v := NULLIF(btrim(coalesce(p_value, '')), '');
  IF v IS NULL THEN
    RETURN NULL;
  END IF;

  BEGIN
    RETURN v::TIMESTAMPTZ;
  EXCEPTION
    WHEN others THEN
      RETURN public.receivables_parse_date(v)::TIMESTAMPTZ;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.receivables_bucket_for_days(p_days INTEGER)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN coalesce(p_days, 0) <= 30 THEN '0_30'
    WHEN p_days <= 60 THEN '31_60'
    WHEN p_days <= 90 THEN '61_90'
    ELSE '90_plus'
  END;
$$;

CREATE OR REPLACE FUNCTION public.receivables_can_view_customer(p_customer_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT := public.current_user_role();
  v_user_id BIGINT := public.current_user_id();
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN false;
  END IF;

  IF v_role IN ('admin', 'billing') THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.customers c
      WHERE c.id = p_customer_id
    );
  END IF;

  IF v_role <> 'sales' OR v_user_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.customers c
    JOIN public.users u ON u.id = v_user_id
    WHERE c.id = p_customer_id
      AND u.is_active = true
      AND u.role = 'sales'
      AND public.normalize_salesperson_key(c.salesman) = public.normalize_salesperson_key(u.full_name)
  );
END;
$$;

DROP POLICY IF EXISTS customer_collection_events_select ON public.customer_collection_events;

CREATE POLICY customer_collection_events_select
  ON public.customer_collection_events
  FOR SELECT
  TO authenticated
  USING (
    public.current_user_role() IN ('admin', 'billing')
    OR actor_user_id = public.current_user_id()
    OR public.receivables_can_view_customer(customer_id)
  );

GRANT SELECT ON public.customer_collection_events TO authenticated;

CREATE OR REPLACE FUNCTION public.record_customer_collection_event(
  p_customer_id BIGINT,
  p_event_type TEXT,
  p_channel TEXT DEFAULT NULL,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id BIGINT := public.current_user_id();
  v_event_type TEXT := NULLIF(btrim(coalesce(p_event_type, '')), '');
  v_event_id BIGINT;
BEGIN
  IF v_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public.receivables_can_view_customer(p_customer_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF v_event_type NOT IN ('reminder_drafted', 'statement_previewed', 'statement_shared', 'note') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_event_type');
  END IF;

  INSERT INTO public.customer_collection_events (
    customer_id,
    actor_user_id,
    event_type,
    channel,
    payload
  )
  VALUES (
    p_customer_id,
    v_actor_user_id,
    v_event_type,
    NULLIF(btrim(coalesce(p_channel, '')), ''),
    coalesce(p_payload, '{}'::jsonb)
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object('success', true, 'event_id', v_event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_collection_snapshot(p_customer_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer JSONB;
  v_customer_name TEXT;
  v_busy_code_text TEXT;
  v_busy_code BIGINT;
  v_credit_limit NUMERIC;
  v_credit_days INTEGER;
  v_os_payload JSONB;
  v_last_payment JSONB := NULL;
BEGIN
  IF NOT public.receivables_can_view_customer(p_customer_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT to_jsonb(c)
  INTO v_customer
  FROM public.customers c
  WHERE c.id = p_customer_id;

  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'customer_not_found');
  END IF;

  v_customer_name := v_customer->>'name';
  v_busy_code_text := NULLIF(v_customer->>'busy_code', '');
  IF v_busy_code_text IS NOT NULL AND v_busy_code_text ~ '^\d+$' THEN
    v_busy_code := v_busy_code_text::BIGINT;
  END IF;

  v_credit_limit := public.receivables_parse_numeric(v_customer->>'creditlimitamt');
  v_credit_days := public.receivables_parse_numeric(v_customer->>'creditsalesdays')::INTEGER;

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
    EXECUTE $sql$
      WITH raw AS (
        SELECT
          public.receivables_parse_numeric(osj.j->>'amount') AS amount,
          coalesce(public.receivables_parse_numeric(osj.j->>'days')::INTEGER, 0) AS days,
          public.receivables_parse_date(coalesce(osj.j->>'report_dt', osj.j->>'report_date')) AS report_dt,
          public.receivables_parse_timestamptz(osj.j->>'updated_at') AS updated_at,
          coalesce(osj.j->>'vch_bill_no', osj.j->>'bill_no', osj.j->>'ref_no', osj.j->>'refcode') AS bill_no,
          coalesce(osj.j->>'type', osj.j->>'ref_type', osj.j->>'vch_type') AS bill_type,
          public.receivables_parse_date(coalesce(osj.j->>'bill_date', osj.j->>'vch_date', osj.j->>'date', osj.j->>'ref_date')) AS bill_date,
          public.receivables_parse_date(coalesce(osj.j->>'due_date', osj.j->>'duedate')) AS due_date,
          public.receivables_parse_numeric(coalesce(osj.j->>'ref_amount', osj.j->>'bill_amount', osj.j->>'original_amount')) AS ref_amount,
          osj.j->>'refcode' AS refcode
        FROM public.customersos os
        CROSS JOIN LATERAL (SELECT to_jsonb(os) AS j) osj
        WHERE (osj.j->>'party_code') ~ '^\d+$'
          AND (osj.j->>'party_code')::BIGINT = $1
      ),
      agg AS (
        SELECT
          coalesce(sum(amount) FILTER (WHERE amount > 0), 0) AS total_pending,
          abs(coalesce(sum(amount) FILTER (WHERE amount < 0), 0)) AS credit_adjustments,
          coalesce(sum(amount), 0) AS net_outstanding,
          count(*) FILTER (WHERE amount > 0)::INTEGER AS bill_count,
          max(days) FILTER (WHERE amount > 0) AS oldest_days,
          coalesce(max(amount) FILTER (WHERE amount > 0), 0) AS largest_bill_amount,
          CASE WHEN $2::INTEGER IS NULL THEN NULL ELSE
            coalesce(sum(amount) FILTER (WHERE amount > 0 AND days > $2::INTEGER), 0)
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
      FROM agg, top_bills
    $sql$
    INTO v_os_payload
    USING v_busy_code, v_credit_days;
  END IF;

  IF to_regclass('public.ledger') IS NOT NULL THEN
    EXECUTE $sql$
      WITH raw AS (
        SELECT
          public.receivables_parse_numeric(lj.j->>'id') AS ledger_id,
          public.receivables_parse_date(coalesce(lj.j->>'Date', lj.j->>'date', lj.j->>'ledger_date', lj.j->>'Vch Date')) AS ledger_date,
          coalesce(lj.j->>'Vch Type', lj.j->>'vch_type', lj.j->>'Voucher Type', lj.j->>'voucher_type') AS voucher_type,
          coalesce(lj.j->>'Doc No', lj.j->>'doc_no', lj.j->>'Vch No', lj.j->>'voucher_no') AS doc_no,
          public.receivables_parse_numeric(coalesce(lj.j->>'Amount', lj.j->>'amount')) AS amount,
          coalesce(lj.j->>'Narration', lj.j->>'narration') AS narration
        FROM public.ledger l
        CROSS JOIN LATERAL (SELECT to_jsonb(l) AS j) lj
        WHERE public.receivables_party_key(coalesce(lj.j->>'Party Name', lj.j->>'party_name')) = public.receivables_party_key($1)
      ),
      payment_rows AS (
        SELECT *
        FROM raw
        WHERE ledger_date IS NOT NULL
          AND ledger_date <= current_date
          AND (
            lower(coalesce(voucher_type, '')) LIKE '%receipt%'
            OR lower(coalesce(voucher_type, '')) LIKE '%payment%'
            OR lower(coalesce(narration, '')) LIKE '%received%'
          )
        ORDER BY ledger_date DESC, ledger_id DESC NULLS LAST
        LIMIT 1
      )
      SELECT jsonb_build_object(
        'date', ledger_date,
        'amount', amount,
        'voucher_type', voucher_type,
        'doc_no', doc_no,
        'narration', narration
      )
      FROM payment_rows
    $sql$
    INTO v_last_payment
    USING v_customer_name;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'customer', jsonb_build_object(
      'id', p_customer_id,
      'name', v_customer_name,
      'busy_code', v_busy_code,
      'mobile', v_customer->>'mobile',
      'salesman', v_customer->>'salesman',
      'city', coalesce(v_customer->>'city', v_customer->>'station'),
      'gstin', coalesce(v_customer->>'gstin', v_customer->>'gstno'),
      'credit_limit', v_credit_limit,
      'credit_days', v_credit_days
    ),
    'summary', v_os_payload->'summary',
    'buckets', v_os_payload->'buckets',
    'top_bills', v_os_payload->'top_bills',
    'last_payment', v_last_payment,
    'meta', (v_os_payload->'meta') || jsonb_build_object(
      'generated_at', now(),
      'ledger_match_confidence', CASE WHEN to_regclass('public.ledger') IS NULL THEN 'unavailable' ELSE 'name_match' END
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
AS $$
DECLARE
  v_customer JSONB;
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
  IF v_bucket = '0_30' OR v_bucket = '31_60' OR v_bucket = '61_90' OR v_bucket = '90_plus' OR v_bucket = 'all' OR v_bucket = 'credits' THEN
    -- valid
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'invalid_bucket');
  END IF;

  SELECT to_jsonb(c)
  INTO v_customer
  FROM public.customers c
  WHERE c.id = p_customer_id;

  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'customer_not_found');
  END IF;

  IF (v_customer->>'busy_code') ~ '^\d+$' THEN
    v_busy_code := (v_customer->>'busy_code')::BIGINT;
  END IF;

  IF v_busy_code IS NULL OR to_regclass('public.customersos') IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'bucket', v_bucket,
      'total_amount', 0,
      'count', 0,
      'rows', '[]'::jsonb,
      'meta', jsonb_build_object('source_available', false)
    );
  END IF;

  EXECUTE $sql$
    WITH raw AS (
      SELECT
        public.receivables_parse_numeric(osj.j->>'amount') AS amount,
        coalesce(public.receivables_parse_numeric(osj.j->>'days')::INTEGER, 0) AS days,
        public.receivables_parse_date(coalesce(osj.j->>'report_dt', osj.j->>'report_date')) AS report_dt,
        coalesce(osj.j->>'vch_bill_no', osj.j->>'bill_no', osj.j->>'ref_no', osj.j->>'refcode') AS bill_no,
        coalesce(osj.j->>'type', osj.j->>'ref_type', osj.j->>'vch_type') AS bill_type,
        public.receivables_parse_date(coalesce(osj.j->>'bill_date', osj.j->>'vch_date', osj.j->>'date', osj.j->>'ref_date')) AS bill_date,
        public.receivables_parse_date(coalesce(osj.j->>'due_date', osj.j->>'duedate')) AS due_date,
        public.receivables_parse_numeric(coalesce(osj.j->>'ref_amount', osj.j->>'bill_amount', osj.j->>'original_amount')) AS ref_amount,
        osj.j->>'refcode' AS refcode
      FROM public.customersos os
      CROSS JOIN LATERAL (SELECT to_jsonb(os) AS j) osj
      WHERE (osj.j->>'party_code') ~ '^\d+$'
        AND (osj.j->>'party_code')::BIGINT = $1
    ),
    filtered AS (
      SELECT *
      FROM raw
      WHERE CASE $2
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
      'bucket', $2,
      'total_amount', coalesce((SELECT sum(amount) FROM filtered), 0),
      'count', (SELECT count(*) FROM filtered),
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
  $sql$
  INTO v_payload
  USING v_busy_code, v_bucket;

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
AS $$
DECLARE
  v_customer JSONB;
  v_customer_name TEXT;
  v_from DATE;
  v_to DATE;
  v_limit INTEGER;
  v_payload JSONB;
BEGIN
  IF NOT public.receivables_can_view_customer(p_customer_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT to_jsonb(c)
  INTO v_customer
  FROM public.customers c
  WHERE c.id = p_customer_id;

  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'customer_not_found');
  END IF;

  v_customer_name := v_customer->>'name';
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

  EXECUTE $sql$
    WITH raw AS (
      SELECT
        coalesce(public.receivables_parse_numeric(lj.j->>'id')::BIGINT, 0) AS ledger_id,
        public.receivables_parse_date(coalesce(lj.j->>'Date', lj.j->>'date', lj.j->>'ledger_date', lj.j->>'Vch Date')) AS ledger_date,
        coalesce(lj.j->>'Vch Type', lj.j->>'vch_type', lj.j->>'Voucher Type', lj.j->>'voucher_type') AS voucher_type,
        coalesce(lj.j->>'Doc No', lj.j->>'doc_no', lj.j->>'Vch No', lj.j->>'voucher_no') AS doc_no,
        coalesce(lj.j->>'Account Name', lj.j->>'account_name') AS account_name,
        coalesce(lj.j->>'Narration', lj.j->>'narration') AS narration,
        public.receivables_parse_numeric(coalesce(lj.j->>'Amount', lj.j->>'amount')) AS amount
      FROM public.ledger l
      CROSS JOIN LATERAL (SELECT to_jsonb(l) AS j) lj
      WHERE public.receivables_party_key(coalesce(lj.j->>'Party Name', lj.j->>'party_name')) = public.receivables_party_key($1)
    ),
    ranged AS (
      SELECT *
      FROM raw
      WHERE ledger_date BETWEEN $2 AND $3
    ),
    limited AS (
      SELECT *
      FROM ranged
      ORDER BY ledger_date DESC NULLS LAST, ledger_id DESC
      LIMIT $4
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
      'customer_id', $5,
      'from_date', $2,
      'to_date', $3,
      'row_count', (SELECT count(*) FROM ranged),
      'is_truncated', (SELECT count(*) FROM ranged) > $4,
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
  $sql$
  INTO v_payload
  USING v_customer_name, v_from, v_to, v_limit, p_customer_id;

  RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sales_receivables_meta()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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

  EXECUTE $sql$
    WITH actor AS (
      SELECT
        public.current_user_id() AS user_id,
        public.current_user_role() AS role,
        u.full_name
      FROM public.users u
      WHERE u.id = public.current_user_id()
      UNION ALL
      SELECT public.current_user_id(), public.current_user_role(), NULL
      WHERE public.current_user_id() IS NULL
      LIMIT 1
    ),
    scoped_customers AS (
      SELECT
        c.id,
        (to_jsonb(c)->>'busy_code')::BIGINT AS busy_code
      FROM public.customers c
      CROSS JOIN actor a
      WHERE (to_jsonb(c)->>'busy_code') ~ '^\d+$'
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
        public.receivables_parse_numeric(osj.j->>'amount') AS amount,
        public.receivables_parse_date(coalesce(osj.j->>'report_dt', osj.j->>'report_date')) AS report_dt,
        public.receivables_parse_timestamptz(osj.j->>'updated_at') AS updated_at
      FROM scoped_customers sc
      JOIN public.customersos os ON (to_jsonb(os)->>'party_code') ~ '^\d+$'
        AND (to_jsonb(os)->>'party_code')::BIGINT = sc.busy_code
      CROSS JOIN LATERAL (SELECT to_jsonb(os) AS j) osj
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
    FROM agg
  $sql$
  INTO v_payload;

  RETURN v_payload;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sales_receivables_summary()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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

  EXECUTE $sql$
    WITH actor AS (
      SELECT
        public.current_user_id() AS user_id,
        public.current_user_role() AS role,
        u.full_name
      FROM public.users u
      WHERE u.id = public.current_user_id()
      UNION ALL
      SELECT public.current_user_id(), public.current_user_role(), NULL
      WHERE public.current_user_id() IS NULL
      LIMIT 1
    ),
    scoped_customers AS (
      SELECT
        c.id,
        c.name,
        c.mobile,
        c.salesman,
        coalesce(to_jsonb(c)->>'city', to_jsonb(c)->>'station') AS city,
        (to_jsonb(c)->>'busy_code')::BIGINT AS busy_code
      FROM public.customers c
      CROSS JOIN actor a
      WHERE (to_jsonb(c)->>'busy_code') ~ '^\d+$'
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
        public.receivables_parse_numeric(osj.j->>'amount') AS amount,
        coalesce(public.receivables_parse_numeric(osj.j->>'days')::INTEGER, 0) AS days,
        public.receivables_parse_date(coalesce(osj.j->>'report_dt', osj.j->>'report_date')) AS report_dt
      FROM scoped_customers sc
      JOIN public.customersos os ON (to_jsonb(os)->>'party_code') ~ '^\d+$'
        AND (to_jsonb(os)->>'party_code')::BIGINT = sc.busy_code
      CROSS JOIN LATERAL (SELECT to_jsonb(os) AS j) osj
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
    FROM grouped
  $sql$
  INTO v_payload;

  RETURN v_payload;
END;
$$;

COMMENT ON FUNCTION public.get_customer_collection_snapshot(BIGINT) IS
  'Read-only customer collection snapshot from live customersos, with ledger context by name match.';

COMMENT ON FUNCTION public.get_customer_os_bucket(BIGINT, TEXT) IS
  'Read-only outstanding bills for one customer and aging bucket from live customersos.';

COMMENT ON FUNCTION public.get_customer_ledger_statement(BIGINT, DATE, DATE, INTEGER) IS
  'Read-only bounded ledger statement preview for one customer and date range.';

COMMENT ON FUNCTION public.get_sales_receivables_meta() IS
  'Small assigned-customer receivables fingerprint for client cache validation.';

COMMENT ON FUNCTION public.get_sales_receivables_summary() IS
  'Assigned-customer receivables summary from live customersos, reserved for Sales Home/My Beat.';

REVOKE ALL ON FUNCTION public.receivables_party_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.receivables_parse_numeric(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.receivables_parse_date(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.receivables_parse_timestamptz(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.receivables_bucket_for_days(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.receivables_can_view_customer(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_customer_collection_event(BIGINT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_customer_collection_snapshot(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_customer_os_bucket(BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_customer_ledger_statement(BIGINT, DATE, DATE, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_sales_receivables_meta() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_sales_receivables_summary() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_customer_collection_event(BIGINT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receivables_can_view_customer(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_collection_snapshot(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_os_bucket(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_ledger_statement(BIGINT, DATE, DATE, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_receivables_meta() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sales_receivables_summary() TO authenticated;
