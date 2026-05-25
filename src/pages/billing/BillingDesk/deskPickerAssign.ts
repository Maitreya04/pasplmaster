import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import type { PickerLoadInfo } from '../../../hooks/usePickerLoad';

export function canAssignPicker(order: DeskOrderRow): boolean {
  return (
    order.deskStatus === 'unassigned' &&
    order.workflow_status === 'approved' &&
    order.fulfillment_path !== 'direct_bill'
  );
}

export function needsPickerAssignStrip(order: DeskOrderRow): boolean {
  return (
    canAssignPicker(order) ||
    order.deskStatus === 'no_ack' ||
    order.pickingClaimStale
  );
}

export function isPickerReassign(order: DeskOrderRow): boolean {
  return order.deskStatus === 'no_ack' || order.pickingClaimStale;
}

export function findPickerByName(
  pickers: PickerLoadInfo[],
  name: string | null,
): PickerLoadInfo | undefined {
  if (!name?.trim()) return undefined;
  const normalized = name.trim().toLowerCase();
  return pickers.find((p) => p.name.trim().toLowerCase() === normalized);
}

export function sortPickersForAssign(pickers: PickerLoadInfo[]): PickerLoadInfo[] {
  return [...pickers].sort((a, b) => {
    if (a.isBusy !== b.isBusy) return a.isBusy ? 1 : -1;
    return a.activeOrders - b.activeOrders;
  });
}
