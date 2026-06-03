import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  formatRejectBillingOrderError,
  rejectBillingOrder,
} from '../lib/billing/rejectBillingOrder';
import { formatInternalNotificationError } from '../lib/pickerPush';
import { invalidateLocationwiseStockQueries } from './useLocationwiseStock';
import type { RejectionKind } from '../types';

export interface RejectBillingOrderTarget {
  id: number;
  order_number: string;
  customer_name: string;
  salesperson_name: string | null;
}

export function useRejectBillingOrder(
  order: RejectBillingOrderTarget | null | undefined,
  onSuccess?: () => void,
) {
  const { userId, userName } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      kind,
      reason,
    }: {
      kind: RejectionKind;
      reason: string;
    }) => {
      if (!order) throw new Error('No order selected');
      if (!userId) throw new Error('Not signed in');

      return rejectBillingOrder({
        orderId: order.id,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        salespersonName: order.salesperson_name,
        kind,
        reason,
        actorUserId: String(userId),
        actorName: userName ?? 'Billing',
      });
    },
    onSuccess: ({ kind, notificationFailed, notificationError }) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      void invalidateLocationwiseStockQueries(queryClient);
      if (order) {
        queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      }
      if (notificationFailed) {
        toast.error(
          `Sales notification failed: ${formatInternalNotificationError(notificationError)}`,
        );
      }
      toast.success(
        kind === 'account_hold'
          ? 'Order on hold — sales notified'
          : 'Order rejected — sales notified',
      );
      onSuccess?.();
    },
    onError: (err: unknown) => {
      toast.error(formatRejectBillingOrderError(err));
    },
  });
}
