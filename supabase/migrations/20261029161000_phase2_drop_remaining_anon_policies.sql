-- Phase 2a–c: drop remaining legacy/open anon RLS. No grant revokes.
-- Manual apply only (not auto-applied on merge).

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        policyname = 'legacy_anon_all'
        OR policyname LIKE '%_legacy_anon_all'
        OR policyname LIKE '%_anon_all'
      )
      AND policyname <> 'partner_companies_anon_read'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Ensure the previously fully-open tables keep authenticated access.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'item_qr_tier_overrides','receiving_jobs','receiving_job_lines','receiving_scan_events',
    'bin_inventory_layers','bin_layer_pick_events','purchase_orders','purchase_order_lines',
    'supplier_invoices','supplier_invoice_lines'
  ]
  LOOP
    IF to_regclass(format('public.%I', t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS authenticated_all ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY authenticated_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- Visit/workday: authenticated only (drop legacy anon OR).
DROP POLICY IF EXISTS customer_visits_sales ON public.customer_visits;
CREATE POLICY customer_visits_sales ON public.customer_visits FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin' OR salesman_user_id = public.current_user_id())
  WITH CHECK (public.current_user_role() = 'admin' OR salesman_user_id = public.current_user_id());

DROP POLICY IF EXISTS workday_logs_sales ON public.workday_logs;
CREATE POLICY workday_logs_sales ON public.workday_logs FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin' OR salesman_user_id = public.current_user_id())
  WITH CHECK (public.current_user_role() = 'admin' OR salesman_user_id = public.current_user_id());
