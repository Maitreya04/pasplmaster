/**
 * Cache patch pressure tests — optimistic updates must match DB semantics so
 * desk/picker UIs never show impossible states during refetch.
 */
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import type { OrderWithClaimInfo } from '../hooks/useClaimableOrders';
import {
  filterDeskOrdersByTab,
  isPickingTabOrder,
  orderBelongsOnDeskResolveTab,
} from './billing/deskOrderQueue';
import { isDeskBillingFinalized } from './billing/deskOrderTab';
import {
  patchBillingFinalisedInCache,
  patchClaimableOrderInCache,
  patchPickFinalisedInCache,
  patchPickerAssignedInCache,
} from './queueRefresh';

const BILLING_PIPELINE_KEY = [
  'claimable-orders',
  'billing',
  'approved,picking,flagged',
  false,
  false,
  'billing-snapshot',
] as const;

const BILLING_COMPLETED_KEY = [
  'claimable-orders',
  'billing',
  'completed',
  false,
  true,
  'billing-snapshot',
] as const;

const PICKING_QUEUE_KEY = [
  'claimable-orders',
  'picking',
  'approved,picking',
  false,
  false,
  'legacy',
] as const;

function baseOrder(id: number, status: OrderWithClaimInfo['workflow_status']): OrderWithClaimInfo {
  return {
    id,
    order_number: `PA-000${id}`,
    order_kind: 'standard',
    customer_id: 1,
    customer_name: 'Test Customer',
    customer_city: 'Indore',
    customer_address: null,
    transport_id: null,
    transport_name: null,
    salesperson_name: 'Sales',
    salesperson_user_id: 1,
    reviewer_name: null,
    picker_name: null,
    stock_location_code: 'main_store',
    fulfillment_path: 'warehouse_pick',
    workflow_status: status,
    priority: 'normal',
    notes: null,
    item_count: 2,
    ask_line_count: 0,
    special_rate_line_count: 0,
    special_rate_qty: 0,
    total_value: 1000,
    created_at: '2026-07-04T08:00:00Z',
    approved_at: '2026-07-04T09:00:00Z',
    picked_at: null,
    completed_at: null,
    dispatched_at: null,
    claim_info: null,
    sales_edit_claim_info: null,
    is_mine: false,
  };
}

function toDeskRow(order: OrderWithClaimInfo) {
  return {
    workflow_status: order.workflow_status,
    deskStatus: 'picking' as const,
    pickingClaimStale: false,
    pickerFlags: [],
    picker_name: order.picker_name,
    reviewer_name: order.reviewer_name,
    fulfillment_path: order.fulfillment_path,
    stock_location_code: order.stock_location_code,
  };
}

function runTests(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const orderId = 42;
  const picking = baseOrder(orderId, 'picking');
  picking.picker_name = 'Bittu';

  qc.setQueryData([...BILLING_PIPELINE_KEY], [picking]);
  qc.setQueryData([...PICKING_QUEUE_KEY], [picking]);

  // ── Pick finalised: leaves Picking tab, opens Resolve ──
  patchPickFinalisedInCache(qc, orderId, { hasFlags: false });

  const afterPickPipeline = qc.getQueryData<OrderWithClaimInfo[]>([...BILLING_PIPELINE_KEY])!;
  const afterPickPickingQueue = qc.getQueryData<OrderWithClaimInfo[]>([...PICKING_QUEUE_KEY])!;

  assert.equal(afterPickPipeline[0]!.workflow_status, 'completed');
  assert.ok(afterPickPipeline[0]!.picking_completed_at);
  assert.ok(afterPickPipeline[0]!.completed_at);

  const deskAfterPick = toDeskRow(afterPickPipeline[0]!);
  assert.equal(isPickingTabOrder(deskAfterPick), false);
  assert.equal(orderBelongsOnDeskResolveTab(deskAfterPick), true);
  assert.equal(isDeskBillingFinalized(deskAfterPick), false);

  // Picking queue fetch filters completed out — must be removed from cache immediately.
  assert.equal(afterPickPickingQueue?.length ?? 0, 0, 'pick complete removes from picker queue');

  // ── Billing finalised: moves to Done ──
  qc.setQueryData([...BILLING_COMPLETED_KEY], [afterPickPipeline[0]!]);
  patchBillingFinalisedInCache(qc, orderId, 'Deepak Yogi');

  const afterBillPipeline = qc.getQueryData<OrderWithClaimInfo[]>([...BILLING_PIPELINE_KEY])!;
  const afterBillCompleted = qc.getQueryData<OrderWithClaimInfo[]>([...BILLING_COMPLETED_KEY])!;

  assert.equal(afterBillPipeline?.length ?? 0, 0, 'billed order leaves active pipeline cache');
  assert.equal(afterBillCompleted[0]!.reviewer_name, 'Deepak Yogi');
  assert.equal(isDeskBillingFinalized(toDeskRow(afterBillCompleted[0]!)), true);

  // ── Picker assign: stays approved (not picking) until start_picking ──
  const approved = baseOrder(99, 'approved');
  qc.setQueryData([...BILLING_PIPELINE_KEY], [approved]);

  patchPickerAssignedInCache(qc, 99, 'Bittu');
  const afterAssign = qc.getQueryData<OrderWithClaimInfo[]>([...BILLING_PIPELINE_KEY])![0]!;

  assert.equal(afterAssign.workflow_status, 'approved', 'assign must not jump to picking');
  assert.equal(afterAssign.picker_name, 'Bittu');
  assert.equal(isPickingTabOrder(toDeskRow(afterAssign)), true, 'assigned preview on Picking tab');

  // ── Flagged resolve also sets completed ──
  const flagged = baseOrder(77, 'flagged');
  flagged.picking_completed_at = '2026-07-04T10:00:00Z';
  qc.setQueryData([...BILLING_PIPELINE_KEY], [flagged]);

  patchBillingFinalisedInCache(qc, 77, 'Deepak Yogi', { fromFlagged: true });
  const afterFlagPipeline = qc.getQueryData<OrderWithClaimInfo[]>([...BILLING_PIPELINE_KEY]);
  const afterFlagResolve = qc.getQueryData<OrderWithClaimInfo[]>([...BILLING_COMPLETED_KEY])![0]!;

  assert.equal(afterFlagPipeline?.length ?? 0, 0);
  assert.equal(afterFlagResolve.workflow_status, 'completed');
  assert.equal(afterFlagResolve.reviewer_name, 'Deepak Yogi');
  assert.equal(isDeskBillingFinalized(toDeskRow(afterFlagResolve)), true);

  // ── Partial patch must not clobber unrelated fields ──
  const intact = baseOrder(55, 'completed');
  intact.picker_name = 'Bittu';
  intact.picking_completed_at = '2026-07-04T10:00:00Z';
  qc.setQueryData([...BILLING_PIPELINE_KEY], [intact]);

  patchClaimableOrderInCache(qc, 55, { reviewer_name: 'Neetu' });
  const partial = qc.getQueryData<OrderWithClaimInfo[]>([...BILLING_PIPELINE_KEY])![0]!;
  assert.equal(partial.picker_name, 'Bittu');
  assert.equal(partial.workflow_status, 'completed');
  assert.equal(partial.reviewer_name, 'Neetu');

  console.log('queueRefresh.test.ts: all passed');
}

runTests();
