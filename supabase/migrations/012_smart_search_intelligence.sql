-- Smart search: customer frequency MV, co-occurrence, search telemetry, patterns, reorder predictions.

-- ─── customer_item_frequency (materialized) ───────────────────
DROP MATERIALIZED VIEW IF EXISTS public.customer_item_frequency CASCADE;

CREATE MATERIALIZED VIEW public.customer_item_frequency AS
SELECT
  o.customer_id,
  oi.item_id,
  i.name AS item_name,
  i.main_group,
  COUNT(DISTINCT o.id)::integer AS order_count,
  SUM(oi.qty_requested)::numeric AS total_qty,
  ROUND(AVG(oi.qty_requested::numeric))::integer AS typical_qty,
  MAX(o.created_at) AS last_ordered_at,
  SUM(
    CASE
      WHEN o.created_at > NOW() - INTERVAL '30 days' THEN 3
      WHEN o.created_at > NOW() - INTERVAL '90 days' THEN 2
      ELSE 1
    END
  )::integer AS weighted_score
FROM public.orders o
JOIN public.order_items oi ON oi.order_id = o.id
JOIN public.items i ON i.id = oi.item_id
WHERE o.workflow_status IS DISTINCT FROM 'flagged'
GROUP BY o.customer_id, oi.item_id, i.name, i.main_group;

CREATE UNIQUE INDEX idx_customer_item_frequency_pk
  ON public.customer_item_frequency (customer_id, item_id);
CREATE INDEX idx_customer_item_frequency_customer_score
  ON public.customer_item_frequency (customer_id, weighted_score DESC);

CREATE OR REPLACE FUNCTION public.refresh_customer_frequency()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.customer_item_frequency;
END;
$fn$;

COMMENT ON FUNCTION public.refresh_customer_frequency() IS
  'Refresh customer_item_frequency after new orders; call from app after submit_sales_order success.';

GRANT SELECT ON public.customer_item_frequency TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_customer_frequency() TO anon, authenticated;

-- ─── item_cooccurrence ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.item_cooccurrence (
  item_id_a bigint NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  item_id_b bigint NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  cooccurrence_count integer NOT NULL,
  customer_distinct_count integer NOT NULL DEFAULT 0,
  last_seen_at timestamptz,
  PRIMARY KEY (item_id_a, item_id_b),
  CHECK (item_id_a < item_id_b)
);

CREATE INDEX IF NOT EXISTS idx_item_cooccurrence_a ON public.item_cooccurrence (item_id_a);
CREATE INDEX IF NOT EXISTS idx_item_cooccurrence_b ON public.item_cooccurrence (item_id_b);

CREATE OR REPLACE FUNCTION public.rebuild_item_cooccurrence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  TRUNCATE public.item_cooccurrence;
  INSERT INTO public.item_cooccurrence (
    item_id_a,
    item_id_b,
    cooccurrence_count,
    customer_distinct_count,
    last_seen_at
  )
  SELECT
    p.a,
    p.b,
    COUNT(*)::integer,
    COUNT(DISTINCT p.customer_id)::integer,
    MAX(p.created_at)
  FROM (
    SELECT
      o.customer_id,
      o.created_at,
      LEAST(oi1.item_id, oi2.item_id) AS a,
      GREATEST(oi1.item_id, oi2.item_id) AS b
    FROM public.orders o
    JOIN public.order_items oi1 ON oi1.order_id = o.id
    JOIN public.order_items oi2
      ON oi2.order_id = o.id
      AND oi2.item_id <> oi1.item_id
    WHERE o.workflow_status IS DISTINCT FROM 'flagged'
  ) p
  GROUP BY p.a, p.b
  HAVING COUNT(*) >= 5;
END;
$fn$;

GRANT SELECT ON public.item_cooccurrence TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rebuild_item_cooccurrence() TO anon, authenticated;

-- ─── search_events (batched client inserts) ─────────────────
CREATE TABLE IF NOT EXISTS public.search_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_name text NOT NULL,
  customer_id bigint REFERENCES public.customers(id) ON DELETE SET NULL,
  search_query text NOT NULL DEFAULT '',
  selected_item_id bigint REFERENCES public.items(id) ON DELETE SET NULL,
  result_position integer,
  was_suggestion boolean NOT NULL DEFAULT false,
  time_to_select_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_events_salesperson_created
  ON public.search_events (salesperson_name, created_at DESC);

