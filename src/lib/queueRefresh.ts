import type { QueryClient } from '@tanstack/react-query';
import type { OrderWithClaimInfo } from '../hooks/useClaimableOrders';
import type { WorkflowStatus } from '../types';

/** Eagerly refetch workflow queue caches so desk/picking UIs catch up immediately. */
export async function refreshWorkflowQueues(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.refetchQueries({ queryKey: ['claimable-orders'] }),
    queryClient.refetchQueries({ queryKey: ['billing-desk-picking-claims'] }),
    queryClient.refetchQueries({ queryKey: ['desk-pick-progress'] }),
    queryClient.refetchQueries({ queryKey: ['desk-picker-flags'] }),
    queryClient.refetchQueries({ queryKey: ['picker-load-counts'] }),
  ]);
}

type ClaimableOrderPatch = Partial<
  Pick<
    OrderWithClaimInfo,
    | 'workflow_status'
    | 'picker_name'
    | 'reviewer_name'
    | 'picking_completed_at'
    | 'completed_at'
    | 'box_count'
  >
>;

function upsertClaimableOrderInCache(
  queryClient: QueryClient,
  queryKeyPrefix: readonly unknown[],
  orderId: number,
  buildRow: (existing: OrderWithClaimInfo | undefined) => OrderWithClaimInfo | null,
): void {
  forMatchingQueries(queryClient, queryKeyPrefix, (queryKey) => {
    queryClient.setQueryData<OrderWithClaimInfo[]>(queryKey, (rows) => {
      const existing = rows?.find((row) => row.id === orderId);
      const nextRow = buildRow(existing);
      const without = (rows ?? []).filter((row) => row.id !== orderId);
      if (nextRow == null) return without;
      return [nextRow, ...without];
    });
  });
}

function forMatchingQueries(
  queryClient: QueryClient,
  queryKeyPrefix: readonly unknown[],
  fn: (queryKey: readonly unknown[]) => void,
): void {
  for (const query of queryClient.getQueryCache().findAll({
    queryKey: [...queryKeyPrefix],
    exact: false,
  })) {
    fn(query.queryKey);
  }
}

function removeClaimableOrderFromCache(
  queryClient: QueryClient,
  queryKeyPrefix: readonly unknown[],
  orderId: number,
): void {
  forMatchingQueries(queryClient, queryKeyPrefix, (queryKey) => {
    queryClient.setQueryData<OrderWithClaimInfo[]>(queryKey, (rows) => {
      if (rows == null) return rows;
      return rows.filter((row) => row.id !== orderId);
    });
  });
}

function patchClaimableOrderInMatchingCaches(
  queryClient: QueryClient,
  orderId: number,
  patch: ClaimableOrderPatch,
  predicate: (queryKey: readonly unknown[]) => boolean,
): void {
  forMatchingQueries(queryClient, ['claimable-orders'], (queryKey) => {
    if (!predicate(queryKey)) return;
    queryClient.setQueryData<OrderWithClaimInfo[]>(queryKey, (rows) => {
      if (rows == null) return rows;
      return rows.map((row) => (row.id === orderId ? { ...row, ...patch } : row));
    });
  });
}

/** Patch a single order across all claimable-orders query caches (assign, pick complete, etc.). */
export function patchClaimableOrderInCache(
  queryClient: QueryClient,
  orderId: number,
  patch: ClaimableOrderPatch,
): void {
  patchClaimableOrderInMatchingCaches(queryClient, orderId, patch, () => true);
}

export function patchClaimableOrderWorkflow(
  queryClient: QueryClient,
  orderId: number,
  workflowStatus: WorkflowStatus,
): void {
  patchClaimableOrderInCache(queryClient, orderId, { workflow_status: workflowStatus });
}

/** After picker finalises — leaves picker queue; billing Resolve can open immediately. */
export function patchPickFinalisedInCache(
  queryClient: QueryClient,
  orderId: number,
  options: { hasFlags: boolean; completedAt?: string },
): void {
  const now = options.completedAt ?? new Date().toISOString();
  const patch: ClaimableOrderPatch = {
    workflow_status: options.hasFlags ? 'flagged' : 'completed',
    picking_completed_at: now,
    completed_at: options.hasFlags ? null : now,
  };

  removeClaimableOrderFromCache(
    queryClient,
    ['claimable-orders', 'picking'],
    orderId,
  );

  patchClaimableOrderInMatchingCaches(
    queryClient,
    orderId,
    patch,
    (key) => key[1] !== 'picking',
  );

  if (!options.hasFlags) {
    const existing = findClaimableOrderInCache(queryClient, orderId);
    const merged = existing ? { ...existing, ...patch } : null;
    if (merged) {
      upsertClaimableOrderInCache(
        queryClient,
        ['claimable-orders', 'billing', 'completed'],
        orderId,
        () => merged,
      );
    }
  }
}

function findClaimableOrderInCache(
  queryClient: QueryClient,
  orderId: number,
): OrderWithClaimInfo | undefined {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ['claimable-orders'] })) {
    const rows = queryClient.getQueryData<OrderWithClaimInfo[]>(query.queryKey);
    const found = rows?.find((row) => row.id === orderId);
    if (found) return found;
  }
  return undefined;
}

/** After billing desk saves the bill — order moves to Done tab only. */
export function patchBillingFinalisedInCache(
  queryClient: QueryClient,
  orderId: number,
  reviewerName: string,
  options?: { fromFlagged?: boolean },
): void {
  const patch: ClaimableOrderPatch = {
    reviewer_name: reviewerName,
    ...(options?.fromFlagged
      ? { workflow_status: 'completed', completed_at: new Date().toISOString() }
      : {}),
  };

  const existing = findClaimableOrderInCache(queryClient, orderId);
  const merged = existing ? { ...existing, ...patch } : null;

  removeClaimableOrderFromCache(
    queryClient,
    ['claimable-orders', 'billing', 'approved,picking,flagged'],
    orderId,
  );

  if (merged) {
    upsertClaimableOrderInCache(
      queryClient,
      ['claimable-orders', 'billing', 'completed'],
      orderId,
      () => merged,
    );
  } else {
    patchClaimableOrderInCache(queryClient, orderId, patch);
  }
}

/** After billing assigns a picker — stays approved until picker starts. */
export function patchPickerAssignedInCache(
  queryClient: QueryClient,
  orderId: number,
  pickerName: string,
): void {
  patchClaimableOrderInCache(queryClient, orderId, {
    workflow_status: 'approved',
    picker_name: pickerName,
  });
}
