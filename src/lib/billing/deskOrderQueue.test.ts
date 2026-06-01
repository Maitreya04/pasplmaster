import assert from 'node:assert/strict';
import {
  filterDeskOrdersByTab,
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

  const workflowFlagged = deskRow({
    workflow_status: 'flagged',
    deskStatus: 'flagged',
  });

  assert.equal(orderBelongsOnDeskResolveTab(workflowFlagged), true);
  assert.deepEqual(filterDeskOrdersByTab([workflowFlagged], 'resolve'), [workflowFlagged]);
}

runTests();
