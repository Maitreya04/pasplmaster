import assert from 'node:assert/strict';
import {
  billableQtyForTotal,
  deriveBillLineFulfillment,
  summarizeBillFulfillment,
} from './billLineFulfillment';
import type { OrderItem, PendingItem } from '../../types';

function stubItem(partial: Partial<OrderItem>): OrderItem {
  return {
    id: 1,
    order_id: 1,
    item_id: 10,
    item_name: 'Test item',
    item_alias: null,
    rack_no: null,
    qty_requested: 5,
    qty_shippable: 5,
    qty_po: 0,
    qty_approved: 5,
    price_quoted: 100,
    price_system: 100,
    state: 'picked',
    flag_reason: null,
    flag_notes: null,
    flag_box_price: null,
    scan_result: null,
    ...partial,
  };
}

function runTests(): void {
  const picked = deriveBillLineFulfillment(stubItem({}), []);
  assert.equal(picked.role, 'ship_today');
  assert.equal(picked.qtyBillToday, 5);
  assert.equal(picked.excludeFromBusyBill, false);

  const foc = deriveBillLineFulfillment(
    stubItem({ is_foc: true, price_quoted: 0, qty_requested: 4 }),
    [],
  );
  assert.equal(foc.role, 'foc');
  assert.equal(foc.chipLabel, 'FOC');
  assert.equal(foc.qtyBillToday, 4);

  const salesPo = deriveBillLineFulfillment(
    stubItem({
      qty_requested: 4,
      qty_shippable: 0,
      qty_po: 4,
      qty_approved: 4,
      state: 'picked',
    }),
    [],
  );
  assert.equal(salesPo.role, 'sales_po');
  assert.equal(salesPo.excludeFromBusyBill, true);
  assert.equal(salesPo.qtySalesPo, 4);

  const pickerOos = deriveBillLineFulfillment(
    stubItem({ state: 'flagged', flag_reason: 'Out of Stock' }),
    [],
  );
  assert.equal(pickerOos.role, 'picker_oos');
  assert.equal(pickerOos.excludeFromBusyBill, true);

  const mixed = deriveBillLineFulfillment(
    stubItem({ qty_requested: 5, qty_shippable: 1, qty_po: 4, qty_approved: 1 }),
    [],
  );
  assert.equal(mixed.role, 'mixed');
  assert.equal(mixed.qtyBillToday, 1);
  assert.equal(mixed.qtySalesPo, 4);

  const pending: PendingItem[] = [
    {
      id: 1,
      order_id: 1,
      order_number: 'PA-1',
      customer_id: 1,
      customer_name: 'C',
      item_id: 10,
      item_name: 'Test',
      qty_pending: 2,
      source: 'picking',
      created_by: 'Picker',
      created_at: '',
      note: null,
      status: 'pending',
      recovery_status: 'waiting_stock',
      back_in_stock_at: null,
    },
  ];
  const partialOos = deriveBillLineFulfillment(stubItem({ qty_requested: 5 }), pending);
  assert.equal(partialOos.qtyPickerOos, 2);
  assert.equal(partialOos.qtyBillToday, 3);

  assert.equal(
    billableQtyForTotal(stubItem({ qty_requested: 4, qty_po: 4, qty_shippable: 0 }), salesPo),
    0,
  );
  assert.equal(billableQtyForTotal(stubItem({}), picked), 5);

  const map = new Map<number, PendingItem[]>();
  const totals = summarizeBillFulfillment(
    [
      stubItem({ id: 1 }),
      stubItem({ id: 2, is_foc: true, price_quoted: 0, qty_requested: 2 }),
      stubItem({
        id: 3,
        qty_requested: 3,
        qty_shippable: 0,
        qty_po: 3,
      }),
    ],
    map,
  );
  assert.equal(totals.billTodayQty, 7);
  assert.equal(totals.focQty, 2);
  assert.equal(totals.salesPoQty, 3);

  console.log('billLineFulfillment tests passed');
}

runTests();
