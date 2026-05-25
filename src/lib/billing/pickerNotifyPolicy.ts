import type { WorkflowStatus } from '../../types';

/** Broadcast "new in pick queue" alerts — only for freshly approved orders. */
export function canBroadcastReadyToPick(status: WorkflowStatus | string | null | undefined): boolean {
  return status === 'approved';
}

/** Targeted assign/ping — allowed while pick is still open. */
export function canTargetPickerForPickAlert(status: WorkflowStatus | string | null | undefined): boolean {
  return status === 'approved' || status === 'picking';
}
