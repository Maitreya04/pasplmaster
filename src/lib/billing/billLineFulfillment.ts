import { pickQuantityTarget, shippableCapForPick, type PickLineQty } from '../cartSupply';
import { deskLineFlagKind } from './deskLineFlagKind';
import { isFocOrderItem } from '../specialPricing';
import type { OrderItem, PendingItem } from '../../types';

export type BillLineRole =
  | 'ship_today'
  | 'foc'
  | 'sales_po'
  | 'picker_oos'
  | 'billing_oos'
  | 'mixed';

export type BillLineFulfillment = {
  role: BillLineRole;
  /** Short chip label shown on the row. */
  chipLabel: string;
  /** Chip color token — maps to CSS in BillLineRow. */
  chipTone: 'green' | 'blue' | 'amber' | 'red' | 'muted';
  /** Human-readable one-liner for billing. */
  summary: string;
  qtyOrdered: number;
  qtyBillToday: number;
  qtySalesPo: number;
  qtyPickerOos: number;
  /** True when this row should not be keyed into Busy as a sale line today. */
  excludeFromBusyBill: boolean;
  isMrpSplit: boolean;
};

function pickerPendingQty(rows: PendingItem[]): number {
  return rows
    .filter((r) => r.status === 'pending' && r.source === 'picking')
    .reduce((sum, r) => sum + Math.max(0, r.qty_pending), 0);
}

function salesPendingQty(rows: PendingItem[]): number {
  return rows
    .filter((r) => r.status === 'pending' && r.source === 'sales')
    .reduce((sum, r) => sum + Math.max(0, r.qty_pending), 0);
}

/**
 * Classify a warehouse bill row for the billing review screen.
 * Separates: ship-today, sales PO backlog, picker OOS, FOC, and MRP splits.
 */
export function deriveBillLineFulfillment(
  item: OrderItem,
  pendingRowsForItem: PendingItem[] = [],
): BillLineFulfillment {
  const qtyOrdered = Math.max(0, item.qty_requested ?? 0);
  const qtyPoOnLine = Math.max(0, item.qty_po ?? 0);
  const shipCap = shippableCapForPick(item);
  const pickTarget = pickQuantityTarget(item);
  const isFoc = isFocOrderItem(item);
  const isMrpSplit = item.split_from_id != null;
  const flagKind = deskLineFlagKind(item.flag_reason);
  const pickerPending = pickerPendingQty(pendingRowsForItem);
  const salesPending = salesPendingQty(pendingRowsForItem);

  const base = {
    qtyOrdered,
    isMrpSplit,
  };

  if (flagKind === 'oos') {
    const isBillingOos = item.flag_reason === 'Out of Stock (Billing)';
    const oosQty = Math.max(pickTarget, pickerPending, qtyOrdered);
    return {
      ...base,
      role: isBillingOos ? 'billing_oos' : 'picker_oos',
      chipLabel: isBillingOos ? 'OOS · billing' : 'OOS · picker',
      chipTone: 'red',
      summary: isBillingOos
        ? `${oosQty} pcs marked no stock at billing — do not bill`
        : `${oosQty} pcs picker could not find — do not bill`,
      qtyBillToday: 0,
      qtySalesPo: 0,
      qtyPickerOos: oosQty,
      excludeFromBusyBill: true,
    };
  }

  if (isFoc) {
    const qtyBill = item.state === 'picked' || item.state === 'overridden' ? qtyOrdered : 0;
    return {
      ...base,
      role: 'foc',
      chipLabel: 'FOC',
      chipTone: 'blue',
      summary: `${qtyOrdered} pcs free of charge — bill at ₹0 in Busy`,
      qtyBillToday: qtyBill,
      qtySalesPo: 0,
      qtyPickerOos: 0,
      excludeFromBusyBill: false,
    };
  }

  // Entire line was PO at sales checkout — never entered the pick queue.
  if (shipCap === 0 && qtyPoOnLine >= qtyOrdered && qtyOrdered > 0) {
    const poQty = Math.max(qtyPoOnLine, salesPending);
    return {
      ...base,
      role: 'sales_po',
      chipLabel: 'PO · sales',
      chipTone: 'amber',
      summary: `${poQty} pcs were out of stock when sales ordered — pending PO, not billing today`,
      qtyBillToday: 0,
      qtySalesPo: poQty,
      qtyPickerOos: 0,
      excludeFromBusyBill: true,
    };
  }

  // Mixed: part ships today, part was PO at checkout (same row).
  if (qtyPoOnLine > 0 && shipCap > 0) {
    const billQty =
      item.state === 'picked' || item.state === 'overridden'
        ? Math.min(qtyOrdered, shipCap)
        : Math.min(qtyOrdered - qtyPoOnLine, shipCap);
    return {
      ...base,
      role: 'mixed',
      chipLabel: 'Partial PO',
      chipTone: 'amber',
      summary: `Bill ${billQty} pcs today · ${qtyPoOnLine} pcs on sales PO (not shipping)`,
      qtyBillToday: billQty,
      qtySalesPo: qtyPoOnLine,
      qtyPickerOos: 0,
      excludeFromBusyBill: false,
    };
  }

  // Picker marked partial OOS via pending_items while line shows picked (edge case).
  if (pickerPending > 0 && (item.state === 'picked' || item.state === 'overridden')) {
    const billQty = Math.max(0, qtyOrdered - pickerPending);
    return {
      ...base,
      role: 'mixed',
      chipLabel: 'Partial OOS',
      chipTone: 'red',
      summary: `Bill ${billQty} pcs today · ${pickerPending} pcs picker marked out of stock`,
      qtyBillToday: billQty,
      qtySalesPo: 0,
      qtyPickerOos: pickerPending,
      excludeFromBusyBill: false,
    };
  }

  const isWarehousePicked =
    item.state === 'picked' || item.state === 'overridden';
  const qtyBill = isWarehousePicked ? qtyOrdered : pickTarget;

  return {
    ...base,
    role: 'ship_today',
    chipLabel: isMrpSplit ? 'Bill · batch' : 'Bill today',
    chipTone: 'green',
    summary: isWarehousePicked
      ? isMrpSplit
        ? `${qtyBill} pcs picked (MRP batch) — enter in Busy`
        : `${qtyBill} pcs picked — enter in Busy`
      : isMrpSplit
        ? `${qtyBill} pcs to pick (MRP batch) when scanned`
        : `${qtyBill} pcs to pick today — not scanned yet`,
    qtyBillToday: qtyBill,
    qtySalesPo: 0,
    qtyPickerOos: 0,
    excludeFromBusyBill: false,
  };
}

