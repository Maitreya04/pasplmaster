import { useMemo } from 'react';
import { CircleNotch } from '@phosphor-icons/react';
import type { PickerLoadInfo } from '../../../hooks/usePickerLoad';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import { DeskTooltip } from './DeskTooltip';
import {
  findPickerByName,
  isPickerReassign,
  sortPickersForAssign,
} from './deskPickerAssign';
import { useDeskPickerAssign } from './useDeskPickerAssign';
import { deskAvatar, deskType } from './deskTypography';

interface DeskInlinePickerPickProps {
  order: DeskOrderRow;
  pickers: PickerLoadInfo[];
  pickerColors: Array<{ bg: string; text: string }>;
  onDone: () => void;
}

function loadHint(picker: PickerLoadInfo, reassign: boolean): string {
  if (picker.isBusy && !reassign) {
    return `${picker.firstName} is at capacity (${picker.activeOrders} picks)`;
  }
  if (picker.activeOrders === 0) return `Assign to ${picker.firstName}`;
  return `${picker.firstName} · ${picker.activeOrders} active pick${picker.activeOrders === 1 ? '' : 's'}`;
}

export function DeskInlinePickerPick({
  order,
  pickers,
  pickerColors,
  onDone,
}: DeskInlinePickerPickProps): React.JSX.Element {
  const reassign = isPickerReassign(order);
  const currentPicker = findPickerByName(pickers, order.picker_name);
  const { selectPicker, busyPickerId, isPending } = useDeskPickerAssign(order, {
    onSuccess: onDone,
  });

  const sorted = useMemo(() => sortPickersForAssign(pickers), [pickers]);

  return (
    <div
      className="border-t border-[var(--border-faint)] bg-[var(--bg-secondary)] px-3 py-2.5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <p className={`${deskType.hint} mb-2.5`}>
        {reassign ? (
          <>
            Re-assign
            {currentPicker ? (
              <span className="text-[var(--content-secondary)]">
                {' '}
                · waiting on {currentPicker.firstName}
              </span>
            ) : null}
          </>
        ) : (
          'Tap a picker to assign'
        )}
      </p>

      <div className="flex flex-wrap gap-2">
        {sorted.map((picker) => {
          const color = pickerColors[picker.colorIndex]!;
          const isBusy = picker.isBusy && !reassign;
          const isLoading = busyPickerId === picker.userId;
          const isCurrent =
            reassign &&
            currentPicker?.userId === picker.userId &&
            !order.pickingClaimStale;

          return (
            <DeskTooltip
              key={picker.userId}
              label={loadHint(picker, reassign)}
              side="bottom"
            >
              <button
                type="button"
                disabled={isBusy || isPending}
                onClick={() => selectPicker(picker)}
                aria-label={loadHint(picker, reassign)}
                className={`
                  flex flex-col items-center gap-1 rounded-lg px-2.5 py-2 min-w-[52px]
                  transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--role-primary)]
                  ${isCurrent ? 'bg-[var(--bg-warning-subtle)] border border-[var(--border-warning)]' : 'border border-transparent hover:bg-[var(--bg-tertiary)] hover:border-[var(--border-faint)]'}
                  ${isBusy ? 'opacity-35 cursor-not-allowed' : 'active:scale-95'}
                `}
              >
                <span
                  className={deskAvatar.md}
                  style={{ background: color.bg, color: color.text }}
                >
                  {isLoading ? (
                    <CircleNotch size={14} className="animate-spin" aria-hidden />
                  ) : (
                    picker.initials
                  )}
                </span>
                <span
                  className={`${deskType.chipName} max-w-[56px] truncate ${
                    isCurrent
                      ? 'text-[var(--content-warning-on-light)]'
                      : 'text-[var(--content-secondary)]'
                  }`}
                >
                  {picker.firstName}
                </span>
                <span className={deskType.chipStat}>
                  {picker.activeOrders > 0 ? `${picker.activeOrders} active` : 'free'}
                </span>
              </button>
            </DeskTooltip>
          );
        })}
      </div>
    </div>
  );
}
