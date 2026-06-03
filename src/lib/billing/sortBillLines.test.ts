import assert from 'node:assert/strict';
import {
  billLineSortKey,
  buildBusyPasteText,
  sortBillLines,
  sortFlagsByBillLine,
} from './sortBillLines';
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
  const legacy = [
    stubItem({ id: 30, item_name: 'Third' }),
    stubItem({ id: 10, item_name: 'First' }),
    stubItem({ id: 20, item_name: 'Second' }),
  ];
  assert.deepEqual(
    sortBillLines(legacy).map((i) => i.id),
    [10, 20, 30],
  );

  const numbered = [
    stubItem({ id: 99, bill_line_no: 3, item_name: 'Line three' }),
    stubItem({ id: 88, bill_line_no: 1, item_name: 'Line one' }),
    stubItem({ id: 77, bill_line_no: 2, item_name: 'Line two' }),
  ];
  assert.deepEqual(
    sortBillLines(numbered).map((i) => i.bill_line_no),
    [1, 2, 3],
  );

  const splitSibling = [
    stubItem({ id: 1, bill_line_no: 1, item_name: 'Root' }),
    stubItem({ id: 3, bill_line_no: 3, item_name: 'After split' }),
    stubItem({ id: 2, bill_line_no: 2, item_name: 'Split child', split_from_id: 1 }),
  ];
  assert.deepEqual(
    sortBillLines(splitSibling).map((i) => i.bill_line_no),
    [1, 2, 3],
  );

  assert.equal(billLineSortKey(stubItem({ id: 5, bill_line_no: 2 })), 2);
  assert.equal(billLineSortKey(stubItem({ id: 5 })), 5);

  const pasteItems = [
    stubItem({ id: 2, bill_line_no: 2, item_name: 'Beta', qty_requested: 4 }),
    stubItem({ id: 1, bill_line_no: 1, item_name: 'Alpha', qty_requested: 2 }),
  ];
  assert.equal(buildBusyPasteText(pasteItems), 'Alpha\t2\tPcs\nBeta\t4\tPcs');
  assert.equal(
    buildBusyPasteText(pasteItems, { lineEdits: { 2: { qtyRequested: 3 } } }),
    'Alpha\t2\tPcs\nBeta\t3\tPcs',
  );

  const unitPasteItems = [
    stubItem({ id: 2, bill_line_no: 2, item_name: 'Set line', qty_requested: 4, sales_unit: 'set' }),
    stubItem({ id: 1, bill_line_no: 1, item_name: 'Kit line', qty_requested: 2, sales_unit: 'kit' }),
  ];
  assert.equal(
    buildBusyPasteText(unitPasteItems),
    'Kit line\t2\tKit\nSet line\t4\tSet',
  );

  const partialPaste = [
    stubItem({ id: 1, bill_line_no: 1, item_name: 'Split', qty_requested: 2, sales_unit: 'kit' }),
  ];
  assert.equal(
    buildBusyPasteText(partialPaste, {
      flags: { 1: { type: 'partial', availableQty: 1 } },
    }),
    'Split\t1\tKit',
  );

  const withRemoved = [
    stubItem({ id: 1, bill_line_no: 1, item_name: 'Keep', qty_requested: 1 }),
    stubItem({ id: 2, bill_line_no: 2, item_name: 'Drop', qty_requested: 9 }),
    stubItem({ id: 3, bill_line_no: 3, item_name: 'Also keep', qty_requested: 3 }),
  ];
  assert.equal(
    buildBusyPasteText(withRemoved, { lineEdits: { 2: { removed: true } } }),
    'Keep\t1\tPcs\nAlso keep\t3\tPcs',
  );

  const flagItems = [
    stubItem({ id: 10, bill_line_no: 1 }),
    stubItem({ id: 20, bill_line_no: 2 }),
    stubItem({ id: 30, bill_line_no: 3 }),
  ];
  const flags = {
    30: { type: 'no_stock' as const },
    10: { type: 'partial' as const, availableQty: 1 },
  };
  assert.deepEqual(
    sortFlagsByBillLine(flags, flagItems).map(([id]) => id),
    [10, 30],
  );

  console.log('sortBillLines tests passed');
}

runTests();
