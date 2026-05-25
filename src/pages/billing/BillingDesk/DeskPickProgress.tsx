import type { PickLineProgress } from '../../../lib/cartSupply';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import { DeskTooltip } from './DeskTooltip';
import { deskType } from './deskTypography';

interface DeskPickProgressProps {
  order: DeskOrderRow;
  progress: PickLineProgress | undefined;
  isLoading?: boolean;
  /** Hide the empty progress bar on unassigned rows — assign lives in the toolbar. */
  compact?: boolean;
}

function progressLabel(order: DeskOrderRow, progress: PickLineProgress | undefined): string {
  if (order.deskStatus === 'unassigned') {
    return 'Waiting for picker — use Assign on this row.';
  }
  if (order.deskStatus === 'checking') {
    return 'All pick lines done — at check table or dispatch.';
  }
  if (order.deskStatus === 'no_ack') {
    return 'Assigned — waiting for picker to tap Start.';
  }
  if (!progress || progress.total === 0) {
    return order.deskStatus === 'picking' ? 'Pick started — loading line counts…' : 'No pickable lines';
  }
  const parts = [`${progress.done}/${progress.total} lines done`];
  if (progress.picked > 0) parts.push(`${progress.picked} picked`);
  if (progress.flagged > 0) parts.push(`${progress.flagged} flagged`);
  if (progress.remaining > 0) parts.push(`${progress.remaining} left`);
  return parts.join(' · ');
}

function progressRatio(order: DeskOrderRow, progress: PickLineProgress | undefined): number {
  if (order.deskStatus === 'checking') return 1;
  if (order.deskStatus === 'unassigned') return 0;
  if (!progress || progress.total === 0) return 0;
  return progress.done / progress.total;
}

function barColor(order: DeskOrderRow, ratio: number): string {
  if (order.deskStatus === 'checking') return 'var(--bg-positive)';
  if (order.pickingClaimStale || order.deskStatus === 'no_ack') return 'var(--bg-warning)';
  if (ratio >= 0.8) return 'var(--bg-positive)';
  return 'var(--role-primary)';
}

export function DeskPickProgress({
  order,
  progress,
  isLoading,
  compact,
}: DeskPickProgressProps): React.JSX.Element | null {
  const showBar =
    order.deskStatus === 'picking' ||
    order.deskStatus === 'checking' ||
    order.deskStatus === 'no_ack' ||
    (order.deskStatus === 'unassigned' && !compact);

  if (!showBar) return null;

  const ratio = progressRatio(order, progress);
  const label = progressLabel(order, progress);
  const pct = Math.round(ratio * 100);

  return (
    <DeskTooltip label={label} side="bottom">
      <div className="mt-2 space-y-1 cursor-default" aria-label={label}>
        <div className={`flex items-center justify-between gap-2 ${deskType.progress}`}>
          <span className="truncate">
            {isLoading && order.deskStatus === 'picking'
              ? 'Loading pick progress…'
              : order.deskStatus === 'unassigned'
                ? 'Awaiting picker'
              : order.deskStatus === 'no_ack'
                ? 'Waiting to start'
                : order.deskStatus === 'checking'
                  ? 'Pick complete'
                  : progress && progress.total > 0
                    ? `${progress.done}/${progress.total} lines`
                    : 'In warehouse'}
          </span>
          {order.deskStatus !== 'unassigned' && (
            <span className="tabular-nums shrink-0">{pct}%</span>
          )}
        </div>
        <div className="h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: barColor(order, ratio),
            }}
          />
        </div>
      </div>
    </DeskTooltip>
  );
}
