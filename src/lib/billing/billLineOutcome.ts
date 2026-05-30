import { pickQuantityTarget, type PickLineQty } from '../cartSupply';
import type { BillingLiveQueueFlag } from './liveQueueDraft';

export type BillLineOutcome = {
  qtyBilled: number;
  qtyPending: number;
  pendingSource: 'billing' | 'sales' | null;
  pendingNote: string | null;
};

/** Post-approve line split — shared by Live Queue approve and pick-target preview. */
export function deriveBillLineOutcome(
  item: PickLineQty,
  approvedQty: number,
  flag: BillingLiveQueueFlag | undefined,
): BillLineOutcome {
  const qtyRequested = Math.max(0, item.qty_requested ?? 0);
  const rawPending = Math.max(
    Math.max(0, item.qty_po ?? 0),
    Math.max(0, qtyRequested - approvedQty),
    flag?.type === 'no_stock' ? qtyRequested : 0,
  );
  const qtyPending = Math.min(qtyRequested, rawPending);
  const qtyBilled =
    flag?.type === 'no_stock'
      ? 0
      : Math.max(0, Math.min(approvedQty, qtyRequested - qtyPending));

  if (qtyPending <= 0) {
    return {
      qtyBilled,
      qtyPending: 0,
      pendingSource: null,
      pendingNote: null,
    };
  }

  return {
    qtyBilled,
    qtyPending,
    pendingSource: flag ? 'billing' : 'sales',
    pendingNote:
      flag?.type === 'no_stock'
        ? 'No stock in Busy — fully pending'
        : flag?.type === 'partial'
          ? `Partial stock — ${qtyBilled} billed, ${qtyPending} pending`
          : 'Purchase order qty from sales checkout',
  };
}

export function billingApprovedQty(
  qtyRequested: number,
  flag: BillingLiveQueueFlag | undefined,
): number {
  if (flag?.type === 'no_stock') return 0;
  if (flag?.type === 'partial' && flag.availableQty != null) {
    return Math.max(0, Math.min(flag.availableQty, qtyRequested));
  }
  return qtyRequested;
}

/** Warehouse pick target after billing writes qty_approved / ship / PO. */
export function effectivePickQuantityAfterBilling(
  item: PickLineQty,
  flag: BillingLiveQueueFlag | undefined,
): number {
  const qtyRequested = Math.max(0, item.qty_requested ?? 0);
  const approvedQty = billingApprovedQty(qtyRequested, flag);
  const outcome = deriveBillLineOutcome(item, approvedQty, flag);
  return pickQuantityTarget({
    qty_requested: qtyRequested,
    qty_shippable: outcome.qtyBilled,
    qty_po: Math.max(0, qtyRequested - outcome.qtyBilled),
    qty_approved: outcome.qtyBilled,
  });
}

export function countEffectivePickLinesAfterBilling(
  items: Array<PickLineQty & { id?: number }>,
  flags: Record<number, BillingLiveQueueFlag>,
): number {
  let count = 0;
  for (const item of items) {
    const id = item.id;
    if (id == null) continue;
    if (effectivePickQuantityAfterBilling(item, flags[id]) > 0) count += 1;
  }
  return count;
}

export function resolveFulfillmentPathAfterBilling(
  requestedPath: 'warehouse_pick' | 'direct_bill',
  stockLocationCode: string | null | undefined,
  pickLineCount: number,
): 'warehouse_pick' | 'direct_bill' {
  if (stockLocationCode === 'jabalpur') return 'direct_bill';
  if (pickLineCount <= 0) return 'direct_bill';
  return requestedPath;
}
