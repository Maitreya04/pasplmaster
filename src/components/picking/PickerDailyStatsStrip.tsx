import { CheckCircle } from '@phosphor-icons/react';
import { Skeleton } from '../shared';
import type { PickerDailyStats } from '../../hooks/usePickerDailyStats';

interface PickerDailyStatsStripProps {
  stats: PickerDailyStats | undefined;
  isLoading: boolean;
}

export function PickerDailyStatsStrip({
  stats,
  isLoading,
}: PickerDailyStatsStripProps): React.JSX.Element {
  if (isLoading) {
    return (
      <div className="px-4 pt-2">
        <Skeleton variant="card" count={1} />
      </div>
    );
  }

  const orders = stats?.ordersCompleted ?? 0;
  const lines = stats?.linesCompleted ?? 0;

  return (
    <div className="px-4 pt-2">
      <div className="flex items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-positive-subtle)]">
          <CheckCircle size={22} weight="duotone" className="text-[var(--content-positive)]" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--content-tertiary)]">
            Today
          </p>
          <p className="text-sm font-bold text-[var(--content-primary)] tabular-nums">
            {orders} order{orders === 1 ? '' : 's'} · {lines} line{lines === 1 ? '' : 's'}
          </p>
        </div>
      </div>
    </div>
  );
}
