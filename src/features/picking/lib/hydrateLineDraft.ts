import { pickQuantityTarget } from '../../../lib/cartSupply';
import { pickMrpGroupForItem } from '../../../lib/billing/pickMrpBillingContext';
import { orderItemConfirmedMrp } from '../../../lib/billing/orderItemSplitGroups';
import type { ConfirmedPriceGroup, LineDraft, OrderItem } from '../../../types';
import { createLineDraft } from '../hooks/usePickEntryDraft';

export type LineCompletionStatus = 'picked' | 'partial' | 'flagged';

function lineSegmentQty(item: OrderItem): number {
  const shippable = item.qty_shippable;
  if (shippable != null && shippable > 0) return Math.max(0, Math.floor(shippable));
  return Math.max(0, Math.floor(item.qty_requested ?? 0));
}

function hasCommittedPickSegment(item: OrderItem): boolean {
  if (lineSegmentQty(item) <= 0) return false;
  return (
    item.scan_result?.matchStrategy === 'price_group' ||
    item.confirmed_mrp != null ||
    item.scan_result?.confirmedMrp != null ||
    item.state === 'picked' ||
    item.state === 'overridden'
  );
}

function originalTargetFromGroup(root: OrderItem, siblings: OrderItem[]): number | null {
  let best: number | null = null;
  for (const row of [root, ...siblings]) {
    const target = row.scan_result?.progress?.targetQty;
    if (target != null && target > 0) {
      const rounded = Math.floor(target);
      best = best == null ? rounded : Math.max(best, rounded);
    }
  }
  return best;
}

function requestedTargetQty(item: OrderItem): number {
  const requested = Number(item.qty_requested ?? 0);
  if (Number.isFinite(requested) && requested > 0) return Math.floor(requested);
  return pickQuantityTarget(item);
}

function segmentRows(root: OrderItem, siblings: OrderItem[]): OrderItem[] {
  const rows: OrderItem[] = [];
  if (hasCommittedPickSegment(root)) rows.push(root);
  for (const sibling of siblings) {
    if (hasCommittedPickSegment(sibling)) rows.push(sibling);
  }
  return rows;
}

function groupToConfirmedPriceGroup(row: OrderItem, targetQty: number): ConfirmedPriceGroup | null {
  const mrp = orderItemConfirmedMrp(row);
  const qty = lineSegmentQty(row);
  if (mrp == null || qty <= 0) return null;

  const loggedTotal = row.scan_result?.progress?.pickedQty;
  const isOverTarget =
    row.scan_result?.isOverTarget === true ||
    (loggedTotal != null && loggedTotal > targetQty);

  return {
    id: `server-${row.id}`,
    orderItemId: row.id,
    mrp,
    qty,
    isOverTarget,
    pickerNote: row.scan_result?.pickerNote ?? null,
  };
}

/** Rebuild picker draft for one sales line from committed order_items rows (incl. MRP splits). */
export function buildLineDraftFromOrderItem(item: OrderItem, allItems: OrderItem[]): LineDraft {
  const { root, siblings } = pickMrpGroupForItem(item, allItems);
  const billingTarget = requestedTargetQty(root);
  const persistedTarget = originalTargetFromGroup(root, siblings);
  const targetQty = persistedTarget ?? billingTarget;

  const confirmedGroups = segmentRows(root, siblings)
    .map((row) => groupToConfirmedPriceGroup(row, targetQty))
    .filter((group): group is ConfirmedPriceGroup => group != null);

  return createLineDraft({
    rootOrderItemId: root.id,
    targetQty,
    uom: root.sales_unit ?? 'pcs',
    confirmedGroups,
  });
}

export function sumLineDraftLogged(draft: LineDraft): number {
  return draft.confirmedGroups.reduce((sum, group) => sum + group.qty, 0);
}

/** Infer whether a queue line was picked, partially logged, or flagged. */
export function deriveLineCompletionStatus(
  item: OrderItem,
  allItems: OrderItem[],
): LineCompletionStatus | null {
  const { root, siblings } = pickMrpGroupForItem(item, allItems);

  if (root.state === 'flagged' || siblings.some((row) => row.state === 'flagged')) {
    return 'flagged';
  }

  const draft = buildLineDraftFromOrderItem(item, allItems);
  const totalLogged = sumLineDraftLogged(draft);

  if (totalLogged === 0) {
    if (root.state === 'picked' || root.state === 'overridden') return 'picked';
    return null;
  }

  if (totalLogged >= draft.targetQty) return 'picked';

  const progress = root.scan_result?.progress;
  if (
    progress != null &&
    progress.remainingQty > 0 &&
    root.scan_result?.isShortPick !== true &&
    !siblings.some((row) => row.scan_result?.isShortPick === true)
  ) {
    return null;
  }

  return 'partial';
}

export function deriveCompletedLinesFromOrder(
  pickItems: OrderItem[],
  allItems: OrderItem[],
): Record<number, LineCompletionStatus> {
  const completed: Record<number, LineCompletionStatus> = {};
  for (const item of pickItems) {
    const status = deriveLineCompletionStatus(item, allItems);
    if (status) completed[item.id] = status;
  }
  return completed;
}
