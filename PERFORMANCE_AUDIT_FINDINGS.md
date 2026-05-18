# PERFORMANCE_AUDIT_FINDINGS

## Section 1 — Hot data fetch paths

### Hook fetch/RPC paths

Global React Query defaults are `staleTime = 5m` and `gcTime = 30m` in `src/lib/queryClient.ts:6-7`; table entries below show explicit overrides where present.

| file:line | what it fetches | refetch interval | staleTime | gcTime | mounted where |
|---|---|---:|---:|---:|---|
| `src/hooks/useCustomers.ts:8`, `src/hooks/useCustomers.ts:20` | `customers` active count, then `customers.select('*')` in 1,000-row batches via `Promise.all` | none | 30m | 30m default | `src/pages/sales/CartPage.tsx:89`, `src/pages/sales/NewOrderPage.tsx:284` |
| `src/hooks/useBillingCustomerUpdate.ts:18` | latest `billing_customer_updates.select('*')` by `order_id` | none | 0 | 30m default | `src/pages/sales/MyOrdersPage.tsx:404` |
| `src/hooks/useTransports.ts:9` | active `transports.select('*')` | none | 60m | 30m default | `src/pages/sales/CartPage.tsx:864` |
| `src/hooks/useSalesPendingRecovery.ts:289`, `src/hooks/useSalesPendingRecovery.ts:327`, `src/hooks/useSalesPendingRecovery.ts:333`, `src/hooks/useSalesPendingRecovery.ts:340`, `src/hooks/useSalesPendingRecovery.ts:347`, `src/hooks/useSalesPendingRecovery.ts:363` | `pending_items.select('*')` for all unresolved pending rows, then batched `orders`, `customers`, `items`, `order_items`, and `stock_locationwise` | 30s | 0 | 30m default | `src/pages/sales/PendingRecoveryPage.tsx:516`, `src/pages/sales/SalesHome.tsx:233` |
| `src/hooks/useOpenPoDemandLines.ts:56` | `order_items` open PO demand with embedded `orders` and `items` | none | 15s | 30m default | `src/pages/admin/SupplyDemandPage.tsx:277`, `src/pages/admin/SupplyDemandSkuDetailPage.tsx:109` |
| `src/hooks/usePendingItems.ts:25` | `pending_items.select('*')`, optionally filtered by status/order/customer/recovery status | 30s | 0 | 30m default | `src/pages/billing/PendingPage.tsx:88`, `src/pages/sales/NewOrderPage.tsx:418`, `src/pages/admin/SupplyDemandPage.tsx:278`, `src/pages/sales/MyOrdersPage.tsx:408` |
| `src/hooks/useUserNotifications.ts:26` | latest 50 `user_notifications` for a user; also updates read state at `src/hooks/useUserNotifications.ts:95` and `src/hooks/useUserNotifications.ts:114` | ⚠️ 10s fallback poll if Realtime is disabled or gives up | n/a | n/a | `src/components/notifications/NotificationBell.tsx:152`, `src/pages/sales/MyOrdersPage.tsx:804`; `NotificationBell` is mounted in Sales/Billing layouts |
| `src/hooks/useRolePushNotifications.ts:64`, `src/hooks/useRolePushNotifications.ts:250`, `src/hooks/useRolePushNotifications.ts:258` | writes/upserts `push_subscriptions`; not a data fetch | visibility-triggered write, no interval | n/a | n/a | `src/pages/sales/SalesLayout.tsx:51`, `src/pages/billing/BillingLayout.tsx:57`, `src/pages/billing/CompactQueuePage.tsx:570`, `src/pages/picking/QueuePage.tsx:85` via alias |
| `src/hooks/useTeamUsers.ts:13` | active `users.select('*')`, optionally role-filtered | none | 5m | 30m default | `src/pages/RoleSelectPage.tsx:49-51`, `src/components/shared/SalespersonSelectorSheet.tsx:30` |
| `src/hooks/useOrders.ts:103` | `orders` list with `ORDERS_SELECT_WITH_ITEM_LINE_COUNT`, optional status/salesperson/date/limit filters | ⚠️ 60s with Realtime; ⚠️ 2s when Realtime disabled | 0 | 30m default | `src/pages/billing/DashboardPage.tsx:209` via overdue, `src/pages/billing/HistoryPage.tsx:82`, `src/pages/sales/MyOrdersPage.tsx:798` |
| `src/hooks/useItems.ts:171`, `src/hooks/useItems.ts:204` | active `items` catalog: paginated full snapshot when no IndexedDB watermark, then `updated_at,id` cursor deltas | 30s | 30s | 30m default | `src/pages/sales/NewOrderPage.tsx:1722`, admin pages `BarcodeMappingPage`, `CycleCountPage`, `LabelStudioPage`, `OcrOrderLabPage`, `PickScanLabPage`; prefetched by Sales/Billing new-order layouts |
| `src/hooks/useLocationwiseStock.ts:39` | `stock_locationwise` for visible busy codes | 30s | 0 | 30m default | `src/pages/sales/NewOrderPage.tsx:1914` |
| `src/hooks/useSalesDashboard.ts:62`, `src/hooks/useSalesDashboard.ts:75`, `src/hooks/useSalesDashboard.ts:113`, `src/hooks/useSalesDashboard.ts:126`, `src/hooks/useSalesDashboard.ts:136`, `src/hooks/useSalesDashboard.ts:161`, `src/hooks/useSalesDashboard.ts:175` | sales dashboard: `sales_targets`, `salesperson_product_group_sales`, `salesperson_fy_sales`, and `orders` recent/month queries | none | 60s | 30m default | `src/pages/sales/SalesHome.tsx:232` |
| `src/hooks/useClaimableOrders.ts:135`, `src/hooks/useClaimableOrders.ts:169`, `src/hooks/useClaimableOrders.ts:181` | legacy queue path: `orders`, customer addresses, active `work_claims` | ⚠️ 5s with Realtime; ⚠️ 2s when Realtime disabled | 0 | 30m default | `src/pages/billing/DashboardPage.tsx:204`, `NeedsReviewPage.tsx:78`, `CompactQueuePage.tsx:573`, `LiveQueuePage.tsx:102`, `src/pages/picking/QueuePage.tsx:81` |
| `src/hooks/useClaimableOrders.ts:224` | event-stream queue path: `get_billing_queue_snapshot` RPC | ⚠️ 5s with Realtime | 0 | 30m default | same `useClaimableOrders` mounts; enabled only when `VITE_BILLING_QUEUE_EVENTS=true` |
| `src/hooks/useOrderDetail.ts:55`, `src/hooks/useOrderDetail.ts:63`, `src/hooks/useOrderDetail.ts:92` | `orders.select('*')`, `order_items` with embedded `items`, then customer contact fields | ⚠️ 60s with Realtime; ⚠️ 2s when Realtime disabled | 0 | 30m default | `ReviewPage`, `CompactQueuePage`, `LiveQueuePage`, `PickPage`, `PickPreviewPage`, `MyOrdersPage` |
| `src/hooks/useWorkClaim.ts:78`, `src/hooks/useWorkClaim.ts:134`, `src/hooks/useWorkClaim.ts:172`, `src/hooks/useWorkClaim.ts:191` | RPCs `heartbeat_claim`, `claim_order`, `release_claim` | ⚠️ heartbeat every 25s while claimed | n/a | n/a | `ReviewPage`, `CompactQueuePage`, `LiveQueuePage`, `PickPage` |

