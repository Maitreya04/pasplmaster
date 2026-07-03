import assert from 'node:assert/strict';
import { buildReviewBillTableGroups, reviewStatusLabel } from './reviewBillTableRows';
import type { OrderItem } from '../../types';
import type { OverlayLineEdit } from '../../pages/billing/BillingDesk/types';

function stubItem(partial: Partial<OrderItem>): OrderItem {
  return {
    id: 1,
    order_id: 1,
    item_id: 10,
    item_name: 'Filter',
    item_alias: null,
    rack_no: null,
    qty_requested: 1,
    qty_shippable: 1,
    qty_po: 0,
    qty_approved: 1,
    price_quoted: 237,
    price_system: 237,
    state: 'picked',
    flag_reason: null,
    flag_notes: null,
    flag_box_price: null,
    scan_result: null,
    bill_line_no: 1,
    ...partial,
  };
}

function stubEdit(partial: Partial<OverlayLineEdit> = {}): OverlayLineEdit {
  return {
    priceQuoted: 237,
    salesUnit: 'pcs',
    removed: false,
    priceTouched: false,
    resolution: null,
    ...partial,
  };
}

function runTests(): void {
  const paid = stubItem({ id: 1, bill_line_no: 2 });
  const foc = stubItem({ id: 2, bill_line_no: 3, is_foc: true, price_quoted: 0, qty_requested: 4 });
  const zeroPriceNotFoc = stubItem({
    id: 3,
    bill_line_no: 4,
    price_quoted: 0,
    price_system: 0,
    qty_requested: 1,
  });
  const sorted = [paid, foc, zeroPriceNotFoc];
  const edits = {
    1: stubEdit(),
    2: stubEdit({ priceQuoted: 0 }),
    3: stubEdit({ priceQuoted: 0 }),
  };

  const groups = buildReviewBillTableGroups(sorted, sorted, edits, new Map(), new Set());
  const billGroup = groups.find((g) => g.id === 'bill');
  assert.ok(billGroup);
  assert.equal(billGroup!.rows.length, 3);
  assert.equal(reviewStatusLabel(billGroup!.rows[1]!).short, 'FOC');
  assert.notEqual(reviewStatusLabel(billGroup!.rows[2]!).short, 'FOC');

  console.log('reviewBillTableRows tests passed');
}

runTests();
