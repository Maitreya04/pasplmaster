import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';

export type DeskStaleCompleteKind = 'stale_pick' | 'skip_pick';

export function getDeskStaleCompleteKind(
  order: DeskOrderRow,
): DeskStaleCompleteKind | null {
  if (
    order.workflow_status === 'picking' &&
    order.pickingClaimStale
  ) {
    return 'stale_pick';
  }
  if (
    order.workflow_status === 'approved' &&
    !order.picker_name &&
    order.fulfillment_path !== 'direct_bill'
  ) {
    return 'skip_pick';
  }
  return null;
}

export function canDeskStaleComplete(order: DeskOrderRow): boolean {
  return getDeskStaleCompleteKind(order) != null;
}

export function deskStaleCompleteLabel(kind: DeskStaleCompleteKind): string {
  return kind === 'skip_pick' ? 'Skip pick' : 'Complete';
}

export function deskStaleCompleteConfirmTitle(kind: DeskStaleCompleteKind): string {
  return kind === 'skip_pick'
    ? 'Complete without warehouse pick?'
    : 'Complete stale pick?';
}

export function deskStaleCompleteConfirmBody(
  order: DeskOrderRow,
  kind: DeskStaleCompleteKind,
): string {
  if (kind === 'skip_pick') {
    return 'Mark this order complete and bill directly — it will leave the pick queue.';
  }
  const who = order.picker_name ? `${order.picker_name}'s session has gone stale. ` : '';
  return `${who}Mark complete only if warehouse picking is finished.`;
}
