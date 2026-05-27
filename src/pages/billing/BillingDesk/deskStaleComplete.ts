import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';

export type DeskStaleCompleteKind = 'stale_pick' | 'skip_pick';

function canSkipWarehousePick(order: DeskOrderRow): boolean {
  return (
    order.workflow_status === 'approved' &&
    order.fulfillment_path !== 'direct_bill'
  );
}

export function getDeskStaleCompleteKind(
  order: DeskOrderRow,
): DeskStaleCompleteKind | null {
  if (
    order.workflow_status === 'picking' &&
    order.pickingClaimStale
  ) {
    return 'stale_pick';
  }
  if (canSkipWarehousePick(order)) {
    return 'skip_pick';
  }
  return null;
}

export function canDeskStaleComplete(order: DeskOrderRow): boolean {
  return getDeskStaleCompleteKind(order) != null;
}

export function deskStaleCompleteLabel(
  kind: DeskStaleCompleteKind,
  order: DeskOrderRow,
): string {
  if (kind === 'stale_pick') return 'Complete';
  return order.picker_name ? 'Complete' : 'Skip pick';
}

export function deskStaleCompleteConfirmTitle(
  kind: DeskStaleCompleteKind,
  order: DeskOrderRow,
): string {
  if (kind === 'stale_pick') return 'Complete stale pick?';
  if (order.picker_name) return 'Complete without warehouse pick?';
  return 'Skip warehouse pick?';
}

export function deskStaleCompleteConfirmBody(
  order: DeskOrderRow,
  kind: DeskStaleCompleteKind,
): string {
  if (kind === 'skip_pick') {
    if (order.picker_name) {
      const who = order.picker_name.split(/\s+/)[0] ?? order.picker_name;
      return `${who} has not started picking. Mark complete and bill directly — the order leaves the pick queue.`;
    }
    return 'Mark this order complete and bill directly — it will leave the pick queue.';
  }
  const who = order.picker_name ? `${order.picker_name}'s session has gone stale. ` : '';
  return `${who}Mark complete only if warehouse picking is finished.`;
}

export function deskStaleCompleteTooltip(
  kind: DeskStaleCompleteKind,
  order: DeskOrderRow,
): string {
  if (kind === 'stale_pick') {
    return 'Mark pick complete — picker session is stale';
  }
  if (order.picker_name) {
    return 'Complete without warehouse pick — assigned picker never started';
  }
  return 'Bill directly — skip warehouse picking';
}
