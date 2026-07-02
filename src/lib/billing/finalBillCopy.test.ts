import assert from 'node:assert/strict';
import {
  buildFinalBillCopyRows,
  buildFinalBillPasteText,
  busyPasteItemName,
  finalBillCopyTotals,
  resolveBusyPasteMrp,
} from './finalBillCopy';
import type { OrderItem, PendingItem } from '../../types';
import type { OverlayLineEdit } from '../../pages/billing/BillingDesk/types';

function stubItem(partial: Partial<OrderItem> & Pick<OrderItem, 'id'>): OrderItem {
  return {
    order_id: 1,
    item_id: partial.item_id ?? partial.id,
    item_name: partial.item_name ?? `Item ${partial.id}`,
    item_alias: null,
    rack_no: null,
    qty_requested: partial.qty_requested ?? 1,
    qty_shippable: partial.qty_shippable ?? partial.qty_requested ?? 1,
    qty_po: partial.qty_po ?? 0,
    qty_approved: partial.qty_approved ?? partial.qty_requested ?? 1,
    price_quoted: partial.price_quoted ?? 100,
    price_system: partial.price_system ?? 100,
    state: partial.state ?? 'picked',
    flag_reason: partial.flag_reason ?? null,
    flag_notes: partial.flag_notes ?? null,
    flag_box_price: partial.flag_box_price ?? null,
    scan_result: partial.scan_result ?? null,
    ...partial,
  };
}

function edit(item: OrderItem, patch: Partial<OverlayLineEdit> = {}): OverlayLineEdit {
  return {
    priceQuoted: item.price_quoted ?? item.price_system ?? 0,
    salesUnit: item.sales_unit ?? 'pcs',
    removed: false,
    priceTouched: false,
    resolution: null,
    ...patch,
  };
}

function pending(item: OrderItem, qty: number): PendingItem {
  return {
    id: item.id + 100,
    order_id: item.order_id,
    order_number: 'SO-1',
    customer_id: 1,
    customer_name: 'Customer',
    item_id: item.item_id,
    item_name: item.item_name,
    qty_pending: qty,
    source: 'picking',
    created_by: 'Picker',
    created_at: new Date(0).toISOString(),
    note: 'Picker short',
    status: 'pending',
    recovery_status: 'waiting_stock',
    back_in_stock_at: null,
    recovery_reviewed_at: null,
    recovery_reviewed_by: null,
    resolved_at: null,
    resolved_by: null,
  };
}

