import { useEffect, useMemo, useRef, useState } from 'react';
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

interface AssignPickerStageProps {
  order: DeskOrderRow;
  pickers: PickerLoadInfo[];
  pickerColors: Array<{ bg: string; text: string }>;
  onClose?: () => void;
  onAssigned?: () => void;
  variant?: 'overlay' | 'inline' | 'desk';
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
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const confirmRowRef = useRef<HTMLDivElement | null>(null);
  const assignVerb = reassign ? 'Re-assign' : 'Assign';

  useEffect(() => {
    if (!confirmingId || !confirmRowRef.current) return;
    confirmRowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [confirmingId]);

  const shellClass =
    variant === 'overlay'
      ? 'absolute inset-0 z-20 flex flex-col bg-[var(--bg-primary)] border-l border-[var(--border-subtle)]'
      : variant === 'desk'
        ? 'flex flex-1 min-h-0 flex-col mx-3 mb-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] shadow-sm overflow-hidden'
        : 'flex flex-col max-h-[min(28rem,55vh)] border-t border-[var(--border-faint)] bg-[var(--bg-secondary)] overflow-hidden';

  const beginConfirm = (picker: PickerLoadInfo) => {
    if (picker.isBusy && !reassign) return;
    if (isPending) return;
    setConfirmingId((current) => (current === picker.userId ? null : picker.userId));
  };

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
          <p className={`${deskType.hint} mt-0.5 text-[var(--content-quaternary)]`}>
            Hover a picker for {assignVerb.toLowerCase()} · click to confirm
          </p>
        </div>
        {onClose && variant !== 'desk' ? (
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
          const isConfirming = confirmingId === picker.userId;
          const load = loadFill(picker.activeOrders);
          const rowLoading = busyPickerId === picker.userId;

          return (
            <div
              key={picker.userId}
              ref={isConfirming ? confirmRowRef : undefined}
              className={`group rounded-xl border overflow-hidden transition-colors ${
                isConfirming
                  ? 'border-[var(--role-primary)] ring-2 ring-[var(--role-primary)]/20 shadow-sm'
                  : 'border-[var(--border-subtle)] hover:border-[var(--border-opaque)]'
              } ${isBusy ? 'opacity-40' : ''}`}
            >
              <button
                type="button"
                disabled={isBusy || isPending}
                aria-expanded={isConfirming}
                aria-label={`${assignVerb} ${picker.firstName}`}
                onClick={() => beginConfirm(picker)}
                className={`w-full text-left transition-colors ${
                  isBusy ? 'cursor-not-allowed' : 'hover:bg-[var(--bg-tertiary)]'
                } ${isConfirming ? 'bg-[var(--bg-secondary)]' : ''}`}
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
                  {variant !== 'inline' ? (
                    <>
                      <div className="hidden @md/billing-order:block w-20 shrink-0">
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
                      <span className="hidden @md/billing-order:inline-flex ds-chip ds-chip--sm shrink-0 tabular-nums">
                        {picker.activeOrders} active
                      </span>
                      {!isBusy && !isConfirming ? (
                        <span
                          className="shrink-0 hidden @md/billing-order:inline-flex items-center justify-center min-h-8 px-3 rounded-lg font-ds-caption-size font-semibold border border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] opacity-0 pointer-events-none group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
                          aria-hidden
                        >
                          {assignVerb}
                        </span>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </button>

              {isConfirming && !isBusy ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-faint)] bg-[var(--bg-tertiary)] px-3 py-2.5">
                  <p className="font-ds-caption-size font-medium text-[var(--content-secondary)] min-w-0">
                    {assignVerb} <span className="font-semibold text-[var(--content-primary)]">{order.customer_name}</span> to{' '}
                    <span className="font-semibold text-[var(--content-primary)]">{picker.firstName}</span>?
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={rowLoading}
                      onClick={() => setConfirmingId(null)}
                      className="h-8 px-3 rounded-lg font-ds-caption-size font-medium border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-secondary)] hover:bg-[var(--bg-primary)] disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={rowLoading || isPending}
                      onClick={() => selectPicker(picker)}
                      className="h-8 px-3 rounded-lg font-ds-caption-size font-semibold bg-[var(--role-primary)] text-white hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      {rowLoading ? `${assignVerb}…` : `${assignVerb} ${picker.firstName}`}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {onClose && variant !== 'desk' ? (
        <footer className="shrink-0 border-t border-[var(--border-faint)] px-4 py-2.5 bg-[var(--bg-secondary)]">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 rounded-lg font-ds-caption-size font-medium border border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]"
          >
            Cancel
          </button>
        </footer>
      ) : null}
    </div>
  );
}
