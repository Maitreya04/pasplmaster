import type { FulfillmentPath, StockLocationCode, WorkflowStatus } from '../../types';

export type DeskOrderTabFields = {
  workflow_status: WorkflowStatus;
  reviewer_name?: string | null;
  fulfillment_path?: FulfillmentPath | null;
  stock_location_code?: StockLocationCode | null;
};

/** Direct-bill / Jabalpur orders skip post-pick desk review. */
export function orderSkipsDeskBillReview(order: DeskOrderTabFields): boolean {
  if (order.fulfillment_path === 'direct_bill') return true;
  if (order.stock_location_code === 'jabalpur') return true;
  return false;
}

/** Completed orders that belong on the Desk Completed tab. */
export function isDeskBillingFinalized(order: DeskOrderTabFields): boolean {
  if (order.workflow_status !== 'completed') return false;
  if (order.reviewer_name?.trim()) return true;
  return orderSkipsDeskBillReview(order);
}

/** Completed orders awaiting desk bill verification. */
export function needsDeskBillReview(order: DeskOrderTabFields): boolean {
  return order.workflow_status === 'completed' && !isDeskBillingFinalized(order);
}
