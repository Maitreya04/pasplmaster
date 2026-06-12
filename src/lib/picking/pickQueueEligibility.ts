import type { Order, StockLocationCode } from '../../types';

/**
 * Pick queue eligibility for a picker at a given branch.
 * When branch is unknown (legacy session), falls back to Indore-only behavior.
 */
export function isPickQueueEligibleForBranch(
  order: Order,
  pickerBranch: StockLocationCode | null | undefined,
): boolean {
  if (order.fulfillment_path === 'direct_bill') return false;

  if (!pickerBranch) {
    if (order.stock_location_code === 'jabalpur') return false;
    return true;
  }

  return order.stock_location_code === pickerBranch;
}

/** @deprecated Use isPickQueueEligibleForBranch with explicit branch. */
export function isPickQueueEligible(order: Order): boolean {
  return isPickQueueEligibleForBranch(order, 'main_store');
}