`src/hooks/usePickerPushNotifications.ts` is only an alias of `useRolePushNotifications`.

### Realtime subscriptions

No direct `.channel(...)` calls exist in `src/pages/**` or `src/components/**`; subscriptions are centralized in `src/lib/realtime.ts:136`. No `setInterval` polling was found directly in `src/pages/**` or `src/components/**`; page/component `setTimeout` usage is UI delay, debounce, scanner retry, or animation cleanup.

| file:line | table | server-side filter | events | where subscribed | flags |
|---|---|---|---|---|---|
| `src/hooks/useUserNotifications.ts:63` | `user_notifications` | `user_id=eq.${userId}` | `*` | Notification bell and My Orders notification reads | filtered |
| `src/hooks/useOrders.ts:164` | `orders` | only `workflow_status=eq.<status>` when `status` is set and not overdue; otherwise none | `*` | History, My Orders, overdue dashboard | ⚠️ high-write table; ⚠️ no server-side filter for overdue, all-history, and salesperson-only lists; ⚠️ overlaps 60s keep-alive polling |
| `src/hooks/useClaimableOrders.ts:354` | `queue_events` | `stage=eq.billing` | `INSERT` | billing queue when `VITE_BILLING_QUEUE_EVENTS=true` | filtered but high-churn event stream |
| `src/hooks/useClaimableOrders.ts:369` | `orders` | `workflow_status=eq.<status>` only for string status; none for dashboard/today-only | `*` | billing event-mode backstop | ⚠️ high-write table; ⚠️ no filter for today-only dashboard |
| `src/hooks/useClaimableOrders.ts:390` | `orders` | `workflow_status=eq.<status>` only for string status; none for arrays | `*` | legacy billing/picking queues | ⚠️ high-write table; ⚠️ no filter for picking array status `['approved','picking']`; ⚠️ overlaps 5s/2s polling |
| `src/hooks/useClaimableOrders.ts:399` | `work_claims` | `stage=eq.${stage}` | `*` | legacy queue path | ⚠️ high-write heartbeat table; net publication later drops `work_claims`, so this subscription is ineffective after migration 035 |
| `src/hooks/useOrderDetail.ts:134` | `orders` | `id=eq.${orderId}` | `*` | active order detail screens | filtered; ⚠️ overlaps 60s/2s polling |
| `src/hooks/useOrderDetail.ts:143` | `order_items` | `order_id=eq.${orderId}` | `*` | active order detail screens | filtered; ⚠️ high-write table during billing/picking |

## Section 2 — RPC call inventory

