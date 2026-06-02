import { createPortal } from 'react-dom';
import { CaretDown, CaretUp, Check } from '@phosphor-icons/react';
import { useKeyboardHeight } from '../../hooks/useKeyboardHeight';
import type { Item } from '../../types';
import {
  parseSalesSellingUnits,
  salesUnitsForItem,
  stockQtyInSalesUnit,
} from '../../lib/sales/sellingUnits';

interface KeyboardAccessoryBarProps {
  activeItem: Item | null;
  selectedUnit: string | null;
  onSelectUnit: (unitId: string) => void;
  onConfirm: () => void;
  onNavPrev?: () => void;
  onNavNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  sellableEa: number | null | undefined;
}

function preventFocusLoss(e: React.MouseEvent | React.TouchEvent) {
  e.preventDefault();
}

function UnitPill({
  label,
  selected,
  oos,
  onTap,
}: {
  label: string;
  selected: boolean;
  oos: boolean;
  onTap: () => void;
}): React.JSX.Element {
  const touchHandlers = oos
    ? {}
    : {
        onMouseDown: preventFocusLoss,
        onTouchStart: preventFocusLoss,
        onClick: onTap,
      };

  if (oos) {
    return (
      <span
        className="inline-flex min-h-[44px] items-center rounded-full border border-white/10 px-[11px] py-[11px] text-xs font-medium text-white/20 line-through"
        aria-disabled
      >
        {label}
      </span>
    );
  }

  if (selected) {
    return (
      <button
        type="button"
        {...touchHandlers}
        className="inline-flex min-h-[44px] items-center rounded-full bg-[#378ADD] border border-[#378ADD] px-[11px] py-[11px] text-xs font-medium text-white"
      >
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      {...touchHandlers}
      className="inline-flex min-h-[44px] items-center rounded-full border border-white/20 px-[11px] py-[11px] text-xs font-medium text-white/60"
    >
      {label}
    </button>
  );
}

function ConfirmButton({
  enabled,
  onTap,
}: {
  enabled: boolean;
  onTap: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={!enabled}
      onMouseDown={enabled ? preventFocusLoss : undefined}
      onTouchStart={enabled ? preventFocusLoss : undefined}
      onClick={enabled ? onTap : undefined}
      className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg transition-colors ${
        enabled ? 'bg-[#378ADD] text-white cursor-pointer' : 'bg-[#3A3A3C] text-white/20 cursor-default'
      }`}
      aria-label="Confirm quantity"
    >
      <Check size={16} weight="bold" />
    </button>
  );
}

export function KeyboardAccessoryBar({
  activeItem,
  selectedUnit,
  onSelectUnit,
  onConfirm,
  onNavPrev,
  onNavNext,
  hasPrev = false,
  hasNext = false,
  sellableEa,
}: KeyboardAccessoryBarProps): React.JSX.Element | null {
  const keyboardHeight = useKeyboardHeight();

  if (!activeItem || keyboardHeight === 0) return null;

  const units = salesUnitsForItem(activeItem);
  const parsed = parseSalesSellingUnits(activeItem.sales_selling_units);
  const showPills = parsed.length >= 2;
  const singleUnit = parsed.length === 1 ? parsed[0] : null;
  const canConfirm = selectedUnit !== null;

  return createPortal(
    <div
      role="toolbar"
      aria-label="Unit of sale"
      className="fixed left-0 right-0 z-[9999] flex h-[46px] items-center gap-2 px-2.5"
      style={{
        bottom: keyboardHeight,
        background: '#1C1C1E',
      }}
    >
      <div className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          disabled={!hasPrev}
          onMouseDown={hasPrev ? preventFocusLoss : undefined}
          onTouchStart={hasPrev ? preventFocusLoss : undefined}
          onClick={hasPrev ? onNavPrev : undefined}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white/50 disabled:opacity-30"
          aria-label="Previous item"
        >
          <CaretUp size={18} weight="bold" />
        </button>
        <button
          type="button"
          disabled={!hasNext}
          onMouseDown={hasNext ? preventFocusLoss : undefined}
          onTouchStart={hasNext ? preventFocusLoss : undefined}
          onClick={hasNext ? onNavNext : undefined}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-white/50 disabled:opacity-30"
          aria-label="Next item"
        >
          <CaretDown size={18} weight="bold" />
        </button>
      </div>

      <div className="h-[22px] w-px shrink-0 bg-white/15" aria-hidden />

      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="shrink-0 text-[11px] text-white/40">Unit</span>
        {showPills ? (
          units.map((unit) => {
            const stock = stockQtyInSalesUnit(sellableEa, activeItem, unit.id);
            const isOos = stock === 0;
            return (
              <UnitPill
                key={unit.id}
                label={unit.label}
                selected={selectedUnit === unit.id}
                oos={isOos}
                onTap={() => onSelectUnit(unit.id)}
              />
            );
          })
        ) : singleUnit ? (
          <span className="text-xs font-medium text-white/70">
            per {singleUnit.label.toLowerCase()} 🔒
          </span>
        ) : (
          <span className="text-xs font-medium text-white/50">Unit</span>
        )}
      </div>

      <ConfirmButton enabled={canConfirm} onTap={onConfirm} />
    </div>,
    document.body,
  );
}
