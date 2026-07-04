/**
 * Pressure tests for warehouse-pick → billing-finalise lifecycle.
 *
 * Ensures every workflow state lands on exactly the right desk tab and operator
 * stage, with no overlap (e.g. completed pick still on Picking, or billed order
 * still on Resolve).
 */
import assert from 'node:assert/strict';
import { deriveBillingOperatorStage } from './deriveBillingOperatorStage';
import {
  filterDeskOrdersByTab,
  isAssignTabOrder,
  isPickingTabOrder,
  orderBelongsOnDeskResolveTab,
  type DeskQueueOrder,
} from './deskOrderQueue';
import { isDeskBillingFinalized, needsDeskBillReview } from './deskOrderTab';
import { needsPostPickBillingClaim } from './postPickBillingClaim';

type DeskTab = 'assign' | 'picking' | 'resolve' | 'completed';

function deskRow(
  overrides: Partial<DeskQueueOrder> & Pick<DeskQueueOrder, 'workflow_status'>,
): DeskQueueOrder {
  return {
    deskStatus: 'picking',
    pickingClaimStale: false,
    pickerFlags: [],
    fulfillment_path: 'warehouse_pick',
    stock_location_code: 'main_store',
    picker_name: 'Bittu',
    reviewer_name: null,
    ...overrides,
  };
}

function tabFor(order: DeskQueueOrder): DeskTab | null {
  if (isAssignTabOrder(order)) return 'assign';
  if (isPickingTabOrder(order)) return 'picking';
  if (orderBelongsOnDeskResolveTab(order)) return 'resolve';
  if (filterDeskOrdersByTab([order], 'completed').length === 1) return 'completed';
  return null;
}

/** Each order must appear on exactly one desk tab (or none if rejected etc.). */
function assertExactlyOneTab(
  order: DeskQueueOrder,
  expected: DeskTab,
  label: string,
): void {
  const assign = isAssignTabOrder(order);
  const picking = isPickingTabOrder(order);
  const resolve = orderBelongsOnDeskResolveTab(order);
  const completed = filterDeskOrdersByTab([order], 'completed').length === 1;

  const count = [assign, picking, resolve, completed].filter(Boolean).length;
  assert.equal(
    count,
    1,
    `${label}: expected exactly one tab, got assign=${assign} picking=${picking} resolve=${resolve} completed=${completed}`,
  );
  assert.equal(tabFor(order), expected, `${label}: wrong tab`);
}

