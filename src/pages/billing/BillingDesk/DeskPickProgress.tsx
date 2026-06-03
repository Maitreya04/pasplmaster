import type { PickLineProgress } from '../../../lib/cartSupply';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';
import { derivePickingMonitorPresentation } from '../../../lib/billing/pickingMonitorPresentation';
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
  if (!progress || progress.total === 0) {
    if (order.deskStatus === 'checking') return 'Pick complete · verify bill.';
    return order.deskStatus === 'picking' ? 'Pick started — loading line counts…' : 'No pickable lines';
  }
  const monitor = derivePickingMonitorPresentation({
    deskStatus: order.deskStatus,
    pickingClaimStale: order.pickingClaimStale,
    pickerName: order.picker_name,
    workflowStatus: order.workflow_status,
    progress,
  });
  const pickerFirst = order.picker_name?.split(/\s+/)[0] ?? order.picker_name ?? null;
  return monitor.progressStatusLine(progress, pickerFirst);
}

function progressInlineLabel(
  order: DeskOrderRow,
  progress: PickLineProgress | undefined,
  isLoading?: boolean,
): string {
  if (isLoading && order.deskStatus === 'picking') return 'Loading pick progress…';
  if (order.deskStatus === 'unassigned') return 'Awaiting picker';
  if (order.deskStatus === 'checking') return 'Pick complete · verify bill';
  if (progress && progress.total > 0) {
    const monitor = derivePickingMonitorPresentation({
      deskStatus: order.deskStatus,
      pickingClaimStale: order.pickingClaimStale,
      pickerName: order.picker_name,
      workflowStatus: order.workflow_status,
      progress,
    });
    if (monitor.contextNotStarted) {
      return order.picker_name
        ? `Assigned to ${order.picker_name.split(/\s+/)[0]}`
        : 'Assigned';
    }
    return `${progress.done}/${progress.total} · ${Math.round((progress.done / progress.total) * 100)}%`;
  }
  if (order.deskStatus === 'no_ack') {
    return order.picker_name
      ? `Assigned to ${order.picker_name.split(/\s+/)[0]}`
      : 'Assigned';
  }
  return 'In warehouse';
}

function progressRatio(order: DeskOrderRow, progress: PickLineProgress | undefined): number {
  if (order.deskStatus === 'checking') return 1;
  if (order.deskStatus === 'unassigned') return 0;
  if (!progress || progress.total === 0) return 0;
  return progress.done / progress.total;
}

function barColor(order: DeskOrderRow, ratio: number, progress?: PickLineProgress): string {
  if (order.deskStatus === 'checking') return 'var(--bg-positive)';
  const monitor = derivePickingMonitorPresentation({
    deskStatus: order.deskStatus,
    pickingClaimStale: order.pickingClaimStale,
    pickerName: order.picker_name,
    workflowStatus: order.workflow_status,
    progress,
  });
  if (monitor.progressWarningTint && ratio === 0) return 'var(--bg-warning)';
  if (order.pickingClaimStale) return 'var(--bg-warning)';
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
  const inlineLabel = progressInlineLabel(order, progress, isLoading);
  const pct = Math.round(ratio * 100);

  return (
    <DeskTooltip label={label} side="bottom">
      <div className="mt-2 space-y-1 cursor-default" aria-label={label}>
        <div className={`flex items-center justify-between gap-2 ${deskType.progress}`}>
          <span className="truncate">{inlineLabel}</span>
          {order.deskStatus !== 'unassigned' && (
            <span className="tabular-nums shrink-0">{pct}%</span>
          )}
        </div>
        <div className="h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: barColor(order, ratio, progress),
            }}
          />
        </div>
      </div>
    </DeskTooltip>
  );
}