| RPC name | callsite file:line | trigger | migration files defining it |
|---|---|---|---|
| `complete_billing` | `src/pages/billing/ReviewPage.tsx:506` | billing approve/resolve mutation, user action | `supabase/migrations/005_work_claims_system.sql:325` |
| `complete_picking` | `src/pages/picking/PickPage.tsx:808` | complete pick mutation, user action | `supabase/migrations/005_work_claims_system.sql:391` |
| `claim_order` | `src/pages/picking/QueuePage.tsx:106` | picking queue claim mutation, user action | `supabase/migrations/005_work_claims_system.sql:118` |
| `get_salesperson_top_customers_live` | `src/pages/sales/NewOrderPage.tsx:302` | React Query on New Order mount when `userName` exists | `supabase/migrations/016_live_top_customers_and_trending.sql:3` |
| `get_trending_items_live` | `src/pages/sales/NewOrderPage.tsx:315` | React Query on New Order mount | `supabase/migrations/016_live_top_customers_and_trending.sql:33` |
| `get_customer_quick_reorder_stats` | `src/pages/sales/NewOrderPage.tsx:351` | React Query after active customer selection | `supabase/migrations/015_customer_quick_reorder_live.sql:3` |
| `submit_sales_order` | `src/pages/sales/CartPage.tsx:989` | cart submit mutation, user action | ⚠️ `supabase/migrations/011_submit_sales_order_rpc.sql:4`, `012_orders_item_count_line_count.sql:4`, `018_order_salesperson_user_id.sql:50` |
| `process_pending_recovery_action` | `src/pages/sales/MyOrdersPage.tsx:424` | pending recovery action mutation, user action | `supabase/migrations/017_pending_recovery_back_in_stock.sql:293` |
| `create_pending_recovery_order` | `src/pages/sales/PendingRecoveryPage.tsx:685` | create recovery order mutation, user action | `supabase/migrations/020_party_pending_recovery_orders.sql:66` |
| `save_barcode_mapping` | `src/lib/barcodeMapping.ts:192` | Barcode Mapping page save mutation, user scan/action | ⚠️ `supabase/migrations/029_item_barcodes.sql:29`, `030_update_match_strategy.sql:11`, `031_prevent_duplicate_sku_barcode_mapping.sql:4`, `032_allow_multiple_barcodes_per_sku.sql:10` |
| `get_barcode_coverage` | `src/lib/barcodeMapping.ts:209` | Barcode Mapping page query | `supabase/migrations/029_item_barcodes.sql:161` |
| `get_barcode_rack_coverage` | `src/lib/barcodeMapping.ts:215` | Barcode Mapping page query | `supabase/migrations/033_barcode_rack_coverage.sql:25` |
| `get_billing_queue_snapshot` | `src/hooks/useClaimableOrders.ts:224` | queue React Query on mount, 5s keep-alive, and Realtime invalidation | `supabase/migrations/035_billing_queue_events_and_snapshot.sql:157` |
| `heartbeat_claim` | `src/hooks/useWorkClaim.ts:78` | 25s interval while a user holds a claim | `supabase/migrations/005_work_claims_system.sql:245` |
| `claim_order` | `src/hooks/useWorkClaim.ts:134` | claim callback used by billing/picking detail flows, user action or retry | `supabase/migrations/005_work_claims_system.sql:118` |
| `release_claim` | `src/hooks/useWorkClaim.ts:172` | explicit release callback | `supabase/migrations/005_work_claims_system.sql:270` |
| `release_claim` | `src/hooks/useWorkClaim.ts:191` | fire-and-forget release on unmount | `supabase/migrations/005_work_claims_system.sql:270` |
| `complete_billing` | `src/lib/billing/completeBilling.ts:43` | helper used by `LiveQueuePage` and `CompactQueuePage` approve mutations | `supabase/migrations/005_work_claims_system.sql:325` |
| `submit_bin_count` | `src/lib/wms.ts:65` | Cycle Count submit mutation, user action | `supabase/migrations/027_wms_bin_inventory_cycle_count.sql:145` |
| `review_bin_count` | `src/lib/wms.ts:96` | Cycle Count review mutation, user action | `supabase/migrations/027_wms_bin_inventory_cycle_count.sql:301` |
| `bulk_import_bin_inventory` | `src/lib/wms.ts:119` | Cycle Count bulk import mutation, user action | `supabase/migrations/027_wms_bin_inventory_cycle_count.sql:384` |
| `seed_bin_inventory_from_items` | `src/lib/wms.ts:139` | Cycle Count seed mutation, user action | `supabase/migrations/027_wms_bin_inventory_cycle_count.sql:517` |
| `create_license_plate_batch` | `src/lib/packLpn.ts:46` | pack/LPN helper; no current page callsite found | `supabase/migrations/025_pack_lpn_backend.sql:357` |
| `upsert_item_pack_definitions` | `src/lib/import/packDefinitionsImporter.ts:219` | Upload page pack-definition import | `supabase/migrations/025_pack_lpn_backend.sql:253` |

RPC/function names with multiple `CREATE OR REPLACE` occurrences:

| function | occurrences |
|---|---|
| ⚠️ `submit_sales_order` | `supabase/migrations/011_submit_sales_order_rpc.sql:4`, `supabase/migrations/012_orders_item_count_line_count.sql:4`, `supabase/migrations/018_order_salesperson_user_id.sql:50` |
| ⚠️ `save_barcode_mapping` | `supabase/migrations/029_item_barcodes.sql:29`, `030_update_match_strategy.sql:11`, `031_prevent_duplicate_sku_barcode_mapping.sql:4`, `032_allow_multiple_barcodes_per_sku.sql:10` |
| ⚠️ `refresh_salesperson_search_patterns` | `supabase/migrations/012_smart_search_intelligence.sql:139`, `013_fix_refresh_salesperson_search_patterns.sql:3` |
| ⚠️ `recompute_pending_recovery_status` | `supabase/migrations/017_pending_recovery_back_in_stock.sql:175`, `019_fix_pending_recovery_outer_join_lock.sql:5` |