function runTests(): void {
  const alpha = stubItem({
    id: 1,
    bill_line_no: 1,
    item_name: 'USHA2 Alpha Widget',
    catalog_alias1: 'USHA2',
    catalog_busy_code: 1001,
    qty_requested: 5,
  });
  const setLine = stubItem({
    id: 2,
    bill_line_no: 2,
    item_name: 'Set line',
    catalog_busy_code: 1002,
    qty_requested: 2,
    sales_unit: 'set',
    price_quoted: 120,
  });
  const unresolvedOos = stubItem({
    id: 3,
    bill_line_no: 3,
    item_name: 'Missing',
    qty_requested: 4,
    state: 'flagged',
    flag_reason: 'Out of Stock',
  });
  const shortLine = stubItem({
    id: 4,
    bill_line_no: 4,
    item_name: 'Short line',
    catalog_busy_code: 1004,
    qty_requested: 3,
    scan_result: {
      scannedText: 'PRICE_GROUP',
      confidence: 100,
      isMatch: true,
      matchedAgainst: 'SHORT',
      matchStrategy: 'price_group',
      ocrExtracted: { partNumber: null, mrp: 90 },
      method: 'manual',
      timestamp: new Date(0).toISOString(),
      progress: { pickedQty: 3, remainingQty: 2, targetQty: 5 },
      originalTargetQty: 5,
      isShortPick: true,
      shortQty: 2,
      shortReason: "Can't Find",
      pickerNote: 'Only 3 on shelf',
      suggestedMrpAtPick: 504,
    },
  });
  const removed = stubItem({ id: 5, bill_line_no: 5, item_name: 'Removed', qty_requested: 9 });
  const over = stubItem({
    id: 6,
    bill_line_no: 6,
    item_name: 'Over line',
    catalog_busy_code: 1006,
    qty_requested: 9,
    price_quoted: 80,
    scan_result: {
      scannedText: 'PRICE_GROUP',
      confidence: 100,
      isMatch: true,
      matchedAgainst: 'OVER',
      matchStrategy: 'price_group',
      ocrExtracted: { partNumber: null, mrp: 80 },
      method: 'manual',
      timestamp: new Date(0).toISOString(),
      progress: { pickedQty: 9, remainingQty: 0, targetQty: 3 },
      originalTargetQty: 3,
      isOverTarget: true,
      overTargetQty: 6,
      pickerNote: 'Standard packing',
    },
  });

  assert.equal(
    busyPasteItemName(alpha),
    'USHA2 Alpha Widget',
    'paste uses full item_name, not stripped display name',
  );

  const items = [removed, shortLine, unresolvedOos, setLine, over, alpha];
  const edits: Record<number, OverlayLineEdit> = Object.fromEntries(
    items.map((item) => [item.id, edit(item)]),
  );
  edits[5] = edit(removed, { removed: true });

  const pendingByItemId = new Map<number, PendingItem[]>([
    [shortLine.item_id, [pending(shortLine, 2)]],
  ]);

  const rows = buildFinalBillCopyRows({
    sortedLines: items,
    edits,
    pendingByItemId,
    flaggedItems: [unresolvedOos],
  });

  assert.deepEqual(
    rows.map((row) => row.pasteName),
    ['USHA2 Alpha Widget', 'Set line', 'Short line', 'Over line'],
  );
  assert.equal(
    buildFinalBillPasteText(rows),
    'USHA2 Alpha Widget\t5\t\t100\nSet line\t2\tSet\t120\nShort line\t3\t\t504\nOver line\t9\t\t80',
  );
  assert.equal(rows.find((row) => row.item.id === shortLine.id)?.pasteMrp, 504);
  assert.equal(rows.find((row) => row.item.id === shortLine.id)?.mrpSource, 'stock_at_pick');

  const labelMrpLine = stubItem({
    id: 7,
    bill_line_no: 7,
    item_name: 'Label MRP line',
    catalog_busy_code: 1007,
    qty_requested: 2,
    price_quoted: 200,
    price_system: 200,
    confirmed_mrp: 181,
  });
  const labelMrpRows = buildFinalBillCopyRows({
    sortedLines: [labelMrpLine],
    edits: {
      [labelMrpLine.id]: edit(labelMrpLine, {
        priceQuoted: 181,
        priceTouched: true,
        resolution: 'accept_price',
      }),
    },
    pendingByItemId: new Map(),
    flaggedItems: [],
  });
  assert.equal(buildFinalBillPasteText(labelMrpRows), 'Label MRP line\t2\t\t181');
  assert.equal(labelMrpRows[0]?.mrpSource, 'confirmed_mrp');

  const focLine = stubItem({
    id: 8,
    bill_line_no: 8,
    item_name: 'FOC gift',
    catalog_busy_code: 1008,
    qty_requested: 1,
    is_foc: true,
    price_quoted: 0,
  });
  const focRows = buildFinalBillCopyRows({
    sortedLines: [focLine],
    edits: { [focLine.id]: edit(focLine, { priceQuoted: 0 }) },
    pendingByItemId: new Map(),
    flaggedItems: [],
  });
  assert.equal(buildFinalBillPasteText(focRows), 'FOC gift\t1\t\t0');
  assert.equal(focRows[0]?.mrpSource, 'foc');

  assert.deepEqual(resolveBusyPasteMrp(alpha, edit(alpha), false), {
    mrp: 100,
    source: 'quoted_fallback',
  });

  assert.equal(rows.find((row) => row.item.id === shortLine.id)?.qty, 3);
  assert.equal(rows.find((row) => row.item.id === shortLine.id)?.status, 'Short pick');
  assert.equal(rows.find((row) => row.item.id === over.id)?.status, 'Overpick');
  assert.deepEqual(finalBillCopyTotals(rows), {
    lineCount: 4,
    qtyTotal: 19,
    valueTotal: 5 * 100 + 2 * 120 + 3 * 100 + 9 * 80,
  });

  console.log('finalBillCopy tests passed');
}

runTests();