GRANT SELECT, INSERT ON public.search_events TO anon, authenticated;

-- ─── salesperson_search_patterns (rolled up) ────────────────
CREATE TABLE IF NOT EXISTS public.salesperson_search_patterns (
  salesperson_name text NOT NULL,
  query_normalized text NOT NULL,
  item_id bigint NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  selection_count integer NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  avg_time_to_select_ms integer,
  PRIMARY KEY (salesperson_name, query_normalized, item_id)
);

CREATE INDEX IF NOT EXISTS idx_salesperson_patterns_lookup
  ON public.salesperson_search_patterns (salesperson_name, query_normalized);

CREATE OR REPLACE FUNCTION public.refresh_salesperson_search_patterns()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  TRUNCATE public.salesperson_search_patterns;
  INSERT INTO public.salesperson_search_patterns (
    salesperson_name,
    query_normalized,
    item_id,
    selection_count,
    last_used_at,
    avg_time_to_select_ms
  )
  SELECT
    se.salesperson_name,
    lower(trim(regexp_replace(se.search_query, '\s+', ' ', 'g'))),
    se.selected_item_id,
    COUNT(*)::integer,
    MAX(se.created_at),
    ROUND(AVG(se.time_to_select_ms::numeric) FILTER (WHERE se.time_to_select_ms IS NOT NULL))::integer
  FROM public.search_events se
  WHERE se.selected_item_id IS NOT NULL
    AND length(trim(se.search_query)) > 0
  GROUP BY se.salesperson_name, lower(trim(regexp_replace(se.search_query, '\s+', ' ', 'g'))), se.selected_item_id
  HAVING COUNT(*) >= 3;
END;
$fn$;

GRANT SELECT ON public.salesperson_search_patterns TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_salesperson_search_patterns() TO anon, authenticated;

-- ─── reorder_predictions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reorder_predictions (
  customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  item_id bigint NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  avg_reorder_days numeric NOT NULL,
  std_reorder_days numeric NOT NULL,
  last_ordered_at timestamptz NOT NULL,
  predicted_next_order timestamptz NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  pair_order_count integer NOT NULL,
  PRIMARY KEY (customer_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_reorder_predictions_customer
  ON public.reorder_predictions (customer_id);

CREATE OR REPLACE FUNCTION public.refresh_reorder_predictions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  TRUNCATE public.reorder_predictions;
  INSERT INTO public.reorder_predictions (
    customer_id,
    item_id,
    avg_reorder_days,
    std_reorder_days,
    last_ordered_at,
    predicted_next_order,
    confidence,
    pair_order_count
  )
  WITH ordered AS (
    SELECT
      o.customer_id,
      oi.item_id,
      o.created_at,
      LAG(o.created_at) OVER (PARTITION BY o.customer_id, oi.item_id ORDER BY o.created_at) AS prev_at
    FROM public.orders o
    JOIN public.order_items oi ON oi.order_id = o.id
    WHERE o.workflow_status IS DISTINCT FROM 'flagged'
  ),
  gaps AS (
    SELECT
      customer_id,
      item_id,
      created_at AS last_ordered_at,
      EXTRACT(EPOCH FROM (created_at - prev_at)) / 86400.0 AS gap_days
    FROM ordered
    WHERE prev_at IS NOT NULL
  ),
  stats AS (
    SELECT
      customer_id,
      item_id,
      MAX(last_ordered_at) AS last_ordered_at,
      COUNT(*)::integer AS pair_order_count,
      AVG(gap_days)::numeric AS avg_reorder_days,
      COALESCE(stddev_samp(gap_days), 0)::numeric AS std_reorder_days
    FROM gaps
    GROUP BY customer_id, item_id
    HAVING COUNT(*) >= 5
  )
  SELECT
    s.customer_id,
    s.item_id,
    s.avg_reorder_days,
    s.std_reorder_days,
    s.last_ordered_at,
    (s.last_ordered_at + (s.avg_reorder_days || ' days')::interval) AS predicted_next_order,
    CASE
      WHEN s.std_reorder_days < 7 AND s.pair_order_count >= 10 THEN 'high'
      WHEN s.std_reorder_days < 14 AND s.pair_order_count >= 5 THEN 'medium'
      ELSE 'low'
    END,
    s.pair_order_count
  FROM stats s;
END;
$fn$;

GRANT SELECT ON public.reorder_predictions TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_reorder_predictions() TO anon, authenticated;