## Section 3 — Trigger, function, and MV overhead

### Triggers

| trigger | table | timing/event | granularity | function body summary | flags |
|---|---|---|---|---|---|
| `trg_order_number` | `orders` | `BEFORE INSERT` when `NEW.order_number IS NULL` | `FOR EACH ROW` | `generate_order_number()` scans max same-day order suffix and assigns `PA-YYMMDD-XXXX` | could contend on concurrent order inserts |
| `trg_push_subscriptions_updated_at` | `push_subscriptions` | `BEFORE UPDATE` | `FOR EACH ROW` | sets `NEW.updated_at = now()` | no major compute issue |
| `trg_pending_items_seed_recovery` | `pending_items` | `AFTER INSERT OR UPDATE OF item_id, qty_pending, status` | `FOR EACH ROW` | calls `recompute_pending_recovery_status(NEW.id, false)` | can update `pending_items` again during pending-row churn |
| `trg_items_refresh_pending_recovery` | `items` | `AFTER UPDATE OF stock_qty` | `FOR EACH ROW` | when stock changes, loops matching pending rows and calls `recompute_pending_recovery_status(..., true)`, which may update `pending_items` and insert `user_notifications` | ⚠️ fires per `items` row changed by `apply_erp_items_delta`; bulk stock deltas can fan out into pending-item locks and notifications |
| `trg_items_set_updated_at` | `items` | `BEFORE UPDATE` | `FOR EACH ROW` | sets `NEW.updated_at = now()` for all item updates | ⚠️ fires per `items` row changed by `apply_erp_items_delta`; also drives 30s client delta polls |
| `trg_bin_inventory_updated_at` | `bin_inventory` | `BEFORE UPDATE` | `FOR EACH ROW` | sets `NEW.updated_at = now()` | bulk WMS imports pay one trigger call per updated bin row |
| `trg_orders_emit_queue_event_insert` | `orders` | `AFTER INSERT` | `FOR EACH ROW` | for newly submitted orders, calls `emit_queue_event('billing','order_submitted',...)` | ⚠️ writes `queue_events` on order creation |
| `trg_order_events_emit_queue_event` | `order_events` | `AFTER INSERT` | `FOR EACH ROW` | maps billing claim/release/approval/flag events into `queue_events`; `billing_approved` also emits a picking-ready event | ⚠️ every relevant `order_events` insert creates more writes to `queue_events` |

### Function/MV overhead notes

| object | location | overhead |
|---|---|---|
| `public.apply_erp_items_delta` | `supabase/migrations/036_erp_items_delta_rpc.sql:47` | service-role RPC stages JSON rows, updates `items` when stock/price/MRP differ, and inserts one `inventory_sync_runs` row; ⚠️ every changed `items` row fires both `trg_items_set_updated_at` and, for stock changes, `trg_items_refresh_pending_recovery` |
| `public.get_billing_queue_snapshot` | `supabase/migrations/035_billing_queue_events_and_snapshot.sql:157` | used by a 5s queue poll; its `line_summary` CTE groups all `order_items` by `order_id` before the outer `orders` filters, making it a likely CPU hotspot |
| `public.emit_queue_event` | `supabase/migrations/035_billing_queue_events_and_snapshot.sql:28` | inserts into `queue_events`; reached directly by queue triggers |
| `claim_order`, `release_claim`, `complete_billing`, `complete_picking`, `expire_stale_claims` | `supabase/migrations/005_work_claims_system.sql` | write `order_events`; migration 035 then turns selected `order_events` rows into `queue_events` rows |
| `public.refresh_customer_frequency` | `supabase/migrations/012_smart_search_intelligence.sql:34` | runs `REFRESH MATERIALIZED VIEW CONCURRENTLY public.customer_item_frequency`; no source callsite found in `src/` |
| `public.rebuild_item_cooccurrence` | `supabase/migrations/012_smart_search_intelligence.sql:65` | truncates and rebuilds co-occurrence via a self-join over `order_items`; no source callsite found in `src/` |

### Materialized views

| materialized view | location | summary | refresh path |
|---|---|---|---|
| `public.customer_item_frequency` | `supabase/migrations/012_smart_search_intelligence.sql:6` | aggregates `orders`, `order_items`, and `items` by customer/item | `refresh_customer_frequency()` at `supabase/migrations/012_smart_search_intelligence.sql:34`; no trigger-based refresh found |

## Section 4 — Realtime publication audit

### Net publication set

