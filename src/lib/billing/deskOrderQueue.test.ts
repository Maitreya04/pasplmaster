import assert from 'node:assert/strict';
import {
  filterDeskOrdersByTab,
  isAssignTabOrder,
  isPickingTabOrder,
  orderBelongsOnDeskResolveTab,
  orderHasDeskPickerFlags,
  type DeskQueueOrder,
} from './deskOrderQueue';

function deskRow(
  overrides: Partial<DeskQueueOrder> & Pick<DeskQueueOrder, 'workflow_status'>,
): DeskQueueOrder {
  return {
    workflow_status: overrides.workflow_status,
    deskStatus: 'picking',
    pickingClaimStale: false,
    pickerFlags: [],
    ...overrides,
  };
}

function runTests(): void {
  const approvedUnassigned = deskRow({
    workflow_status: 'approved',
    deskStatus: 'unassigned',
    picker_name: null,
  });

  assert.equal(isAssignTabOrder(approvedUnassigned), true);
  assert.deepEqual(filterDeskOrdersByTab([approvedUnassigned], 'assign'), [
    approvedUnassigned,
  ]);
  assert.deepEqual(filterDeskOrdersByTab([approvedUnassigned], 'picking'), []);

  const approvedAssigned = deskRow({
    workflow_status: 'approved',
    deskStatus: 'no_ack',
    picker_name: 'Abhishek',
  });

  assert.equal(isAssignTabOrder(approvedAssigned), false);
  assert.equal(isPickingTabOrder(approvedAssigned), true);
  assert.deepEqual(filterDeskOrdersByTab([approvedAssigned], 'assign'), []);
  assert.deepEqual(filterDeskOrdersByTab([approvedAssigned], 'picking'), [
    approvedAssigned,
  ]);

  const inPickFlagged = deskRow({
    workflow_status: 'picking',
    pickerFlags: [
      { orderItemId: 10, itemName: 'Widget', flagReason: 'Price Mismatch' },
    ],
  });

  assert.equal(orderHasDeskPickerFlags(inPickFlagged), true);
  assert.equal(orderBelongsOnDeskResolveTab(inPickFlagged), false);
  assert.deepEqual(filterDeskOrdersByTab([inPickFlagged], 'picking'), [inPickFlagged]);
  assert.deepEqual(filterDeskOrdersByTab([inPickFlagged], 'resolve'), []);

  const completedNeedsBilling = deskRow({
    workflow_status: 'completed',
    deskStatus: 'checking',
    picker_name: 'Abhishek',
    reviewer_name: null,
    fulfillment_path: 'warehouse_pick',
    stock_location_code: 'main_store',
  });

  assert.equal(orderBelongsOnDeskResolveTab(completedNeedsBilling), true);
  assert.deepEqual(filterDeskOrdersByTab([completedNeedsBilling], 'resolve'), [
    completedNeedsBilling,
  ]);
  assert.deepEqual(filterDeskOrdersByTab([completedNeedsBilling], 'completed'), []);

  const postPickFlagged = deskRow({
    workflow_status: 'completed',
    deskStatus: 'checking',
    pickerFlags: [
      { orderItemId: 11, itemName: 'Widget', flagReason: 'Out of stock' },
    ],
  });

  assert.equal(orderBelongsOnDeskResolveTab(postPickFlagged), true);
  assert.deepEqual(filterDeskOrdersByTab([postPickFlagged], 'resolve'), [postPickFlagged]);
  assert.deepEqual(filterDeskOrdersByTab([postPickFlagged], 'picking'), []);

  const completedReviewed = deskRow({
    workflow_status: 'completed',
    deskStatus: 'checking',
    picker_name: 'Abhishek',
    reviewer_name: 'Billing',
    fulfillment_path: 'warehouse_pick',
    stock_location_code: 'main_store',
  });

  assert.equal(orderBelongsOnDeskResolveTab(completedReviewed), false);
  assert.deepEqual(filterDeskOrdersByTab([completedReviewed], 'completed'), [
    completedReviewed,
  ]);

  const completedDirectBill = deskRow({
    workflow_status: 'completed',
    deskStatus: 'checking',
    reviewer_name: null,
    fulfillment_path: 'direct_bill',
    stock_location_code: 'main_store',
  });

  assert.equal(orderBelongsOnDeskResolveTab(completedDirectBill), false);
  assert.deepEqual(filterDeskOrdersByTab([completedDirectBill], 'completed'), [
    completedDirectBill,
  ]);

  const completedJabalpur = deskRow({
    workflow_status: 'completed',
    deskStatus: 'checking',
    reviewer_name: null,
    fulfillment_path: 'warehouse_pick',
    stock_location_code: 'jabalpur',
  });

  assert.equal(orderBelongsOnDeskResolveTab(completedJabalpur), false);
  assert.deepEqual(filterDeskOrdersByTab([completedJabalpur], 'completed'), [
    completedJabalpur,
  ]);

  const workflowFlagged = deskRow({
    workflow_status: 'flagged',
    deskStatus: 'flagged',
  });

  assert.equal(orderBelongsOnDeskResolveTab(workflowFlagged), true);
  assert.deepEqual(filterDeskOrdersByTab([workflowFlagged], 'resolve'), [workflowFlagged]);
}

runTests();
