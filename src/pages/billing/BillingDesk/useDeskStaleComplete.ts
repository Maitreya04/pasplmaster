import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import {
  billingCompleteStalePicking,
  billingForceCompletePrePick,
  forceCompletePrePickErrorMessage,
  stalePickingCompleteErrorMessage,
} from '../../../lib/billing/completeStalePicking';
import { refreshWorkflowQueues } from '../../../lib/queueRefresh';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import { getDeskStaleCompleteKind } from './deskStaleComplete';

export function useDeskStaleComplete(order: DeskOrderRow | null) {
  const { userId, userName } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    void refreshWorkflowQueues(queryClient);
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['picking-claims-stale'] });
    if (order) {
      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      queryClient.invalidateQueries({ queryKey: ['picking-claim', order.id] });
    }
  }, [order, queryClient]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!order || !userId) throw new Error('Not signed in');
      const kind = getDeskStaleCompleteKind(order);
      if (!kind) throw new Error('This order cannot be completed here');

      if (kind === 'skip_pick') {
        const result = await billingForceCompletePrePick({
          orderId: order.id,
          userId,
          userName,
        });
        if (!result.success) {
          throw new Error(forceCompletePrePickErrorMessage(result));
        }
        return { kind, result };
      }

      const result = await billingCompleteStalePicking({
        orderId: order.id,
        userId,
        userName,
      });
      if (!result.success) {
        throw new Error(stalePickingCompleteErrorMessage(result));
      }
      return { kind, result };
    },
    onSuccess: ({ kind, result }) => {
      invalidate();
      if (kind === 'skip_pick') {
        toast.success('Order completed without warehouse pick');
      } else if (result.has_flags) {
        toast.success('Pick completed with flagged lines — review if needed');
      } else {
        toast.success('Pick marked complete');
      }
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to complete order');
    },
  });

  return mutation;
}