| table | migration events | net state |
|---|---|---|
| `work_claims` | ADD `005_work_claims_system.sql:106`; ADD `026_items_realtime_and_updated_at_trigger.sql:56`; DROP `035_billing_queue_events_and_snapshot.sql:310` | not published |
| `order_events` | ADD `005_work_claims_system.sql:107`; DROP `035_billing_queue_events_and_snapshot.sql:324` | not published |
| `orders` | ADD `007_enable_realtime_for_orders.sql:14` | published |
| `user_notifications` | ADD `014_user_notifications.sql:57` | published |
| `order_items` | ADD `014_user_notifications.sql:68` | published |
| `pending_items` | ADD `017_pending_recovery_back_in_stock.sql:470`; DROP `035_billing_queue_events_and_snapshot.sql:331` | not published |
| `items` | ADD `026_items_realtime_and_updated_at_trigger.sql:42`; DROP `034_remove_items_from_realtime.sql:17`; DROP `035_billing_queue_events_and_snapshot.sql:317` | not published |
| `queue_events` | ADD `035_billing_queue_events_and_snapshot.sql:303` | published |

Net published tables: `orders`, `user_notifications`, `order_items`, `queue_events`.

### Cross-reference with subscriptions

| published/subscribed table | code subscribers | finding |
|---|---|---|
| `orders` | `useOrders`, `useClaimableOrders`, `useOrderDetail` | ⚠️ high-churn table; several subscriptions omit server filters (`useOrders` all/overdue/salesperson-only, `useClaimableOrders` today-only and array status) |
| `user_notifications` | `useUserNotifications` | filtered by `user_id`; reasonable |
| `order_items` | `useOrderDetail` | ⚠️ high-write table during billing/picking, but row-filtered by `order_id` |
| `queue_events` | `useClaimableOrders` only when `VITE_BILLING_QUEUE_EVENTS=true` | filtered by `stage=eq.billing`; if the env flag is off, this is published but unused |
| `work_claims` | `useClaimableOrders` legacy path | ⚠️ subscribed in code but no longer published after migration 035; also high-write because `heartbeat_claim` updates every 25s |

Tables published but never subscribed: No unconditional waste in the current code path; `queue_events` is waste if `VITE_BILLING_QUEUE_EVENTS` is not enabled.

Subscriptions without server-side filters: ⚠️ `orders` in `useOrders` for all-history, overdue, and salesperson-only lists; ⚠️ `orders` in `useClaimableOrders` for today-only dashboard and array workflow statuses.

## Section 5 — Code-side smells

### Components > 400 lines in `src/pages/`

| file | lines |
|---|---:|
| `src/pages/sales/NewOrderPage.tsx` | 2298 |
| `src/pages/picking/PickPage.tsx` | 2240 |
| `src/pages/admin/LabelStudioPage.tsx` | 1613 |
| `src/pages/sales/CartPage.tsx` | 1586 |
| `src/pages/admin/CycleCountPage.tsx` | 1312 |
| `src/pages/admin/BarcodeMappingPage.tsx` | 1274 |
| `src/pages/sales/PendingRecoveryPage.tsx` | 1271 |
| `src/pages/admin/SupplyDemandPage.tsx` | 1169 |
| `src/pages/billing/ReviewPage.tsx` | 1098 |
| `src/pages/sales/MyOrdersPage.tsx` | 888 |
| `src/pages/billing/CompactQueuePage.tsx` | 860 |
| `src/pages/admin/PickScanLabPage.tsx` | 750 |
| `src/pages/billing/LiveQueue/OrderSheetView.tsx` | 725 |
| `src/pages/billing/LiveQueuePage.tsx` | 615 |
| `src/pages/picking/QueuePage.tsx` | 613 |
| `src/pages/billing/LiveQueue/ProcessView.tsx` | 427 |

### `Promise.all` over arrays that look like N+1 or burst patterns

| file:line | pattern | finding |
|---|---|---|
| `src/hooks/useCustomers.ts:17-27` | builds one request per 1,000-customer page and fires all pages in parallel | bursty full-table fetch; not per-row N+1, but scales with customer count and active sales clients |
| `src/lib/billing/liveQueueDraft.ts:81` | `updates.map(... order_items.update(...).eq('id', ...))` | ⚠️ one REST update per changed order line |
| `src/pages/billing/LiveQueuePage.tsx:307` | `lineResults.map(... order_items.update(...).eq('id', ...))` | ⚠️ one REST update per order line during approval; should be a bulk RPC or single set-based update |
| `src/lib/ocr/matcher.ts:163` | parallel full active-items pages for OCR matcher | bursty full-table item fetch path outside the cached `useItems` path |
| `src/pages/sales/MyOrdersPage.tsx:844` | `Promise.allSettled(toRead.map(markRead))` | multiple notification update calls when opening an order with several unread notifications |

### `.select('*')` on broad tables

| file:line | table | finding |
|---|---|---|
| `src/hooks/useCustomers.ts:21` | `customers` | full active customer rows fetched in batches |
| `src/hooks/usePendingItems.ts:25` | `pending_items` | full pending row payload, polled every 30s |
| `src/hooks/useSalesPendingRecovery.ts:291` | `pending_items` | full pending row payload, polled every 30s, then client-side salesperson filtering |
| `src/hooks/useOrderDetail.ts:57` | `orders` | full order row on every detail refetch |
| `src/hooks/useOrderDetail.ts:63-75` | `order_items` | embedded select includes `*` for order lines |
| `src/pages/billing/ReviewPage.tsx:370` | `pending_items` | full pending rows during approval flow |
| `src/hooks/useTeamUsers.ts:15` | `users` | full user rows for role/name pickers |
| `src/hooks/useBillingCustomerUpdate.ts:20` | `billing_customer_updates` | full update row though only preview fields may be needed |
| `src/lib/wms.ts:46`, `src/lib/wms.ts:56` | `bin_inventory`, `bin_count_logs` | full WMS rows for admin cycle-count screens |
| `src/lib/packLpn.ts:30` | `item_pack_definitions` | full pack definition rows |