export type BillFulfillmentTotals = {
  billTodayLines: number;
  billTodayQty: number;
  focQty: number;
  salesPoQty: number;
  pickerOosQty: number;
  billingOosQty: number;
  busyBillLines: number;
};

export function summarizeBillFulfillment(
  items: OrderItem[],
  pendingByItemId: Map<number, PendingItem[]>,
): BillFulfillmentTotals {
  let billTodayLines = 0;
  let billTodayQty = 0;
  let focQty = 0;
  let salesPoQty = 0;
  let pickerOosQty = 0;
  let billingOosQty = 0;
  let busyBillLines = 0;

  for (const item of items) {
    const pending = item.item_id != null ? pendingByItemId.get(item.item_id) ?? [] : [];
    const f = deriveBillLineFulfillment(item, pending);
    if (f.qtyBillToday > 0) {
      billTodayLines += 1;
      billTodayQty += f.qtyBillToday;
    }
    if (f.role === 'foc') focQty += f.qtyOrdered;
    salesPoQty += f.qtySalesPo;
    pickerOosQty += f.qtyPickerOos;
    if (f.role === 'billing_oos') billingOosQty += f.qtyPickerOos;
    if (!f.excludeFromBusyBill && f.qtyBillToday > 0) busyBillLines += 1;
  }

  return {
    billTodayLines,
    billTodayQty,
    focQty,
    salesPoQty,
    pickerOosQty,
    billingOosQty,
    busyBillLines,
  };
}

/** Qty multiplier for line total — bill only what ships today, not PO backlog. */
export function billableQtyForTotal(item: PickLineQty, fulfillment: BillLineFulfillment): number {
  if (fulfillment.excludeFromBusyBill) return 0;
  if (fulfillment.qtyBillToday > 0) return fulfillment.qtyBillToday;
  return Math.max(0, item.qty_requested ?? 0);
}
