import type { PendingRecoveryStatus } from '../types';

export function isPendingRecoveryActionable(status: PendingRecoveryStatus): boolean {
  return status === 'back_in_stock' || status === 'needs_checked';
}

export function pendingRecoveryLabel(status: PendingRecoveryStatus): string {
  switch (status) {
    case 'back_in_stock':
      return 'Back in stock';
    case 'needs_checked':
      return 'Needs checked';
    case 'reviewed':
      return 'Reviewed';
    default:
      return 'Waiting stock';
  }
}

export function pendingRecoveryBadgeClasses(status: PendingRecoveryStatus): string {
  switch (status) {
    case 'back_in_stock':
      return 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]';
    case 'needs_checked':
      return 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]';
    case 'reviewed':
      return 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)]';
    default:
      return 'bg-[var(--bg-secondary)] text-[var(--content-secondary)]';
  }
}

export function pendingRecoveryHelpText(status: PendingRecoveryStatus): string {
  switch (status) {
    case 'back_in_stock':
      return 'Stock is enough to cover the full pending qty.';
    case 'needs_checked':
      return 'It was available earlier, but stock needs recheck before billing.';
    case 'reviewed':
      return 'Sales already reviewed this recovery signal.';
    default:
      return 'Still waiting for enough stock to cover the pending qty.';
  }
}
