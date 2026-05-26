import type { OrderWithClaimInfo } from '../../hooks/useClaimableOrders';
import type { WorkflowStatus } from '../../types';

export function isPickStarted(workflowStatus: WorkflowStatus | string): boolean {
  return workflowStatus === 'picking';
}

/** Assigned by billing or self-claimed, waiting for explicit Start. */
export function isAssignedPendingStart(order: OrderWithClaimInfo): boolean {
  return order.workflow_status === 'approved' && Boolean(order.claim_info ?? order.picker_name);
}

export function isMyAssignedPending(
  order: OrderWithClaimInfo,
  userName: string | null,
): boolean {
  if (!isAssignedPendingStart(order)) return false;
  return isAssignedToMe(order, userName);
}

export type ActivePickStatus = 'not_started' | 'picking' | 'almost_done' | 'stale';

export function activePickStatus(
  order: OrderWithClaimInfo,
  progressRatio: number,
): ActivePickStatus {
  if (isPickStarted(order.workflow_status)) {
    if (!order.claim_info || order.claim_info.is_stale) {
      return 'stale';
    }
  }
  if (!isPickStarted(order.workflow_status)) {
    return 'not_started';
  }
  if (progressRatio >= 0.8) {
    return 'almost_done';
  }
  return 'picking';
}

export function activePickStatusLabel(status: ActivePickStatus): string {
  switch (status) {
    case 'not_started':
      return 'Not started';
    case 'almost_done':
      return 'Almost done';
    case 'stale':
      return 'Stale';
    default:
      return 'Picking';
  }
}

/** In-progress pick the picker should resume (started but not complete). */
export function isInProgressPick(order: OrderWithClaimInfo): boolean {
  return isPickStarted(order.workflow_status) && order.is_mine;
}

/** Billing-assigned or claimed pick that belongs to this picker. */
export function isAssignedToMe(
  order: OrderWithClaimInfo,
  userName: string | null,
): boolean {
  if (order.is_mine) return true;
  return userName != null && order.picker_name === userName;
}

/**
 * In-progress pick assigned to this picker — active session or stale / lapsed claim.
 * Shown on the Queue tab so pickers can resume without hunting on Team.
 */
export function isMyInProgressPick(
  order: OrderWithClaimInfo,
  userName: string | null,
): boolean {
  if (!isPickStarted(order.workflow_status)) return false;
  return isAssignedToMe(order, userName);
}

/**
 * Stale or lapsed in-progress pick assigned to this picker.
 * @deprecated Prefer {@link isMyInProgressPick} — kept for call sites that only want stale rows.
 */
export function isMyStaleAssignedPick(
  order: OrderWithClaimInfo,
  userName: string | null,
): boolean {
  if (!isMyInProgressPick(order, userName)) return false;
  return !order.claim_info || order.claim_info.is_stale;
}

/** No assigned orders waiting to start or resume — safe to show the unassigned pool. */
export function isMyAssignedWorkCleared(
  orders: OrderWithClaimInfo[],
  userName: string | null,
): boolean {
  return !orders.some(
    (order) =>
      isMyInProgressPick(order, userName) || isMyAssignedPending(order, userName),
  );
}
