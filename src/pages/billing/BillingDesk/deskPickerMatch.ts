import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import type { PickerLoadInfo } from '../../../hooks/usePickerLoad';

export interface PickerDeskStats {
  activeCount: number;
  completedToday: number;
}

export function orderBelongsToPicker(
  order: DeskOrderRow,
  picker: PickerLoadInfo,
): boolean {
  const pickerName = picker.name.trim().toLowerCase();
  const orderPicker = order.picker_name?.trim().toLowerCase();
  const claimName = order.claim_info?.claimed_by_name?.trim().toLowerCase();
  return orderPicker === pickerName || claimName === pickerName;
}

export function isPickerActiveDeskOrder(order: DeskOrderRow): boolean {
  return (
    order.deskStatus === 'picking' ||
    order.deskStatus === 'no_ack' ||
    (order.deskStatus === 'unassigned' && Boolean(order.picker_name))
  );
}

export function isPickerCompletedDeskOrder(order: DeskOrderRow): boolean {
  return order.deskStatus === 'checking' || order.workflow_status === 'completed';
}

export function computePickerDeskStats(
  orders: DeskOrderRow[],
  picker: PickerLoadInfo,
): PickerDeskStats {
  let activeCount = 0;
  let completedToday = 0;
  for (const order of orders) {
    if (!orderBelongsToPicker(order, picker)) continue;
    if (isPickerActiveDeskOrder(order)) activeCount++;
    if (isPickerCompletedDeskOrder(order)) completedToday++;
  }
  return { activeCount, completedToday };
}

export function filterDeskOrdersByPicker(
  orders: DeskOrderRow[],
  picker: PickerLoadInfo | null,
): DeskOrderRow[] {
  if (!picker) return orders;
  return orders.filter((o) => orderBelongsToPicker(o, picker));
}
