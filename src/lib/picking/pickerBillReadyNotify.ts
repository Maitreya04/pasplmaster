import type { FulfillmentPath, WorkflowStatus } from '../../types';

export type PickerBillReadyNotifyInput = {
  fulfillment_path?: FulfillmentPath | null;
  picking_completed_at?: string | null;
  workflow_status: WorkflowStatus;
};

/** Notify picker after post-pick Save & Bill on warehouse-pick orders. */
export function shouldNotifyPickerBillReady(order: PickerBillReadyNotifyInput): boolean {
  if (order.fulfillment_path !== 'warehouse_pick') return false;
  if (!order.picking_completed_at) return false;
  return order.workflow_status === 'flagged' || order.workflow_status === 'completed';
}