### Fetches on mount of `App.tsx` or top-level layouts

| file:line | behavior | finding |
|---|---|---|
| `src/App.tsx` | lazy routes only | No Supabase fetch in `App.tsx` itself |
| `src/context/AuthContext.tsx:116` | on provider mount, backfills `userId` from `users` when role/name exist but id is missing | conditional top-level fetch |
| `src/pages/sales/SalesLayout.tsx:46` | calls `prefetchItems()` on Sales layout mount | ⚠️ can trigger `items` snapshot/delta before user opens New Order |
| `src/pages/billing/BillingNewOrderLayout.tsx:27` | calls `prefetchItems()` on Billing new-order layout mount | expected, but can duplicate Sales path if caches are cold |
| `src/pages/sales/SalesLayout.tsx:51`, `src/pages/billing/BillingLayout.tsx:57` | `useRolePushNotifications` syncs `push_subscriptions` | top-level write/upsert path |
| `src/pages/sales/SalesLayout.tsx:83`, `src/pages/billing/BillingLayout.tsx:69`, `src/pages/billing/BillingLayout.tsx:96` | `NotificationBell` mounts `useUserNotifications` | top-level notifications fetch/subscription on every Sales/Billing page |

### Whole `items` fetches without pagination

| file:line | query | finding |
|---|---|---|
| `src/lib/import/stockImporter.ts:119-122` | `items.select('name,alias,alias1,parent_group,item_category,gst_percent,hsn_code,stock_qty,rack_no,is_active')` | ⚠️ whole `items` table without pagination before stock import |
| `src/lib/import/itemImporter.ts:148-151` | `items.select('name,alias,alias1,parent_group,gst_percent,hsn_code,sales_price,mrp,item_category,main_group,is_active')` | ⚠️ whole `items` table without pagination before item/price import |

Paginated `items` fetches exist in `useItems`, `packDefinitionsImporter`, and OCR matcher; those are not whole-table unpaginated reads.

## Section 6 — Diagnostic SQL

