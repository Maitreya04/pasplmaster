import { orderSkipsDeskBillReview, type DeskOrderTabFields } from './deskOrderTab';
import type { FulfillmentPath } from '../../types';

export type PostPickBillingClaimInput = DeskOrderTabFields & {
  fulfillment_path?: FulfillmentPath | null;
  picking_completed_at?: string | null;
};

/** Warehouse-pick orders awaiting desk resolve/finalise need a billing claim. */
export function needsPostPickBillingClaim(order: PostPickBillingClaimInput): boolean {
  if (order.fulfillment_path !== 'warehouse_pick') return false;
  if (!order.picking_completed_at) return false;
  if (order.reviewer_name?.trim()) return false;
  if (order.workflow_status !== 'flagged' && order.workflow_status !== 'completed') {
    return false;
  }
  return !orderSkipsDeskBillReview(order);
}

export type DeskOrderClaimGateInput = {
  claim_info: {
    is_stale: boolean;
    claimed_by_name: string;
  } | null;
  is_mine: boolean;
};

/** Mirror Live Queue rowSelectable — block opening when another person holds a fresh claim. */
export function canOpenDeskOrder(order: DeskOrderClaimGateInput): boolean {
  if (!order.claim_info || order.claim_info.is_stale) return true;
  return order.is_mine;
}

export function deskOrderClaimBlockedBy(order: DeskOrderClaimGateInput): string | null {
  if (canOpenDeskOrder(order)) return null;
  return order.claim_info?.claimed_by_name ?? null;
}

export function showPostPickBillingClaimBadge(
  order: PostPickBillingClaimInput & { claim_info: unknown },
): boolean {
  if (!order.claim_info) return false;
  return (
    order.workflow_status === 'flagged' ||
    needsPostPickBillingClaim(order) ||
    (order.workflow_status === 'completed' && !order.reviewer_name?.trim())
  );
}