function runLifecycleTests(): void {
  // ── 1. Approved, unassigned → Assign only ──
  const approvedUnassigned = deskRow({
    workflow_status: 'approved',
    deskStatus: 'unassigned',
    picker_name: null,
  });
  assertExactlyOneTab(approvedUnassigned, 'assign', 'approved unassigned');
  assert.equal(
    deriveBillingOperatorStage({
      workflow_status: 'approved',
      picker_name: null,
      deskStatus: 'unassigned',
    }),
    'assign_picker',
  );

  // ── 2. Approved + picker assigned (preview) → Picking, NOT Resolve ──
  const approvedAssigned = deskRow({
    workflow_status: 'approved',
    deskStatus: 'no_ack',
    picker_name: 'Bittu',
  });
  assertExactlyOneTab(approvedAssigned, 'picking', 'approved assigned');
  assert.equal(needsPostPickBillingClaim(approvedAssigned), false);

  // ── 3. Active pick → Picking only, never Resolve (even with line flags) ──
  const inPickWithFlags = deskRow({
    workflow_status: 'picking',
    deskStatus: 'picking',
    pickerFlags: [{ orderItemId: 1, itemName: 'Part', flagReason: 'OOS' }],
  });
  assertExactlyOneTab(inPickWithFlags, 'picking', 'in-pick with flags');
  assert.equal(orderBelongsOnDeskResolveTab(inPickWithFlags), false);
  assert.equal(
    deriveBillingOperatorStage({
      workflow_status: 'picking',
      openPickerFlagCount: 1,
    }),
    'resolve_flags',
    'stage bar can show resolve_flags while desk tab stays Picking',
  );

  // ── 4. Pick complete (clean) → Resolve, NOT Picking ──
  const pickComplete = deskRow({
    workflow_status: 'completed',
    deskStatus: 'checking',
    picking_completed_at: '2026-07-04T10:00:00Z',
    reviewer_name: null,
  });
  assertExactlyOneTab(pickComplete, 'resolve', 'pick complete awaiting bill');
  assert.equal(isPickingTabOrder(pickComplete), false);
  assert.equal(needsDeskBillReview(pickComplete), true);
  assert.equal(needsPostPickBillingClaim(pickComplete), true);
  assert.equal(
    deriveBillingOperatorStage(pickComplete),
    'review_finalise',
  );

  // ── 5. Pick complete (flagged workflow) → Resolve ──
  const pickFlagged = deskRow({
    workflow_status: 'flagged',
    deskStatus: 'flagged',
    picking_completed_at: '2026-07-04T10:00:00Z',
  });
  assertExactlyOneTab(pickFlagged, 'resolve', 'pick flagged');
  assert.equal(isPickingTabOrder(pickFlagged), false);
  assert.equal(needsPostPickBillingClaim(pickFlagged), true);

  // ── 6. Billing finalised → Done only, NOT Resolve or Picking ──
  const billed = deskRow({
    workflow_status: 'completed',
    deskStatus: 'checking',
    picking_completed_at: '2026-07-04T10:00:00Z',
    reviewer_name: 'Deepak Yogi',
  });
  assertExactlyOneTab(billed, 'completed', 'billing finalised');
  assert.equal(isDeskBillingFinalized(billed), true);
  assert.equal(needsDeskBillReview(billed), false);
  assert.equal(needsPostPickBillingClaim(billed), false);
  assert.equal(deriveBillingOperatorStage(billed), 'done');
  assert.equal(isPickingTabOrder(billed), false);
  assert.equal(orderBelongsOnDeskResolveTab(billed), false);

  // ── 7. Flagged resolved to completed + reviewer → Done ──
  const flaggedResolved = deskRow({
    workflow_status: 'completed',
    deskStatus: 'checking',
    picking_completed_at: '2026-07-04T10:00:00Z',
    reviewer_name: 'Deepak Yogi',
    pickerFlags: [],
  });
  assertExactlyOneTab(flaggedResolved, 'completed', 'flagged then resolved');
  assert.equal(deriveBillingOperatorStage(flaggedResolved), 'done');

  // ── 8. 100% progress illusion: still picking until finalise RPC ──
  const allLinesDoneStillPicking = deskRow({
    workflow_status: 'picking',
    deskStatus: 'picking',
    picking_completed_at: null,
  });
  assertExactlyOneTab(allLinesDoneStillPicking, 'picking', '100% lines but not finalised');
  assert.equal(needsPostPickBillingClaim(allLinesDoneStillPicking), false);

  // ── 9. Transition invariants: pick complete must flip Resolve gate ──
  assert.equal(
    needsPostPickBillingClaim({
      ...allLinesDoneStillPicking,
      workflow_status: 'completed',
      picking_completed_at: '2026-07-04T10:05:00Z',
    }),
    true,
    'after finalise, billing claim gate opens',
  );

  // ── 10. Full pipeline sequence — no tab regression ──
  const pipeline: Array<{ row: DeskQueueOrder; tab: DeskTab; stage: string }> = [
    {
      row: approvedUnassigned,
      tab: 'assign',
      stage: 'assign_picker',
    },
    {
      row: approvedAssigned,
      tab: 'picking',
      stage: 'picking',
    },
    {
      row: inPickWithFlags,
      tab: 'picking',
      stage: 'resolve_flags',
    },
    {
      row: pickComplete,
      tab: 'resolve',
      stage: 'review_finalise',
    },
    {
      row: billed,
      tab: 'completed',
      stage: 'done',
    },
  ];

  for (const step of pipeline) {
    assertExactlyOneTab(step.row, step.tab, `pipeline ${step.tab}`);
    assert.equal(
      deriveBillingOperatorStage({
        workflow_status: step.row.workflow_status,
        picker_name: step.row.picker_name,
        reviewer_name: step.row.reviewer_name,
        fulfillment_path: step.row.fulfillment_path,
        stock_location_code: step.row.stock_location_code,
        deskStatus: step.row.deskStatus,
        openPickerFlagCount: step.row.pickerFlags.length,
      }),
      step.stage,
      `pipeline stage ${step.stage}`,
    );
  }

  // ── 11. Mutual exclusion: billed order never on Picking or Resolve ──
  for (const finalized of [billed, flaggedResolved]) {
    assert.equal(isPickingTabOrder(finalized), false);
    assert.equal(orderBelongsOnDeskResolveTab(finalized), false);
    assert.equal(isAssignTabOrder(finalized), false);
  }

  // ── 12. Mutual exclusion: in-pick never on Resolve or Done ──
  for (const active of [approvedAssigned, inPickWithFlags, allLinesDoneStillPicking]) {
    assert.equal(orderBelongsOnDeskResolveTab(active), false);
    assert.equal(isDeskBillingFinalized(active), false);
    assert.equal(filterDeskOrdersByTab([active], 'completed').length, 0);
  }

  console.log('workflowLifecycle.test.ts: all passed');
}

runLifecycleTests();
