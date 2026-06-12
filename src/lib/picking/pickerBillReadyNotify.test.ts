import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldNotifyPickerBillReady } from './pickerBillReadyNotify';

test('shouldNotifyPickerBillReady for post-pick completed warehouse order', () => {
  assert.equal(
    shouldNotifyPickerBillReady({
      fulfillment_path: 'warehouse_pick',
      picking_completed_at: '2026-06-05T12:00:00Z',
      workflow_status: 'completed',
    }),
    true,
  );
});

test('shouldNotifyPickerBillReady for flagged warehouse pick', () => {
  assert.equal(
    shouldNotifyPickerBillReady({
      fulfillment_path: 'warehouse_pick',
      picking_completed_at: '2026-06-05T12:00:00Z',
      workflow_status: 'flagged',
    }),
    true,
  );
});

test('shouldNotifyPickerBillReady false without picking_completed_at', () => {
  assert.equal(
    shouldNotifyPickerBillReady({
      fulfillment_path: 'warehouse_pick',
      picking_completed_at: null,
      workflow_status: 'completed',
    }),
    false,
  );
});

test('shouldNotifyPickerBillReady false for submitted', () => {
  assert.equal(
    shouldNotifyPickerBillReady({
      fulfillment_path: 'warehouse_pick',
      picking_completed_at: '2026-06-05T12:00:00Z',
      workflow_status: 'submitted',
    }),
    false,
  );
});