```sql
-- RUN IN SUPABASE SQL EDITOR --

-- === QUERY 1: pg_stat_statements extension check ===
SELECT
  e.extname,
  n.nspname AS extension_schema,
  e.extversion
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'pg_stat_statements';

-- === QUERY 2: Top 30 queries by total_exec_time ===
WITH total AS (
  SELECT SUM(total_exec_time) AS total_ms
  FROM pg_stat_statements
)
SELECT
  s.calls,
  ROUND(s.total_exec_time::numeric, 2) AS total_ms,
  ROUND(s.mean_exec_time::numeric, 2) AS mean_ms,
  ROUND((100 * s.total_exec_time / NULLIF(total.total_ms, 0))::numeric, 2) AS pct_of_total,
  s.rows,
  LEFT(REGEXP_REPLACE(s.query, '[[:space:]]+', ' ', 'g'), 800) AS query
FROM pg_stat_statements s
CROSS JOIN total
ORDER BY s.total_exec_time DESC
LIMIT 30;

-- === QUERY 3: Top 20 queries by calls ===
SELECT
  calls,
  ROUND(total_exec_time::numeric, 2) AS total_ms,
  ROUND(mean_exec_time::numeric, 2) AS mean_ms,
  rows,
  LEFT(REGEXP_REPLACE(query, '[[:space:]]+', ' ', 'g'), 800) AS query
FROM pg_stat_statements
ORDER BY calls DESC
LIMIT 20;

-- === QUERY 4: Top 20 queries by mean_exec_time WHERE calls > 5 ===
SELECT
  calls,
  ROUND(total_exec_time::numeric, 2) AS total_ms,
  ROUND(mean_exec_time::numeric, 2) AS mean_ms,
  rows,
  LEFT(REGEXP_REPLACE(query, '[[:space:]]+', ' ', 'g'), 800) AS query
FROM pg_stat_statements
WHERE calls > 5
ORDER BY mean_exec_time DESC
LIMIT 20;

-- === QUERY 5: Heap and index cache hit ratios ===
WITH heap AS (
  SELECT
    SUM(heap_blks_read) AS read_blks,
    SUM(heap_blks_hit) AS hit_blks
  FROM pg_statio_user_tables
),
idx AS (
  SELECT
    SUM(idx_blks_read) AS read_blks,
    SUM(idx_blks_hit) AS hit_blks
  FROM pg_statio_user_indexes
)
SELECT
  'heap' AS cache,
  read_blks,
  hit_blks,
  ROUND((100 * hit_blks / NULLIF(hit_blks + read_blks, 0))::numeric, 2) AS hit_ratio_pct
FROM heap
UNION ALL
SELECT
  'index' AS cache,
  read_blks,
  hit_blks,
  ROUND((100 * hit_blks / NULLIF(hit_blks + read_blks, 0))::numeric, 2) AS hit_ratio_pct
FROM idx;

-- === QUERY 6: Top 30 tables by total size with tuple stats ===
SELECT
  schemaname,
  relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_total_relation_size(relid) AS total_bytes,
  n_live_tup,
  n_dead_tup,
  last_autovacuum,
  last_analyze
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 30;

-- === QUERY 7: All indexes ordered by idx_scan ASC ===
SELECT
  s.schemaname,
  s.relname AS table_name,
  s.indexrelname AS index_name,
  s.idx_scan,
  s.idx_tup_read,
  s.idx_tup_fetch,
  pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
  pg_get_indexdef(s.indexrelid) AS index_def
FROM pg_stat_user_indexes s
ORDER BY s.idx_scan ASC, pg_relation_size(s.indexrelid) DESC;

-- === QUERY 8: Unused public indexes with size ===
SELECT
  s.schemaname,
  s.relname AS table_name,
  s.indexrelname AS index_name,
  i.indisprimary,
  i.indisunique,
  pg_size_pretty(pg_relation_size(s.indexrelid)) AS index_size,
  pg_relation_size(s.indexrelid) AS index_bytes,
  pg_get_indexdef(s.indexrelid) AS index_def
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.schemaname = 'public'
  AND s.idx_scan = 0
ORDER BY pg_relation_size(s.indexrelid) DESC;

-- === QUERY 9: Active non-idle queries with wait events ===
SELECT
  pid,
  usename,
  application_name,
  client_addr,
  state,
  wait_event_type,
  wait_event,
  now() - query_start AS query_age,
  LEFT(REGEXP_REPLACE(query, '[[:space:]]+', ' ', 'g'), 800) AS query
FROM pg_stat_activity
WHERE state <> 'idle'
  AND pid <> pg_backend_pid()
ORDER BY query_start NULLS LAST;

-- === QUERY 10: Connection count by state ===
SELECT
  COALESCE(state, 'unknown') AS state,
  COUNT(*) AS connection_count
FROM pg_stat_activity
GROUP BY COALESCE(state, 'unknown')
ORDER BY connection_count DESC;

-- === QUERY 11: Tables currently in supabase_realtime publication ===
SELECT
  schemaname,
  tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY schemaname, tablename;

-- === QUERY 12: Trigger count per table ===
SELECT
  event_object_schema AS table_schema,
  event_object_table AS table_name,
  COUNT(*) AS trigger_count,
  STRING_AGG(DISTINCT trigger_name, ', ' ORDER BY trigger_name) AS trigger_names
FROM information_schema.triggers
WHERE event_object_schema NOT IN ('pg_catalog', 'information_schema')
GROUP BY event_object_schema, event_object_table
ORDER BY trigger_count DESC, table_schema, table_name;

-- === QUERY 13: Materialized view list with sizes ===
SELECT
  schemaname,
  matviewname,
  pg_size_pretty(pg_total_relation_size((schemaname || '.' || matviewname)::regclass)) AS total_size,
  pg_total_relation_size((schemaname || '.' || matviewname)::regclass) AS total_bytes,
  ispopulated
FROM pg_matviews
ORDER BY pg_total_relation_size((schemaname || '.' || matviewname)::regclass) DESC;

-- === QUERY 14: Top 10 tables by estimated bloat ===
WITH constants AS (
  SELECT
    current_setting('block_size')::numeric AS bs,
    23::numeric AS hdr,
    CASE WHEN version() ~ '64-bit' THEN 8::numeric ELSE 4::numeric END AS ma
),
table_stats AS (
  SELECT
    schemaname,
    relname AS tablename,
    relid,
    n_live_tup::numeric AS est_rows,
    pg_table_size(relid)::numeric AS table_bytes
  FROM pg_stat_user_tables
),
column_stats AS (
  SELECT
    schemaname,
    tablename,
    SUM((1 - null_frac) * avg_width)::numeric AS data_width,
    COUNT(*) FILTER (WHERE null_frac <> 0)::numeric AS nullable_cols
  FROM pg_stats
  WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
  GROUP BY schemaname, tablename
),
estimates AS (
  SELECT
    t.schemaname,
    t.tablename,
    t.est_rows,
    t.table_bytes,
    CEIL(
      (
        t.est_rows * (
          c.hdr
          + COALESCE(cs.data_width, 0)
          + CASE
              WHEN COALESCE(cs.nullable_cols, 0) > 0 THEN CEIL(cs.nullable_cols / 8)
              ELSE 0
            END
        ) + 20
      ) / (c.bs - 20)
    ) * c.bs AS expected_bytes
  FROM table_stats t
  CROSS JOIN constants c
  LEFT JOIN column_stats cs
    ON cs.schemaname = t.schemaname
   AND cs.tablename = t.tablename
  WHERE t.est_rows > 0
)
SELECT
  schemaname,
  tablename,
  pg_size_pretty(table_bytes::bigint) AS table_size,
  pg_size_pretty(GREATEST(table_bytes - expected_bytes, 0)::bigint) AS estimated_bloat,
  ROUND((100 * GREATEST(table_bytes - expected_bytes, 0) / NULLIF(table_bytes, 0))::numeric, 2) AS estimated_bloat_pct,
  est_rows::bigint AS estimated_rows
FROM estimates
ORDER BY GREATEST(table_bytes - expected_bytes, 0) DESC
LIMIT 10;

-- === QUERY 15: Specific call counts and total time for known RPCs ===
WITH names(name) AS (
  VALUES
    ('submit_sales_order'),
    ('apply_erp_items_delta'),
    ('get_billing_queue_snapshot'),
    ('claim_order'),
    ('release_claim'),
    ('complete_billing'),
    ('complete_picking'),
    ('refresh_customer_frequency')
),
matches AS (
  SELECT
    n.name,
    s.calls,
    s.total_exec_time,
    s.mean_exec_time,
    s.rows,
    s.query
  FROM names n
  LEFT JOIN pg_stat_statements s
    ON s.query ~* ('\m' || n.name || '\M')
)
SELECT
  name AS rpc_name,
  COALESCE(SUM(calls), 0)::bigint AS calls,
  ROUND(COALESCE(SUM(total_exec_time), 0)::numeric, 2) AS total_ms,
  ROUND(COALESCE(SUM(total_exec_time) / NULLIF(SUM(calls), 0), 0)::numeric, 2) AS weighted_mean_ms,
  COALESCE(SUM(rows), 0)::bigint AS rows,
  COUNT(query) AS matching_pg_stat_rows
FROM matches
GROUP BY name
ORDER BY total_ms DESC, calls DESC, rpc_name;
```

