import type { MouseEvent, ReactNode } from 'react';
import type { BusyEntryLineNature } from '../../../lib/billing/busyEntryLineNature';
import type { BillingFreshnessRow } from '../../../hooks/useBillingStockFreshness';
import {
  billingFreshnessChipLabel,
  billingFreshnessChipTitle,
} from '../../../hooks/useBillingStockFreshness';
import type { ItemFlag } from '../../../hooks/useBillingFlow';

type ChipTone = 'positive' | 'accent' | 'warning' | 'neutral';

function BusyEntryChip({
  tone,
  children,
  interactive = false,
  title,
  onClick,
}: {
  tone: ChipTone;
  children: ReactNode;
  interactive?: boolean;
  title?: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
}): React.JSX.Element {
  const className = [
    'busy-entry-chip',
    `busy-entry-chip--${tone}`,
    interactive ? 'busy-entry-chip--interactive' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (interactive && onClick) {
    return (
      <button type="button" className={className} title={title} onClick={onClick}>
        {children}
      </button>
    );
  }

  return (
    <span className={className} title={title}>
      {children}
    </span>
  );
}

export interface BusyEntryLineChipsProps {
  nature?: BusyEntryLineNature;
  flag?: ItemFlag;
  pendingQty?: number;
  isPending?: boolean;
  isSkip?: boolean;
  isNew?: boolean;
  isEdited?: boolean;
  fresh?: BillingFreshnessRow;
  onUndoFlag?: () => void;
  onApplyLiveStock?: () => void;
}

export function BusyEntryLineChips({
  nature = 'normal',
  flag,
  pendingQty = 0,
  isPending = false,
  isSkip = false,
  isNew = false,
  isEdited = false,
  fresh,
  onUndoFlag,
  onApplyLiveStock,
}: BusyEntryLineChipsProps): React.JSX.Element | null {
  const pendingLabel =
    pendingQty > 0
      ? `${pendingQty} pending`
      : flag?.type === 'no_stock'
        ? 'Out of stock'
        : flag?.type === 'partial'
          ? 'Partial stock'
          : null;

  const showFreshness = fresh?.isStale && fresh.liveCapacity != null;

  const hasChip =
    nature === 'foc' ||
    nature === 'special_rate' ||
    !!pendingLabel ||
    isPending ||
    (!isSkip && pendingQty > 0) ||
    isNew ||
    isEdited ||
    showFreshness;

  if (!hasChip) return null;

  return (
    <div className="busy-entry-line-chips">
      {nature === 'foc' ? <BusyEntryChip tone="positive">FOC</BusyEntryChip> : null}
      {nature === 'special_rate' ? (
        <BusyEntryChip tone="accent">Special rate</BusyEntryChip>
      ) : null}
      {isPending ? (
        <BusyEntryChip
          tone="warning"
          interactive
          title="Undo pending flag — bill this line instead (S)"
          onClick={(e) => {
            e.stopPropagation();
            onUndoFlag?.();
          }}
        >
          {flag?.type === 'partial' ? 'Partial stock' : 'Out of stock'}
        </BusyEntryChip>
      ) : null}
      {!isSkip && pendingQty > 0 ? (
        <BusyEntryChip tone="warning">{pendingQty} pending</BusyEntryChip>
      ) : null}
      {isSkip && !isPending && pendingLabel ? (
        <BusyEntryChip tone="warning">{pendingLabel}</BusyEntryChip>
      ) : null}
      {isNew ? <BusyEntryChip tone="positive">New</BusyEntryChip> : null}
      {isEdited ? <BusyEntryChip tone="accent">Edited</BusyEntryChip> : null}
      {showFreshness ? (
        fresh!.canApplyLive ? (
          <BusyEntryChip
            tone="accent"
            interactive
            title={billingFreshnessChipTitle(fresh!)}
            onClick={(e) => {
              e.stopPropagation();
              onApplyLiveStock?.();
            }}
          >
            {billingFreshnessChipLabel(fresh!)}
          </BusyEntryChip>
        ) : (
          <BusyEntryChip tone="neutral" title={billingFreshnessChipTitle(fresh!)}>
            {billingFreshnessChipLabel(fresh!)}
          </BusyEntryChip>
        )
      ) : null}
    </div>
  );
}
