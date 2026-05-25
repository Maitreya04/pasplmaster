import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, UserPlus } from '@phosphor-icons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import {
  assignPickerAndNotify,
  assignPickerErrorMessage,
  billingAssignPicker,
} from '../../../lib/billing/assignPickerToOrder';
import { sendPickerReadyNotification, sendPickCompleteReminder } from '../../../lib/pickerPush';
import { shouldNotifyPickers } from '../../../lib/billing/fulfillmentPath';
import type { PickerLoadInfo } from '../../../hooks/usePickerLoad';
import { pickerLoadBarColor } from '../../../hooks/usePickerLoad';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import { DeskTooltip } from './DeskTooltip';

interface DeskOrderQuickActionsProps {
  order: DeskOrderRow;
  pickers: PickerLoadInfo[];
  pickerColors: Array<{ bg: string; text: string }>;
}

function canAssignPicker(order: DeskOrderRow): boolean {
  return (
    order.deskStatus === 'unassigned' &&
    order.workflow_status === 'approved' &&
    order.fulfillment_path !== 'direct_bill'
  );
}

function canNotifyPicker(order: DeskOrderRow): boolean {
  if (!shouldNotifyPickers(order.fulfillment_path ?? 'warehouse_pick')) return false;
  return (
    order.deskStatus === 'picking' ||
    order.deskStatus === 'no_ack' ||
    (order.deskStatus === 'unassigned' && Boolean(order.picker_name))
  );
}

function findPickerByName(pickers: PickerLoadInfo[], name: string | null): PickerLoadInfo | undefined {
  if (!name?.trim()) return undefined;
  const normalized = name.trim().toLowerCase();
  return pickers.find((p) => p.name.trim().toLowerCase() === normalized);
}

export function DeskOrderQuickActions({
  order,
  pickers,
  pickerColors,
}: DeskOrderQuickActionsProps): React.JSX.Element | null {
  const { userId, userName } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const showAssign = canAssignPicker(order);
  const showNotify = canNotifyPicker(order);

  useEffect(() => {
    if (!assignOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setAssignOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAssignOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [assignOpen]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      queryClient.invalidateQueries({ queryKey: ['billing-desk-picking-stale'] });
      queryClient.invalidateQueries({ queryKey: ['picker-load-counts'] });
      queryClient.invalidateQueries({ queryKey: ['desk-picker-flags'] });
  }, [queryClient]);

  const assignMutation = useMutation({
    mutationFn: async (picker: PickerLoadInfo) => {
      if (!userId) throw new Error('Not signed in');
      const result = await assignPickerAndNotify({
        orderId: order.id,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        priority: order.priority,
        approvedAt: order.approved_at,
        pickerUserId: picker.userId,
        actorUserId: userId,
        actorName: userName,
      });
      if (!result.success) {
        throw new Error(assignPickerErrorMessage(result));
      }
      return { picker, result };
    },
    onSuccess: ({ picker }) => {
      setAssignOpen(false);
      invalidate();
      toast.success(`Assigned to ${picker.firstName} — notified`);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to assign picker');
    },
  });

  const notifyMutation = useMutation({
    mutationFn: async () => {
      const picker = findPickerByName(pickers, order.picker_name);
      if (!picker) {
        throw new Error('Picker not found — use Assign instead');
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

  const reassignMutation = useMutation({
    mutationFn: async (picker: PickerLoadInfo) => {
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
      await sendPickerReadyNotification({
        eventType: 'order_ready_to_pick',
        orderId: order.id,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        priority: order.priority,
        approvedAt: order.approved_at,
        targetUserId: picker.userId,
      });
      return picker;
    },
    onSuccess: (picker) => {
      setAssignOpen(false);
      invalidate();
      toast.success(`Re-assigned to ${picker.firstName}`);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to re-assign');
    },
  });

  if (!showAssign && !showNotify) return null;

  const busyPickerId = assignMutation.isPending
    ? assignMutation.variables?.userId
    : reassignMutation.isPending
      ? reassignMutation.variables?.userId
      : null;

  const handlePickerSelect = (picker: PickerLoadInfo) => {
    if (picker.isBusy) return;
    if (showAssign) {
      assignMutation.mutate(picker);
    } else if (order.deskStatus === 'no_ack' || order.pickingClaimStale) {
      reassignMutation.mutate(picker);
    }
  };

  const assignLabel =
    order.deskStatus === 'no_ack' || order.pickingClaimStale ? 'Re-assign' : 'Assign';

  return (
    <div
      className="flex items-center gap-0.5 shrink-0 transition-opacity"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {(showAssign || order.deskStatus === 'no_ack') && (
        <div className="relative" ref={popoverRef}>
          <DeskTooltip
            label={
              showAssign
                ? 'Assign a picker — they get a direct notification'
                : 'Re-assign to another picker if the current one is stuck'
            }
            side="bottom"
          >
            <button
              type="button"
              onClick={() => setAssignOpen((v) => !v)}
              disabled={assignMutation.isPending || reassignMutation.isPending}
              className="inline-flex items-center gap-1 h-6 px-1.5 rounded-md text-[10px] font-medium text-[var(--role-content)] bg-[var(--role-primary-subtle)] hover:bg-[var(--role-primary-subtle)]/80 transition-colors disabled:opacity-50"
              aria-label={`${assignLabel} picker for ${order.customer_name}`}
              aria-expanded={assignOpen}
            >
              <UserPlus size={12} weight="bold" />
              {assignLabel}
            </button>
          </DeskTooltip>

          {assignOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 w-[168px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] shadow-lg p-2">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--content-quaternary)] mb-1.5 px-0.5">
                Pick picker
              </p>
              <div className="flex flex-col gap-0.5 max-h-[200px] overflow-y-auto">
                {pickers.map((picker) => {
                  const color = pickerColors[picker.colorIndex]!;
                  const isBusy = picker.isBusy;
                  const isLoading = busyPickerId === picker.userId;
                  return (
                    <button
                      key={picker.userId}
                      type="button"
                      disabled={isBusy || isLoading}
                      onClick={() => handlePickerSelect(picker)}
                      className={`flex items-center gap-2 w-full rounded-md px-1.5 py-1 text-left transition-colors ${
                        isBusy
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0"
                        style={{ background: color.bg, color: color.text }}
                      >
                        {picker.initials}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[11px] font-medium text-[var(--content-primary)] truncate">
                          {picker.firstName}
                        </span>
                        <span
                          className="block h-0.5 rounded-full mt-0.5"
                          style={{
                            width: 28,
                            background: `linear-gradient(to right, ${pickerLoadBarColor(picker.loadPct)} ${picker.loadPct}%, var(--bg-tertiary) ${picker.loadPct}%)`,
                          }}
                        />
                      </span>
                      {isLoading && (
                        <span className="text-[9px] text-[var(--content-quaternary)]">…</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {showNotify && (
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
            className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--content-primary)] transition-colors disabled:opacity-50"
            aria-label={`Notify picker for ${order.customer_name}`}
          >
            <Bell size={13} weight={notifyMutation.isPending ? 'regular' : 'bold'} />
          </button>
        </DeskTooltip>
      )}
    </div>
  );
}
