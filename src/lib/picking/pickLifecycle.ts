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
  if (order.is_mine) return true;
  return userName != null && order.picker_name === userName;
}

export type ActivePickStatus = 'not_started' | 'picking' | 'almost_done' | 'stale';

export function activePickStatus(
  order: OrderWithClaimInfo,
  progressRatio: number,
): ActivePickStatus {
  if (order.claim_info?.is_stale && isPickStarted(order.workflow_status)) {
    return 'stale';
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

/** No assigned orders waiting to start or resume — safe to show the unassigned pool. */
export function isMyAssignedWorkCleared(
  orders: OrderWithClaimInfo[],
  userName: string | null,
): boolean {
  return !orders.some(
    (order) =>
      order.is_mine &&
      (isInProgressPick(order) || isMyAssignedPending(order, userName)),
  );
}
