import type { Item } from '../../types';
import { salesUnitsForItem, stockQtyInSalesUnit } from '../../lib/sales/sellingUnits';

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
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          onTap();
        },
      };

  if (oos) {
    return (
      <span
        className="inline-flex min-h-9 items-center rounded-full border border-[var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--content-quaternary)] line-through"
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
        className="inline-flex min-h-9 items-center rounded-full border border-[var(--bg-accent)] bg-[var(--bg-accent)] px-3 py-1.5 text-xs font-medium text-[var(--content-on-color)]"
      >
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      {...touchHandlers}
      className="inline-flex min-h-9 items-center rounded-full border border-[var(--border-opaque)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-xs font-medium text-[var(--content-secondary)]"
    >
      {label}
    </button>
  );
}

interface SellAsPillsProps {
  item: Item;
  selectedUnit: string | null;
  onSelectUnit: (unitId: string) => void;
  sellableEa: number | null | undefined;
}

/** Inline Kit / Set / Nos picker on the product card (after tapping +). */
export function SellAsPills({
  item,
  selectedUnit,
  onSelectUnit,
  sellableEa,
}: SellAsPillsProps): React.JSX.Element | null {
  const units = salesUnitsForItem(item);
  if (units.length < 2) return null;

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="shrink-0 font-ds-caption-size font-medium text-[var(--content-tertiary)]">
        Sell as
      </span>
      {units.map((unit) => {
        const stock = stockQtyInSalesUnit(sellableEa, item, unit.id);
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
      })}
    </div>
  );
}
