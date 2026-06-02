import { useMemo, useState } from 'react';
import {
  CheckCircle,
  Package,
  Warning,
  X,
} from '@phosphor-icons/react';
import type { PickerLoadInfo } from '../../../hooks/usePickerLoad';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import {
  findPickerByName,
  isPickerReassign,
  sortPickersForAssign,
} from '../../../pages/billing/BillingDesk/deskPickerAssign';
import { useDeskPickerAssign } from '../../../pages/billing/BillingDesk/useDeskPickerAssign';
import { deskAvatar, deskType } from '../../../pages/billing/BillingDesk/deskTypography';
import { BillingActionBar } from '../chrome/BillingActionBar';

interface AssignPickerStageProps {
  order: DeskOrderRow;
  pickers: PickerLoadInfo[];
  pickerColors: Array<{ bg: string; text: string }>;
  onClose?: () => void;
  onAssigned?: () => void;
  variant?: 'overlay' | 'inline';
}

function loadFill(activeOrders: number): { pct: number; tone: 'green' | 'amber' | 'red' } {
  const max = 5;
  const pct = Math.min(100, Math.round((activeOrders / max) * 100));
  if (activeOrders >= 4) return { pct, tone: 'red' };
  if (activeOrders >= 3) return { pct, tone: 'amber' };
  return { pct, tone: 'green' };
}

const LOAD_BAR: Record<'green' | 'amber' | 'red', string> = {
  green: 'bg-[var(--content-positive)]',
  amber: 'bg-[var(--content-warning)]',
  red: 'bg-[var(--content-negative)]',
};

export function AssignPickerStage({
  order,
  pickers,
  pickerColors,
  onClose,
  onAssigned,
  variant = 'overlay',
}: AssignPickerStageProps): React.JSX.Element {
  const reassign = isPickerReassign(order);
  const currentPicker = findPickerByName(pickers, order.picker_name);
  const { selectPicker, busyPickerId, isPending } = useDeskPickerAssign(order, {
    onSuccess: () => {
      onAssigned?.();
    },
  });

  const sorted = useMemo(() => sortPickersForAssign(pickers), [pickers]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = sorted.find((p) => p.userId === selectedId) ?? null;
  const assignLoading = selected != null && busyPickerId === selected.userId;

  const shellClass =
    variant === 'overlay'
      ? 'absolute inset-0 z-20 flex flex-col bg-[var(--bg-primary)] border-l border-[var(--border-subtle)]'
      : 'flex flex-col border-t border-[var(--border-faint)] bg-[var(--bg-secondary)]';

  return (
    <div className={shellClass}>
      <header className="shrink-0 flex items-start justify-between gap-2 px-4 py-3 border-b border-[var(--border-faint)]">
        <div>
          <h3 className="font-ds-prose font-semibold text-[var(--content-primary)]">
            Assign a picker
          </h3>
          <p className={`${deskType.hint} mt-1`}>
            {order.customer_name} · {order.item_count ?? '—'} lines
            {reassign && currentPicker ? ` · re-assign from ${currentPicker.firstName}` : ''}
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-[var(--content-quaternary)] hover:bg-[var(--bg-tertiary)]"
            aria-label="Close assign picker"
          >
            <X size={18} />
          </button>
        ) : null}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2">
        {sorted.map((picker) => {
          const color = pickerColors[picker.colorIndex]!;
          const isBusy = picker.isBusy && !reassign;
          const isSelected = selectedId === picker.userId;
          const load = loadFill(picker.activeOrders);

          return (
            <button
              key={picker.userId}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={isBusy || isPending}
              onClick={() => setSelectedId(picker.userId)}
              className={`w-full text-left rounded-xl border overflow-hidden transition-colors ${
                isSelected
                  ? 'border-[var(--content-primary)] border-[1.5px]'
                  : 'border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)]'
              } ${isBusy ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center gap-3 px-3 py-2.5">
                <span
                  className={deskAvatar.md}
                  style={{ background: color.bg, color: color.text }}
                >
                  {picker.initials}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-ds-caption-size font-semibold text-[var(--content-primary)]">
                    {picker.firstName}
                  </p>
                  <p className={`${deskType.chipStat} inline-flex items-center gap-1`}>
                    {picker.activeOrders === 0 ? (
                      <>
                        <CheckCircle size={11} className="text-[var(--content-positive)]" />
                        Free now
                      </>
                    ) : picker.activeOrders >= 3 ? (
                      <>
                        <Warning size={11} className="text-[var(--content-negative)]" />
                        {picker.activeOrders} active picks
                      </>
                    ) : (
                      <>
                        <Package size={11} />
                        {picker.activeOrders} active picks
                      </>
                    )}
                  </p>
                </div>
                <div className="w-20 shrink-0">
                  <p className="font-ds-micro text-right text-[var(--content-quaternary)] mb-0.5">
                    Load
                  </p>
                  <div className="h-1 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                    <div
                      className={`h-full rounded-full ${LOAD_BAR[load.tone]}`}
                      style={{ width: `${load.pct}%` }}
                    />
                  </div>
                </div>
                <span className="ds-chip ds-chip--sm shrink-0 tabular-nums">
                  {picker.activeOrders} active
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <BillingActionBar
        left={
          onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-2.5 rounded-md font-ds-caption-size font-medium border border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]"
            >
              Cancel
            </button>
          ) : selected ? (
            <p className="font-ds-micro text-[var(--content-quaternary)]">
              {selected.firstName} selected · {selected.activeOrders} active
            </p>
          ) : (
            <p className="font-ds-micro text-[var(--content-quaternary)]">Select a picker</p>
          )
        }
        primaryLabel={selected ? `Assign ${selected.firstName}` : 'Assign'}
        primaryDisabled={!selected || isPending || assignLoading}
        primaryLoading={assignLoading}
        onPrimary={() => {
          if (selected) selectPicker(selected);
        }}
      />
    </div>
  );
}
