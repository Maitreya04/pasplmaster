import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import {
  assignPickerErrorMessage,
  billingAssignPicker,
} from '../../../lib/billing/assignPickerToOrder';
import {
  formatInternalNotificationError,
  sendPickerReadyNotification,
} from '../../../lib/pickerPush';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import type { PickerLoadInfo } from '../../../hooks/usePickerLoad';
import { canAssignPicker, isPickerReassign } from './deskPickerAssign';

export function useDeskPickerAssign(
  order: DeskOrderRow | null,
  options?: { onSuccess?: () => void },
) {
  const { userId, userName } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
    queryClient.invalidateQueries({ queryKey: ['billing-desk-picking-stale'] });
    queryClient.invalidateQueries({ queryKey: ['picker-load-counts'] });
    queryClient.invalidateQueries({ queryKey: ['desk-picker-flags'] });
  }, [queryClient]);

  const notifyPickerInBackground = useCallback(
    (picker: PickerLoadInfo) => {
      if (!order) return;
      void sendPickerReadyNotification({
        eventType: 'order_ready_to_pick',
        orderId: order.id,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        priority: order.priority,
        approvedAt: order.approved_at,
        targetUserId: picker.userId,
      }).catch((err: unknown) => {
        console.error('[BillingDesk] picker assignment notification failed', err);
        toast.error(
          `Assigned to ${picker.firstName}, but notification failed: ${formatInternalNotificationError(err)}`,
        );
      });
    },
    [order, toast],
  );

  const assignMutation = useMutation({
    mutationFn: async (picker: PickerLoadInfo) => {
      if (!order) throw new Error('No order selected');
      if (!userId) throw new Error('Not signed in');
      const result = await billingAssignPicker({
        orderId: order.id,
        pickerUserId: picker.userId,
        actorUserId: userId,
        actorName: userName,
      });
      if (!result.success) {
        throw new Error(assignPickerErrorMessage(result));
      }
      return picker;
    },
    onSuccess: (picker) => {
      options?.onSuccess?.();
      invalidate();
      notifyPickerInBackground(picker);
      toast.success(`Assigned to ${picker.firstName} — notifying`);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to assign picker');
    },
  });

  const reassignMutation = useMutation({
    mutationFn: async (picker: PickerLoadInfo) => {
      if (!order) throw new Error('No order selected');
      if (!userId) throw new Error('Not signed in');
      const result = await billingAssignPicker({
        orderId: order.id,
        pickerUserId: picker.userId,
        actorUserId: userId,
        actorName: userName,
      });
      if (!result.success) {
        throw new Error(assignPickerErrorMessage(result));
      }
      return picker;
    },
    onSuccess: (picker) => {
      options?.onSuccess?.();
      invalidate();
      notifyPickerInBackground(picker);
      toast.success(`Re-assigned to ${picker.firstName} — notifying`);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to re-assign');
    },
  });

  const busyPickerId =
    assignMutation.isPending
      ? assignMutation.variables?.userId
      : reassignMutation.isPending
        ? reassignMutation.variables?.userId
        : null;

  const selectPicker = useCallback(
    (picker: PickerLoadInfo) => {
      if (!order) return;
      if (picker.isBusy && !isPickerReassign(order)) return;
      if (canAssignPicker(order)) {
        assignMutation.mutate(picker);
      } else if (isPickerReassign(order)) {
        reassignMutation.mutate(picker);
      }
    },
    [assignMutation, order, reassignMutation],
  );

  const isPending = assignMutation.isPending || reassignMutation.isPending;

  return { selectPicker, busyPickerId, isPending };
}
