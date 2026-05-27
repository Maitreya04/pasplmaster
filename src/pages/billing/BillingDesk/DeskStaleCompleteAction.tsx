import { CheckCircle, X } from '@phosphor-icons/react';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import { DeskTooltip } from './DeskTooltip';
import {
  canDeskStaleComplete,
  deskStaleCompleteConfirmBody,
  deskStaleCompleteConfirmTitle,
  deskStaleCompleteLabel,
  deskStaleCompleteTooltip,
  getDeskStaleCompleteKind,
} from './deskStaleComplete';
import { useDeskStaleComplete } from './useDeskStaleComplete';
import { deskBtn, deskType } from './deskTypography';

interface DeskStaleCompleteButtonProps {
  order: DeskOrderRow;
  onClick: () => void;
}

export function DeskStaleCompleteButton({
  order,
  onClick,
}: DeskStaleCompleteButtonProps): React.JSX.Element | null {
  const kind = getDeskStaleCompleteKind(order);
  if (!kind || !canDeskStaleComplete(order)) return null;

  const label = deskStaleCompleteLabel(kind, order);

  return (
    <DeskTooltip label={deskStaleCompleteTooltip(kind, order)} side="bottom">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={`${deskBtn.action} ${deskType.btn} text-[var(--content-positive)] bg-[var(--bg-positive-subtle)] border border-[var(--border-positive)] hover:opacity-90`}
      >
        <CheckCircle size={14} weight="bold" />
        {label}
      </button>
    </DeskTooltip>
  );
}

interface DeskStaleCompleteConfirmProps {
  order: DeskOrderRow;
  onCancel: () => void;
  onDone?: () => void;
}

export function DeskStaleCompleteConfirm({
  order,
  onCancel,
  onDone,
}: DeskStaleCompleteConfirmProps): React.JSX.Element | null {
  const kind = getDeskStaleCompleteKind(order);
  const mutation = useDeskStaleComplete(order);

  if (!kind) return null;

  const handleConfirm = () => {
    mutation.mutate(undefined, {
      onSuccess: () => {
        onCancel();
        onDone?.();
      },
    });
  };

  return (
    <div
      className="border-t border-[var(--border-faint)] bg-[var(--bg-secondary)] px-3 py-2.5"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <p className={`${deskType.orderTitle} text-[var(--content-primary)]`}>
        {deskStaleCompleteConfirmTitle(kind, order)}
      </p>
      <p className={`${deskType.hint} mt-1`}>
        {deskStaleCompleteConfirmBody(order, kind)}
      </p>
      <div className="flex items-center gap-2 mt-2.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={mutation.isPending}
          className={`${deskBtn.action} ${deskType.btn} flex-1 text-[var(--content-secondary)] bg-[var(--bg-primary)] border border-[var(--border-subtle)]`}
        >
          <X size={14} weight="bold" />
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={mutation.isPending}
          className={`${deskBtn.action} ${deskType.btn} flex-[1.4] text-white bg-[var(--bg-positive)] border border-[var(--border-positive)] hover:opacity-90 disabled:opacity-50`}
        >
          <CheckCircle size={14} weight="bold" />
          {mutation.isPending ? 'Completing…' : 'Confirm complete'}
        </button>
      </div>
    </div>
  );
}
