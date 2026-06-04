import { busyPasteUnitLabel, normalizeSalesLineUnit } from '../../lib/salesUnit';
import type { SalesLineUnit } from '../../types';

export interface SalesUnitBadgeProps {
  unit: SalesLineUnit | unknown;
  /** Emphasize Kit / Set badges. */
  emphasizeNonPcs?: boolean;
  className?: string;
}

/** Read-only Kit / Set label for cart review and billing display. Hidden when default (pcs). */
export function SalesUnitBadge({
  unit,
  emphasizeNonPcs = true,
  className = '',
}: SalesUnitBadgeProps): React.JSX.Element | null {
  const normalized = normalizeSalesLineUnit(unit);
  const label = busyPasteUnitLabel(normalized);
  if (!label) return null;

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 font-ds-caption-size font-bold leading-none tabular-nums ${
        emphasizeNonPcs
          ? 'border-[color-mix(in_srgb,var(--bg-accent)_35%,var(--border-subtle))] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
          : 'border-[var(--border-faint)] bg-[var(--bg-tertiary)] text-[var(--content-secondary)]'
      } ${className}`.trim()}
      title={`Selling as ${label}`}
    >
      {label}
    </span>
  );
}
