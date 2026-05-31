import { ClipboardText, CheckCircle } from '@phosphor-icons/react';
import { Skeleton } from '../shared';
import type { PickerDailyStats } from '../../hooks/usePickerDailyStats';

interface PickerDailyStatsStripProps {
  stats: PickerDailyStats | undefined;
  isLoading: boolean;
  onCompletedTap?: () => void;
}

export function PickerDailyStatsStrip({
  stats,
  isLoading,
  onCompletedTap,
}: PickerDailyStatsStripProps): React.JSX.Element {
  if (isLoading) {
    return (
      <div className="px-4 pt-2">
        <Skeleton variant="card" count={1} />
      </div>
    );
  }

  const assigned = stats?.ordersAssigned ?? 0;
  const completed = stats?.ordersCompleted ?? 0;
  const flagged = stats?.ordersFlagged ?? 0;
  const lines = stats?.linesCompleted ?? 0;

  const completedCard = (
    <>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-positive-subtle)]">
        <CheckCircle size={20} weight="duotone" className="text-[var(--content-positive)]" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--content-tertiary)]">
          Completed today
        </p>
        <p className="text-sm font-bold tabular-nums text-[var(--content-primary)]">
          {completed} order{completed === 1 ? '' : 's'}
        </p>
        {lines > 0 && (
          <p className="text-[10px] tabular-nums text-[var(--content-tertiary)]">
            {lines} line{lines === 1 ? '' : 's'}
            {flagged > 0 && ` · ${flagged} with flags`}
          </p>
        )}
        {lines === 0 && flagged > 0 && (
          <p className="text-[10px] text-[var(--content-warning)]">
            {flagged} with flags
          </p>
        )}
        {onCompletedTap && completed > 0 && (
          <p className="mt-0.5 text-[10px] font-semibold text-[var(--content-accent)]">
            Tap to view
          </p>
        )}
      </div>
    </>
  );

  return (
    <div className="px-4 pt-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-2.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-accent-subtle)]">
            <ClipboardText size={20} weight="duotone" className="text-[var(--content-accent)]" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--content-tertiary)]">
              Assigned today
            </p>
            <p className="text-sm font-bold tabular-nums text-[var(--content-primary)]">
              {assigned} order{assigned === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        {onCompletedTap ? (
          <button
            type="button"
            onClick={onCompletedTap}
            className="flex items-center gap-2.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-tertiary)] active:scale-[0.99]"
          >
            {completedCard}
          </button>
        ) : (
          <div className="flex items-center gap-2.5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2.5">
            {completedCard}
          </div>
        )}
      </div>
    </div>
  );
}
