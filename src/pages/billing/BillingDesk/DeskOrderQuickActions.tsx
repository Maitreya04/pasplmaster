import { useMutation } from '@tanstack/react-query';
import { Bell } from '@phosphor-icons/react';
import { useToast } from '../../../context/ToastContext';
import { sendPickerReadyNotification, sendPickCompleteReminder } from '../../../lib/pickerPush';
import { shouldNotifyPickers } from '../../../lib/billing/fulfillmentPath';
import type { PickerLoadInfo } from '../../../hooks/usePickerLoad';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import { DeskTooltip } from './DeskTooltip';
import { findPickerByName } from './deskPickerAssign';
import { deskBtn } from './deskTypography';

interface DeskOrderQuickActionsProps {
  order: DeskOrderRow;
  pickers: PickerLoadInfo[];
}

function canNotifyPicker(order: DeskOrderRow): boolean {
  if (!shouldNotifyPickers(order.fulfillment_path ?? 'warehouse_pick')) return false;
  return (
    order.deskStatus === 'picking' ||
    order.deskStatus === 'no_ack' ||
    (order.deskStatus === 'unassigned' && Boolean(order.picker_name))
  );
}

export function DeskOrderQuickActions({
  order,
  pickers,
}: DeskOrderQuickActionsProps): React.JSX.Element | null {
  const toast = useToast();
  const showNotify = canNotifyPicker(order);

  const notifyMutation = useMutation({
    mutationFn: async () => {
      const picker = findPickerByName(pickers, order.picker_name);
      if (!picker) {
        throw new Error('Picker not found');
      }
      if (order.workflow_status === 'picking') {
        await sendPickCompleteReminder({
          eventType: 'pick_complete_reminder',
          kind: 'stalled',
          orderId: order.id,
          orderNumber: order.order_number,
          customerName: order.customer_name,
          priority: order.priority,
          targetUserId: picker.userId,
          linesDone: 0,
          linesTotal: 0,
          linesRemaining: 0,
        });
      } else {
        await sendPickerReadyNotification({
          eventType: 'order_ready_to_pick',
          orderId: order.id,
          orderNumber: order.order_number,
          customerName: order.customer_name,
          priority: order.priority,
          approvedAt: order.approved_at,
          targetUserId: picker.userId,
        });
      }
      return picker;
    },
    onSuccess: (picker) => {
      toast.success(
        order.workflow_status === 'picking'
          ? `Reminded ${picker.firstName} to complete the pick`
          : `Pinged ${picker.firstName}`,
      );
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to notify picker');
    },
  });

  if (!showNotify) return null;

  return (
    <div
      className="flex items-center gap-0.5 shrink-0 transition-opacity"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <DeskTooltip
        label={
          order.workflow_status === 'picking'
            ? 'Remind the picker: did you complete this pick?'
            : 'Send another pick notification to the assigned picker'
        }
        side="bottom"
      >
        <button
          type="button"
          onClick={() => notifyMutation.mutate()}
          disabled={notifyMutation.isPending}
          className={`${deskBtn.icon} text-[var(--content-quaternary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--content-secondary)] disabled:opacity-50 border border-transparent hover:border-[var(--border-faint)]`}
          aria-label={`Notify picker for ${order.customer_name}`}
        >
          <Bell size={15} weight={notifyMutation.isPending ? 'regular' : 'bold'} />
        </button>
      </DeskTooltip>
    </div>
  );
}
