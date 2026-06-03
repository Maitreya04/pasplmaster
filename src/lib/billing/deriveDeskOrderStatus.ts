import type { DeskOrderStatus } from './deskOrderQueue';
import type { WorkflowStatus } from '../../types';

export interface DeskOrderStatusInput {
  workflow_status: WorkflowStatus;
  picker_name?: string | null;
}

export interface DeskOrderStatusOptions {
  pickingClaimStale?: boolean;
  hasActivePickingClaim?: boolean;
}

export function deriveDeskOrderStatus(
  order: DeskOrderStatusInput,
  options: boolean | DeskOrderStatusOptions = {},
): DeskOrderStatus {
  const { pickingClaimStale, hasActivePickingClaim } =
    typeof options === 'boolean'
      ? { pickingClaimStale: options, hasActivePickingClaim: false }
      : {
          pickingClaimStale: false,
          hasActivePickingClaim: false,
          ...options,
        };

  if (order.workflow_status === 'flagged') return 'flagged';
  if (order.workflow_status === 'submitted') return 'submitted';
  if (order.workflow_status === 'picking') {
    if (pickingClaimStale) return 'no_ack';
    return 'picking';
  }
  if (order.workflow_status === 'completed') return 'checking';
  if (order.workflow_status === 'approved') {
    if (!order.picker_name?.trim()) return 'unassigned';
    if (hasActivePickingClaim) return 'picking';
    return 'no_ack';
  }
  return 'unassigned';
}
