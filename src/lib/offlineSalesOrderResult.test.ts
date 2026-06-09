import { strict as assert } from 'node:assert';
import { offlineOrderStatusFromResult } from './offlineSalesOrderResult.ts';

assert.equal(
  offlineOrderStatusFromResult({
    success: true,
    order_number: 'PA-1',
    offline_outcome: 'submitted',
    shortage_qty: 0,
  }),
  'synced',
);

assert.equal(
  offlineOrderStatusFromResult({
    success: true,
    order_number: 'PA-2',
    offline_outcome: 'partial',
    shortage_qty: 4,
  }),
  'partial',
);

assert.equal(
  offlineOrderStatusFromResult({
    success: true,
    order_number: null,
    offline_outcome: 'no_billable_lines',
    shortage_qty: 8,
  }),
  'no_stock',
);

console.log('offlineSalesOrderResult tests passed');
