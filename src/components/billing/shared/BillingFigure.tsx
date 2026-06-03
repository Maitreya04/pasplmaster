import { useLayoutEffect, useRef, useState } from 'react';

export type BillingFigureKind = 'currency' | 'currency-raw' | 'integer' | 'decimal' | 'text';

export function formatBillingFigure(
  value: number | string,
  kind: BillingFigureKind = 'integer',
): string {
  if (kind === 'text') return String(value);
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';

  switch (kind) {
    case 'currency':
      return n <= 0
        ? '—'
        : new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0,
          }).format(n);
    case 'currency-raw':
      return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
    case 'decimal':
      return n.toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
    default:
      return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
}

type BillingFigureSize = 'xs' | 'sm' | 'md' | 'lg' | 'stat' | 'inherit';

const SIZE_CLASS: Record<BillingFigureSize, string> = {
  xs: 'text-xs font-semibold',
  sm: 'text-sm font-bold',
  md: 'text-base font-bold',
  lg: 'text-lg font-bold',
  stat: 'billing-figure--stat',
  inherit: '',
};

interface BillingFigureProps {
  value: number | string;
  kind?: BillingFigureKind;
  size?: BillingFigureSize;
  className?: string;
  /** When true, native title shows full value only if the cell clips (overflow safety net). */
  titleOnOverflowOnly?: boolean;
}

/**
 * Billing numbers — never ellipsized. Uses nowrap + shrink-0; parent scrolls or wraps.
 * Full value is always available via title (or overflow-only title when configured).
 */
export function BillingFigure({
  value,
  kind = 'integer',
  size = 'md',
  className = '',
  titleOnOverflowOnly = false,
}: BillingFigureProps): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const formatted = formatBillingFigure(value, kind);
  const [title, setTitle] = useState<string | undefined>(
    titleOnOverflowOnly ? undefined : formatted,
  );

  useLayoutEffect(() => {
    if (!titleOnOverflowOnly) {
      setTitle(formatted);
      return;
    }
    const el = ref.current;
    if (!el) return;

    const sync = (): void => {
      setTitle(el.scrollWidth > el.clientWidth + 1 ? formatted : undefined);
    };

    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [formatted, titleOnOverflowOnly]);

  const sizeClass = SIZE_CLASS[size];

  return (
    <span
      ref={ref}
      className={`billing-figure tabular-nums whitespace-nowrap shrink-0 ${sizeClass} ${className}`.trim()}
      title={title}
    >
      {formatted}
    </span>
  );
}