## Section 7 — Top 5 suspected causes

1. `src/hooks/useClaimableOrders.ts:224` + `supabase/migrations/035_billing_queue_events_and_snapshot.sql:157`: `get_billing_queue_snapshot` is called every 5s per mounted queue view, and the SQL groups all `order_items` before filtering orders.
2. `src/hooks/useClaimableOrders.ts:327` and `src/hooks/useOrders.ts:135`: queue/list hooks combine Realtime invalidations with polling keep-alives, including 5s polling on billing/picking queue data and unfiltered `orders` subscriptions in common views.
3. `supabase/migrations/036_erp_items_delta_rpc.sql:151` plus `supabase/migrations/017_pending_recovery_back_in_stock.sql:287` and `026_items_realtime_and_updated_at_trigger.sql:28`: ERP item deltas bulk-update `items`, firing per-row `updated_at` and pending-recovery triggers.
4. `src/hooks/useItems.ts:171` and `src/hooks/useItems.ts:204`: every active catalog client runs a 30s `items` sync path; cold clients also pull the active catalog in 1,000-row pages.
5. `src/hooks/useSalesPendingRecovery.ts:289-363` and `src/hooks/usePendingItems.ts:25`: pending recovery screens poll `pending_items` every 30s, with `useSalesPendingRecovery` doing multiple dependent table reads and salesperson filtering in the client.

## Section 8 — Confirmation criteria

| suspicion | confirms in SQL output | refutes in SQL output |
|---|---|---|
| 1. `get_billing_queue_snapshot` 5s queue snapshot | Query 15 shows `get_billing_queue_snapshot` with the highest or near-highest `calls`/`total_ms`; Query 2 shows query text containing `get_billing_queue_snapshot` or its `line_summary` shape near the top by `total_exec_time`; Query 4 shows high `mean_ms` for it with `calls > 5` | Query 15 shows low calls and low total time for `get_billing_queue_snapshot`, and Query 2/4 do not surface the snapshot SQL |
| 2. queue/list polling plus broad `orders` Realtime/list reads | Query 3 shows high-call normalized statements reading from `orders`; Query 2 shows `orders` list/select queries consuming a large percent of total time; Query 11 includes `orders`; Query 9 shows active non-idle `orders` reads during queue usage | Query 3 has no high-call `orders` list reads, Query 2 shows low total time for `orders` selects, and active queue usage does not show `orders` reads in Query 9 |
| 3. `apply_erp_items_delta` and item triggers | Query 15 shows `apply_erp_items_delta` with material `calls`/`total_ms`; Query 2 shows `UPDATE public.items` or `apply_erp_items_delta` among top total time; Query 6 shows high `n_dead_tup` or recent autovacuum pressure on `items`/`pending_items`; Query 12 shows multiple triggers on `items` | Query 15 shows zero/low `apply_erp_items_delta` time, Query 2 lacks item update statements, and Query 6 shows low dead tuples on `items`/`pending_items` |
| 4. 30s `items` client sync | Query 3 shows high-call `items` selects containing `updated_at`, `is_active`, or ordered `id`/`updated_at` cursor patterns; Query 2 shows those `items` selects high by total time; Query 11 does not include `items`, confirming load is REST polling rather than Realtime | Query 3 shows low-call `items` selects and Query 2 has no significant `items` read cost |
| 5. pending recovery polling | Query 3 shows high-call `pending_items` selects with `status = pending` or `recovery_order_id` predicates; Query 2/4 show `pending_items`, `stock_locationwise`, or related `orders/customers/items/order_items` batched reads high by total or mean time | Query 3 shows low calls for `pending_items` reads and Query 2/4 do not surface pending-recovery table reads |
