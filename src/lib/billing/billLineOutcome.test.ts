import assert from 'node:assert/strict';
import {
  billingApprovedQty,
  countEffectivePickLinesAfterBilling,
  deriveBillLineOutcome,
  resolveFulfillmentPathAfterBilling,
} from './billLineOutcome';
import type { BillingLiveQueueFlag } from './liveQueueDraft';

function runTests(): void {
  const line = {
    id: 1,
    qty_requested: 10,
    qty_shippable: 10,
    qty_po: 0,
    qty_approved: null as number | null,
  };

  const noStockFlag: BillingLiveQueueFlag = { type: 'no_stock' };
  assert.equal(billingApprovedQty(10, noStockFlag), 0);
  const oosOutcome = deriveBillLineOutcome(line, 0, noStockFlag);
  assert.equal(oosOutcome.qtyBilled, 0);
  assert.equal(oosOutcome.qtyPending, 10);
  assert.equal(oosOutcome.pendingSource, 'billing');

  const partialFlag: BillingLiveQueueFlag = { type: 'partial', availableQty: 4 };
  assert.equal(billingApprovedQty(10, partialFlag), 4);
  const partialOutcome = deriveBillLineOutcome(line, 4, partialFlag);
  assert.equal(partialOutcome.qtyBilled, 4);
  assert.equal(partialOutcome.qtyPending, 6);

  const flags: Record<number, BillingLiveQueueFlag> = { 1: noStockFlag };
  assert.equal(countEffectivePickLinesAfterBilling([line], flags), 0);
  assert.equal(
    resolveFulfillmentPathAfterBilling('warehouse_pick', 'main_store', 0),
    'direct_bill',
  );

  const poOnly = {
    id: 2,
    qty_requested: 5,
    qty_shippable: 0,
    qty_po: 5,
    qty_approved: 5,
  };
  assert.equal(countEffectivePickLinesAfterBilling([poOnly], {}), 0);

  const pickable = {
    id: 3,
    qty_requested: 3,
    qty_shippable: 3,
    qty_po: 0,
    qty_approved: 3,
  };
  assert.equal(countEffectivePickLinesAfterBilling([pickable], {}), 1);
  assert.equal(
    resolveFulfillmentPathAfterBilling('warehouse_pick', 'main_store', 1),
    'warehouse_pick',
  );

  console.log('billLineOutcome tests passed');
}

runTests();
