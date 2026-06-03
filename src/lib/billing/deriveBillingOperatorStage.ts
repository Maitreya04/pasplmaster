import type { DeskOrderStatus } from '../../hooks/useBillingDeskOrders';
import { isDeskBillingFinalized } from './deskOrderTab';
import type { FulfillmentPath, StockLocationCode, WorkflowStatus } from '../../types';

export type BillingOperatorStage =
  | 'busy_entry'
  | 'assign_picker'
  | 'picking'
  | 'resolve_flags'
  | 'review_finalise'
  | 'done';

export interface BillingOperatorStageInput {
  workflow_status: WorkflowStatus;
  picker_name?: string | null;
  reviewer_name?: string | null;
  fulfillment_path?: FulfillmentPath | null;
  stock_location_code?: StockLocationCode | null;
  deskStatus?: DeskOrderStatus;
  openPickerFlagCount?: number;
}

export function deriveBillingOperatorStage(
  order: BillingOperatorStageInput,
): BillingOperatorStage {
  const { workflow_status, picker_name, reviewer_name, deskStatus, openPickerFlagCount = 0 } =
    order;

  if (workflow_status === 'submitted') return 'busy_entry';

  if (workflow_status === 'flagged' || openPickerFlagCount > 0) {
    return 'resolve_flags';
  }

  if (workflow_status === 'completed') {
    return isDeskBillingFinalized({
      workflow_status,
      reviewer_name,
      fulfillment_path: order.fulfillment_path,
      stock_location_code: order.stock_location_code,
    })
      ? 'done'
      : 'review_finalise';
  }

  if (workflow_status === 'picking') return 'picking';

  if (workflow_status === 'approved') {
    if (!picker_name?.trim() || deskStatus === 'unassigned') {
      return 'assign_picker';
    }
    return 'picking';
  }

  return 'busy_entry';
}

/** Maps operator stage to the 6-step display bar index (0–5). */
export function billingStageBarIndex(stage: BillingOperatorStage): number {
  switch (stage) {
    case 'busy_entry':
      return 0;
    case 'assign_picker':
      return 1;
    case 'picking':
      return 2;
    case 'resolve_flags':
      return 3;
    case 'review_finalise':
      return 4;
    case 'done':
      return 5;
    default:
      return 0;
  }
}
