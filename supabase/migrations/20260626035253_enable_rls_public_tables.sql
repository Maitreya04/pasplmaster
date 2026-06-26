-- Enable RLS on legacy public tables that are exposed through Supabase's public
-- schema. Existing app flows still support unauthenticated legacy passcode
-- sessions, so keep the current access shape while satisfying the public-schema
-- RLS requirement.

DO $$
DECLARE
  table_name text;
  public_tables text[] := ARRAY[
    '_backup_main_store_before_047',
    'app_config',
    'billing_customer_updates',
    'bin_count_logs',
    'bin_inventory',
    'branches',
    'customer_ocr_shorthand',
    'customer_top_items',
    'customers',
    'customers1',
    'customersos',
    'inventory_sync_runs',
    'item_barcodes',
    'item_cooccurrence',
    'item_pack_definitions',
    'items',
    'ledger',
    'license_plate_batches',
    'license_plates',
    'notification_events',
    'ocr_corrections',
    'ocr_prompt_examples',
    'ocr_scan_sessions',
    'offline_pick_submissions',
    'order_events',
    'order_item_pick_scans',
    'order_items',
    'pending_items',
    'picker_label_mrp',
    'queue_events',
    'reorder_predictions',
    'sales',
    'sales_order_shortages',
    'sales_order_submissions',
    'sales_targets',
    'sales_targets_monthly',
    'salesperson_fy_sales',
    'salesperson_product_group_sales',
    'salesperson_search_patterns',
    'salesperson_top_customers',
    'search_events',
    'stock_locationwise',
    'stock_locationwise1',
    'stock_mrpnwise',
    'stock_mrpwise',
    'stock_reservations',
    'supplier_variances',
    'transports',
    'upload_log',
    'user_admin_events',
    'users'
  ];
BEGIN
  FOREACH table_name IN ARRAY public_tables
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);

    EXECUTE format('DROP POLICY IF EXISTS authenticated_all ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY authenticated_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      table_name
    );

    EXECUTE format('DROP POLICY IF EXISTS legacy_anon_all ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY legacy_anon_all ON public.%I FOR ALL TO anon USING (public.is_legacy_anon_session()) WITH CHECK (public.is_legacy_anon_session())',
      table_name
    );
  END LOOP;
END $$;
