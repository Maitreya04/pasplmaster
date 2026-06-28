import { ArrowCounterClockwise, CheckCircle } from '@phosphor-icons/react';
import { uomLabel } from '../../../lib/picking/pickerMicrocopy';
import { UNDO_WINDOW_MS, type UndoToastState } from '../hooks/useUndoableAction';

export interface UndoToastProps {
  toast: UndoToastState;
  onUndo: () => void;
}

export function UndoToast({ toast, onUndo }: UndoToastProps): React.JSX.Element {
  const detail = toast.detail;

  return (
    <div
      className="fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-[80] px-3 animate-undo-toast-enter-top"
      role="status"
    >
      <div className="mx-auto max-w-lg overflow-hidden rounded-2xl border border-[var(--border-positive)] bg-[var(--bg-secondary)] shadow-[0_8px_32px_rgba(15,23,42,0.14)]">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--bg-positive-subtle)]">
            <CheckCircle size={20} weight="fill" className="text-[var(--content-positive)]" />
          </span>

          <div className="min-w-0 flex-1">
            {detail ? (
              <>
                <p className="font-mono text-xl font-extrabold tabular-nums leading-none text-[var(--content-primary)]">
                  {detail.qty}{' '}
                  <span className="text-sm font-bold text-[var(--content-secondary)]">
                    {uomLabel(detail.uom, detail.qty)}
                  </span>
                </p>
                <p className="mt-1 font-ds-micro text-[var(--content-tertiary)]">
                  @ ₹{Math.round(detail.mrp).toLocaleString('en-IN')} · logged
                </p>
              </>
            ) : (
              <p className="font-ds-body-size font-semibold leading-snug text-[var(--content-primary)]">
                {toast.label}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onUndo}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 font-ds-caption-size font-bold text-[var(--content-primary)] pick-pressable"
          >
            <ArrowCounterClockwise size={14} weight="bold" />
            Undo
          </button>
        </div>

        <div className="h-0.5 bg-[var(--bg-tertiary)]">
          <div
            key={toast.toastKey}
            className="h-full w-full origin-left bg-[var(--bg-positive)] animate-undo-progress"
            style={{ animationDuration: `${UNDO_WINDOW_MS}ms` }}
          />
        </div>
      </div>
    </div>
  );
}
