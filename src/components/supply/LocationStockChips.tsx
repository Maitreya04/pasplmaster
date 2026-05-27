import type { ItemLocationStock } from '../../hooks/useLocationwiseStock';
import { isLocationwiseStockResolving } from '../../hooks/useLocationwiseStock';
import { formatStockQty, getStockTier } from '../../lib/stockDisplay';

function stockQtyClass(qty: number | null | undefined): string {
  const tier = getStockTier(qty);
  if (tier === 'ok') return 'text-[var(--content-positive)]';
  if (tier === 'low') return 'text-[var(--content-warning)]';
  if (tier === 'out') return 'text-[var(--content-negative)]';
  return 'text-[var(--content-tertiary)]';
}

function StockQtyCell({
  label,
  qty,
  loading,
}: {
  label: string;
  qty: number | null | undefined;
  loading: boolean;
}) {
  if (loading) {
    return (
      <span className="inline-flex items-center rounded-md bg-[var(--bg-primary)] px-2 py-0.5 text-xs text-[var(--content-tertiary)]">
        {label} …
      </span>
    );
  }
  if (qty == null || !Number.isFinite(Number(qty))) {
    return (
      <span className="inline-flex items-center rounded-md bg-[var(--bg-primary)] px-2 py-0.5 text-xs text-[var(--content-tertiary)]">
        {label} —
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--bg-primary)] px-2 py-0.5 text-xs">
      <span className="font-medium text-[var(--content-secondary)]">{label}</span>
      <span className={`font-mono font-semibold tabular-nums ${stockQtyClass(qty)}`}>
        {formatStockQty(Number(qty))}
      </span>
    </span>
  );
}

export function LocationStockChips({
  stock,
  busyCode,
  loading,
  className = 'mt-3',
}: {
  stock: ItemLocationStock | undefined;
  busyCode: number | null | undefined;
  loading: boolean;
  className?: string;
}) {
  const resolving =
    busyCode != null &&
    Number.isFinite(busyCode) &&
    isLocationwiseStockResolving(busyCode, loading);

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <StockQtyCell label="Indore" qty={stock?.mainStoreStockQty} loading={resolving} />
      <StockQtyCell label="Jabalpur" qty={stock?.jabalpurStockQty} loading={resolving} />
    </div>
  );
}
