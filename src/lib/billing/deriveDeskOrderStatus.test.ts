import assert from 'node:assert/strict';
import { deriveDeskOrderStatus } from './deriveDeskOrderStatus';

function runTests(): void {
  assert.equal(
    deriveDeskOrderStatus({ workflow_status: 'approved', picker_name: null }, {}),
    'unassigned',
  );

  assert.equal(
    deriveDeskOrderStatus({ workflow_status: 'approved', picker_name: 'Harsh' }, {}),
    'no_ack',
  );

  assert.equal(
    deriveDeskOrderStatus({ workflow_status: 'approved', picker_name: 'Harsh' }, {
      hasActivePickingClaim: true,
    }),
    'picking',
  );

  assert.equal(
    deriveDeskOrderStatus({ workflow_status: 'picking', picker_name: 'Harsh' }, {
      pickingClaimStale: true,
    }),
    'no_ack',
  );

  assert.equal(
    deriveDeskOrderStatus({ workflow_status: 'picking', picker_name: 'Harsh' }, {
      hasActivePickingClaim: true,
    }),
    'picking',
  );

  console.log('deriveDeskOrderStatus.test.ts: all passed');
}

runTests();
