export type PickBrandChip = 'ask' | 'lucas';

const CHIP_CLASS: Record<PickBrandChip, string> = {
  ask: 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]',
  lucas: 'border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-100',
};

const CHIP_LABEL: Record<PickBrandChip, string> = {
  ask: 'ASK',
  lucas: 'LC',
};

export function BrandLineChip({
  brand,
  count,
  className = '',
}: {
  brand: PickBrandChip;
  /** When set, shows e.g. "ASK 3" for order cards; omit for per-line chips. */
  count?: number;
  className?: string;
}): React.JSX.Element {
  const label =
    count != null && count > 0
      ? `${CHIP_LABEL[brand]} ${count}`
      : CHIP_LABEL[brand];

  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${CHIP_CLASS[brand]} ${className}`}
    >
      {label}
    </span>
  );
}
