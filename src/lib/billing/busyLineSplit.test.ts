import assert from 'node:assert/strict';
import {
  busyBillableQty,
  busyPendingQty,
  isBusyBillableLine,
  isFullyPendingBusyLine,
} from './busyLineSplit';
import type { OrderItem } from '../../types';

function stubItem(partial: Partial<OrderItem> & Pick<OrderItem, 'id'>): OrderItem {
  return {
    order_id: 1,
    item_id: partial.id,
    item_name: partial.item_name ?? `Item ${partial.id}`,
    item_alias: null,
    qty_requested: partial.qty_requested ?? 1,
    qty_shippable: partial.qty_shippable ?? 1,
    qty_po: partial.qty_po ?? 0,
    price_system: 100,
    state: 'pending',
    ...partial,
  } as OrderItem;
}

function runTests(): void {
  const partialLine = stubItem({ id: 1, qty_requested: 2 });
  const partialFlag = { type: 'partial' as const, availableQty: 1 };

  assert.equal(isFullyPendingBusyLine(partialFlag), false);
  assert.equal(isBusyBillableLine(partialLine, partialFlag), true);
  assert.equal(busyBillableQty(partialLine, partialFlag), 1);
  assert.equal(busyPendingQty(partialLine, partialFlag), 1);

  const fullLine = stubItem({ id: 2, qty_requested: 1 });
  const noStockFlag = { type: 'no_stock' as const };
  assert.equal(isFullyPendingBusyLine(noStockFlag), true);
  assert.equal(isBusyBillableLine(fullLine, noStockFlag), false);
  assert.equal(busyPendingQty(fullLine, noStockFlag), 1);

  const inStock = stubItem({ id: 3, qty_requested: 1, qty_shippable: 1 });
  assert.equal(isBusyBillableLine(inStock, undefined), true);
  assert.equal(busyPendingQty(inStock, undefined), 0);

  console.log('busyLineSplit tests passed');
}

runTests();
