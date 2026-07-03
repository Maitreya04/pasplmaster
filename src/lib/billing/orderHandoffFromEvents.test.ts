import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildHandoffScanSteps,
  formatHandoffDuration,
  hasHandoffContent,
  parseOrderHandoffRpc,
} from './orderHandoffFromEvents';

test('parseOrderHandoffRpc maps checkedBy', () => {
  const parsed = parseOrderHandoffRpc({
    checkedBy: 'Deepak',
    claimedBy: 'Neetu',
    pickedBy: 'Shankar',
    completedBy: 'Deepak',
    changeCount: 0,
    fulfillmentPath: 'warehouse_pick',
  });
  assert.equal(parsed?.checkedBy, 'Deepak');
});

test('buildHandoffScanSteps shows sold checked picked done', () => {
  const steps = buildHandoffScanSteps(
    {
      claimedBy: 'Neetu',
      checkedBy: 'Deepak',
      assignedBy: 'Deepak',
      pickedBy: 'Shankar',
      resolvedBy: null,
      completedBy: 'Deepak',
      changeCount: 0,
      fulfillmentPath: 'warehouse_pick',
      submittedAt: null,
      completedAt: null,
    },
    'Hemant',
  );
  assert.deepEqual(
    steps.map((s) => s.key),
    ['sold', 'checked', 'picked', 'done'],
  );
});

test('buildHandoffScanSteps omits assigned when same as checked', () => {
  const steps = buildHandoffScanSteps(
    {
      claimedBy: null,
      checkedBy: 'Deepak',
      assignedBy: 'Deepak',
      pickedBy: 'Shankar',
      resolvedBy: null,
      completedBy: 'Deepak',
      changeCount: 0,
      fulfillmentPath: 'warehouse_pick',
      submittedAt: null,
      completedAt: null,
    },
    'Hemant',
  );
  assert.equal(steps.some((s) => s.key === 'assigned'), false);
});

test('buildHandoffScanSteps direct bill skips picked', () => {
  const steps = buildHandoffScanSteps(
    {
      claimedBy: null,
      checkedBy: 'Deepak',
      assignedBy: null,
      pickedBy: 'Shankar',
      resolvedBy: null,
      completedBy: 'Deepak',
      changeCount: 0,
      fulfillmentPath: 'direct_bill',
      submittedAt: null,
      completedAt: null,
    },
    'Hemant',
  );
  assert.deepEqual(
    steps.map((s) => s.key),
    ['sold', 'checked', 'done'],
  );
});

test('hasHandoffContent true when salesperson only on done layout', () => {
  assert.equal(
    hasHandoffContent(
      {
        claimedBy: null,
        checkedBy: null,
        assignedBy: null,
        pickedBy: null,
        resolvedBy: null,
        completedBy: null,
        changeCount: 0,
        fulfillmentPath: null,
        submittedAt: '2026-06-05T10:00:00Z',
        completedAt: '2026-06-05T11:00:00Z',
      },
      'Hemant',
    ),
    true,
  );
});

test('formatHandoffDuration formats submit-to-done span', () => {
  assert.equal(
    formatHandoffDuration('2026-06-05T10:00:00Z', '2026-06-05T10:59:00Z'),
    '59 min',
  );
});
