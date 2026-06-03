import assert from 'node:assert/strict';
import {
  billingStageBarIndex,
  deriveBillingOperatorStage,
} from './deriveBillingOperatorStage';

function runTests(): void {
  assert.equal(
    deriveBillingOperatorStage({ workflow_status: 'submitted' }),
    'busy_entry',
  );

  assert.equal(
    deriveBillingOperatorStage({
      workflow_status: 'approved',
      picker_name: null,
      deskStatus: 'unassigned',
    }),
    'assign_picker',
  );

  assert.equal(
    deriveBillingOperatorStage({
      workflow_status: 'approved',
      picker_name: 'Raj',
      deskStatus: 'no_ack',
    }),
    'picking',
  );

  assert.equal(
    deriveBillingOperatorStage({
      workflow_status: 'picking',
      picker_name: 'Raj',
    }),
    'picking',
  );

  assert.equal(
    deriveBillingOperatorStage({
      workflow_status: 'picking',
      openPickerFlagCount: 2,
    }),
    'resolve_flags',
  );

  assert.equal(
    deriveBillingOperatorStage({ workflow_status: 'flagged' }),
    'resolve_flags',
  );

  assert.equal(
    deriveBillingOperatorStage({
      workflow_status: 'completed',
      reviewer_name: null,
    }),
    'review_finalise',
  );

  assert.equal(
    deriveBillingOperatorStage({
      workflow_status: 'completed',
      reviewer_name: 'Priya',
    }),
    'done',
  );

  assert.equal(
    deriveBillingOperatorStage({
      workflow_status: 'completed',
      reviewer_name: null,
      fulfillment_path: 'direct_bill',
    }),
    'done',
  );

  assert.equal(billingStageBarIndex('busy_entry'), 0);
  assert.equal(billingStageBarIndex('done'), 5);

  console.log('deriveBillingOperatorStage.test.ts: all passed');
}

runTests();
