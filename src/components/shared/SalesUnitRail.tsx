import { appHaptics } from '../../lib/haptics';
import { SALES_LINE_UNITS, salesLineUnitLabel } from '../../lib/salesUnit';
import type { SalesLineUnit } from '../../types';

export interface SalesUnitRailProps {
  value: SalesLineUnit;
  onChange: (value: SalesLineUnit) => void;
  /** Show "Sell as" label (default true). */
  showLabel?: boolean;
  className?: string;
}

export function SalesUnitRail({
  value,
  onChange,
  showLabel = true,
  className = '',
}: SalesUnitRailProps): React.JSX.Element {
  return (
    <div
      className={`flex min-w-0 items-center gap-2.5 ${className}`.trim()}
      onClick={(e) => e.stopPropagation()}
    >
      {showLabel ? (
        <span className="shrink-0 font-ds-micro font-semibold uppercase text-[var(--content-tertiary)]">
          Sell as
        </span>
      ) : null}
      <div className="grid h-10 w-[180px] max-w-[calc(100%-60px)] shrink grid-cols-3 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-0.5">
        {SALES_LINE_UNITS.map((unit) => {
          const selected = unit === value;
          return (
            <button
              key={unit}
              type="button"
              onClick={() => {
                appHaptics.selection();
                onChange(unit);
              }}
              className={`min-w-0 rounded-[10px] px-1.5 text-center font-ds-caption-size font-semibold leading-none transition-[background-color,color,box-shadow] duration-150 ${
                selected
                  ? 'bg-[var(--bg-accent)] text-[var(--content-on-color)] shadow-[0_1px_5px_color-mix(in_srgb,var(--bg-accent)_20%,transparent)]'
                  : 'text-[var(--content-secondary)] hover:bg-[var(--bg-secondary)]'
              }`}
              aria-pressed={selected}
            >
              {salesLineUnitLabel(unit)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
