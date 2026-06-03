import {
  isDeskBillingFinalized,
  needsDeskBillReview,
} from './deskOrderTab';
import type { FulfillmentPath, StockLocationCode, WorkflowStatus } from '../../types';

export type DeskOrderTab = 'assign' | 'picking' | 'resolve' | 'completed';

export type DeskOrderStatus =
  | 'picking'
  | 'checking'
  | 'no_ack'
  | 'unassigned'
  | 'submitted'
  | 'flagged';

export type DeskPickerFlagLine = {
  orderItemId: number;
  itemName: string;
  flagReason: string | null;
};

export type DeskQueueOrder = {
  workflow_status: WorkflowStatus;
  deskStatus: DeskOrderStatus;
  pickerFlags: DeskPickerFlagLine[];
  pickingClaimStale: boolean;
  claim_info?: { is_stale?: boolean } | null;
  picker_name?: string | null;
  fulfillment_path?: FulfillmentPath | null;
  stock_location_code?: StockLocationCode | null;
  reviewer_name?: string | null;
};

/** Picker line flags or order-level flagged workflow — opens flag-aware bill sheet. */
export function orderHasDeskPickerFlags(
  order: Pick<DeskQueueOrder, 'deskStatus' | 'pickerFlags'>,
): boolean {
  return order.deskStatus === 'flagged' || order.pickerFlags.length > 0;
}

/** Resolve queue — completed picks waiting for billing action; active picks stay on Picking. */
export function orderBelongsOnDeskResolveTab(
  order: Pick<
    DeskQueueOrder,
    | 'deskStatus'
    | 'pickerFlags'
    | 'workflow_status'
    | 'reviewer_name'
    | 'fulfillment_path'
    | 'stock_location_code'
  >,
): boolean {
  if (order.workflow_status === 'picking') return false;
  if (order.workflow_status === 'flagged') return true;
  if (order.workflow_status !== 'completed') return false;
  if (orderHasDeskPickerFlags(order)) return true;
  return needsDeskBillReview(order);
}

export function isDeskOrderStale(order: DeskQueueOrder): boolean {
  if (order.deskStatus === 'checking') return false;
  if (order.pickingClaimStale) return true;
  if (order.deskStatus === 'no_ack') return true;
  if (order.claim_info?.is_stale) return true;
  return false;
}

export function isAssignTabOrder(order: DeskQueueOrder): boolean {
  if (orderBelongsOnDeskResolveTab(order)) return false;
  return order.workflow_status === 'approved' && !order.picker_name?.trim();
}

export function isPickingTabOrder(order: DeskQueueOrder): boolean {
  if (orderBelongsOnDeskResolveTab(order)) return false;
  if (order.workflow_status === 'picking') return true;
  return order.workflow_status === 'approved' && Boolean(order.picker_name?.trim());
}

export function filterDeskOrdersByTab<T extends DeskQueueOrder>(
  orders: T[],
  tab: DeskOrderTab,
): T[] {
  if (tab === 'resolve') {
    return orders.filter((o) => orderBelongsOnDeskResolveTab(o));
  }
  if (tab === 'assign') {
    return orders.filter(isAssignTabOrder);
  }
  if (tab === 'picking') {
    return orders.filter(isPickingTabOrder);
  }
  return orders.filter(
    (o) => !orderBelongsOnDeskResolveTab(o) && isDeskBillingFinalized(o),
  );
}
