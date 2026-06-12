import { prefetchClaimableOrders } from '../../hooks/useClaimableOrders';
import type { WorkflowStatus } from '../../types';

const PICK_QUEUE_OPTIONS = {
  stage: 'picking' as const,
  workflowStatus: ['approved', 'picking'] as WorkflowStatus[],
};

/** Start loading pick-queue JS chunks in parallel with the layout route. */
export function preloadPickQueueChunks(): void {
  void import('../../pages/picking/PickingLayout');
  void import('../../pages/picking/QueuePage');
}

/** Prefetch queue data so QueuePage mounts with cache already warm. */
export function prefetchPickQueueData(
  userId: number | null,
  pickerBranch: 'main_store' | 'jabalpur' | null = null,
): void {
  prefetchClaimableOrders(PICK_QUEUE_OPTIONS, userId, pickerBranch);
}

/** Warm both route chunks and queue data — call as early as possible for pickers. */
export function warmPickQueueRoute(
  userId: number | null,
  pickerBranch: 'main_store' | 'jabalpur' | null = null,
): void {
  preloadPickQueueChunks();
  prefetchPickQueueData(userId, pickerBranch);
}

/** Read persisted picker session from storage (safe before React mounts). */
export function readStoredPickerSession(): { isPicker: boolean; userId: number | null } {
  if (typeof window === 'undefined') return { isPicker: false, userId: null };
  try {
    if (window.localStorage.getItem('paspl_role') !== 'picking') {
      return { isPicker: false, userId: null };
    }
    const userIdStr = window.localStorage.getItem('paspl_userId');
    if (!userIdStr) return { isPicker: true, userId: null };
    const userId = Number.parseInt(userIdStr, 10);
    return { isPicker: true, userId: Number.isNaN(userId) ? null : userId };
  } catch {
    return { isPicker: false, userId: null };
  }
}
