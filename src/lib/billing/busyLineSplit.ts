import { billingApprovedQty } from './billLineOutcome';
import type { BillingLineEdit, BillingLiveQueueFlag } from './liveQueueDraft';
import type { OrderItem } from '../../types';

export function effectiveBusyQtyRequested(
  item: OrderItem,
  lineEdit?: BillingLineEdit,
): number {
  return lineEdit?.qtyRequested ?? item.qty_requested;
}

/** Units to enter in Busy today (respects partial / no-stock flags). */
export function busyBillableQty(
  item: OrderItem,
  flag: BillingLiveQueueFlag | undefined,
  lineEdit?: BillingLineEdit,
): number {
  const requested = effectiveBusyQtyRequested(item, lineEdit);
  return billingApprovedQty(requested, flag);
}

/** Units deferred to the pending queue (remainder after today's bill). */
export function busyPendingQty(
  item: OrderItem,
  flag: BillingLiveQueueFlag | undefined,
  lineEdit?: BillingLineEdit,
): number {
  const requested = effectiveBusyQtyRequested(item, lineEdit);
  const billable = busyBillableQty(item, flag, lineEdit);
  return Math.max(0, requested - billable);
}

/** Entire line is pending — nothing to paste in Busy today. */
export function isFullyPendingBusyLine(flag: BillingLiveQueueFlag | undefined): boolean {
  if (!flag) return false;
  if (flag.type === 'no_stock') return true;
  if (flag.type === 'partial') {
    const available = flag.availableQty;
    return available == null || available <= 0;
  }
  return false;
}

export function isBusyBillableLine(
  item: OrderItem,
  flag: BillingLiveQueueFlag | undefined,
  lineEdit?: BillingLineEdit,
): boolean {
  return busyBillableQty(item, flag, lineEdit) > 0;
}

export function countBusyBillableLines(
  items: OrderItem[],
  flags: Record<number, BillingLiveQueueFlag>,
  lineEdits?: Record<number, BillingLineEdit>,
): number {
  return items.filter((item) => {
    if (lineEdits?.[item.id]?.removed) return false;
    return isBusyBillableLine(item, flags[item.id], lineEdits?.[item.id]);
  }).length;
}

export function countFullyPendingBusyLines(
  items: OrderItem[],
  flags: Record<number, BillingLiveQueueFlag>,
  lineEdits?: Record<number, BillingLineEdit>,
): number {
  return items.filter((item) => {
    if (lineEdits?.[item.id]?.removed) return false;
    return isFullyPendingBusyLine(flags[item.id]);
  }).length;
}
