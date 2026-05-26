import { useMemo } from 'react';
import type { OrderWithClaimInfo } from '../../hooks/useClaimableOrders';
import { InitialsAvatar, StatusBadge } from '../shared';
import { TransportChip } from './TransportChip';
import {
  formatBilledTime,
  formatLineCountLabel,
  pickProgressFromPreview,
} from '../../lib/picking/pickQueueDisplay';
import {
  activePickStatus,
  activePickStatusLabel,
  isPickStarted,
} from '../../lib/picking/pickLifecycle';

function pickerLineCount(order: { pick_line_count?: number; item_count: number }): number {
  return order.pick_line_count ?? order.item_count;
}

interface ActivePickRowProps {
  order: OrderWithClaimInfo;
  isMine: boolean;
  onOpen?: () => void;
}

export function ActivePickRow({
  order,
  isMine,
  onOpen,
}: ActivePickRowProps): React.JSX.Element {
  const preview = order.order_items_preview;
  const progress = pickProgressFromPreview(preview);
  const status = activePickStatus(order, progress.ratio);
  const statusLabel = activePickStatusLabel(status);
  const pickerName = order.claim_info?.claimed_by_name ?? order.picker_name ?? 'Unknown';
  const lineCount = pickerLineCount(order);
  const started = isPickStarted(order.workflow_status);
  const billed = formatBilledTime(order.approved_at, order.created_at);

  const statusTone =
    status === 'stale'
      ? 'text-[var(--content-warning)] bg-[var(--bg-warning-subtle)]'
      : status === 'almost_done'
        ? 'text-[var(--content-positive)] bg-[var(--bg-positive-subtle)]'
        : status === 'not_started'
          ? 'text-[var(--content-accent)] bg-[var(--bg-accent-subtle)]'
          : 'text-[var(--content-secondary)] bg-[var(--bg-tertiary)]';

  const shellClass = `
    w-full rounded-2xl border p-4 text-left transition-all duration-150
    ${
      isMine
        ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]'
        : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]'
    }
    ${onOpen ? 'hover:bg-[var(--bg-tertiary)] active:scale-[0.99]' : ''}
  `;

  const content = (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-[var(--content-primary)] truncate">
              {order.order_number}
            </p>
            {order.priority === 'urgent' && (
              <StatusBadge status="urgent" className="!h-5 !px-2 text-[10px]" />
            )}
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusTone}`}
            >
              {statusLabel}
            </span>
          </div>
          {billed && (
            <p className="text-[11px] tabular-nums text-[var(--content-tertiary)]">
              Billed {billed}
            </p>
          )}
          <p className="mt-0.5 truncate text-sm text-[var(--content-secondary)]">
            {order.customer_name}
          </p>
        </div>
        <InitialsAvatar name={pickerName} size="sm" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {order.transport_name ? (
          <TransportChip name={order.transport_name} size="sm" />
        ) : (
          <span className="text-[10px] font-semibold text-[var(--content-warning)]">
            No transport
          </span>
        )}
        <span className="text-xs tabular-nums text-[var(--content-tertiary)]">
          {formatLineCountLabel(lineCount, { short: true })}
        </span>
        {isMine && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--content-warning)]">
            You
          </span>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-[var(--content-tertiary)]">
          <span>{pickerName}</span>
          {started && progress.total > 0 ? (
            <span className="tabular-nums">
              {progress.done}/{progress.total} lines
            </span>
          ) : (
            <span>Waiting to start</span>
          )}
        </div>
        {started && progress.total > 0 && (
          <div className="h-1 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
            <div
              className="h-full bg-[var(--content-secondary)] transition-all duration-300"
              style={{ width: `${Math.round(progress.ratio * 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );

  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} className={shellClass}>
        {content}
      </button>
    );
  }

  return (
    <div className={shellClass}>
      {content}
    </div>
  );
}

export function useActivePickBoardOrders(
  myActive: OrderWithClaimInfo[],
  otherActive: OrderWithClaimInfo[],
): OrderWithClaimInfo[] {
  return useMemo(() => {
    const combined = [...myActive, ...otherActive];
    return combined.sort((a, b) => {
      if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
      if (a.priority !== 'urgent' && b.priority === 'urgent') return 1;
      const aStarted = isPickStarted(a.workflow_status) ? 0 : 1;
      const bStarted = isPickStarted(b.workflow_status) ? 0 : 1;
      if (aStarted !== bStarted) return aStarted - bStarted;
      const aTime = new Date(a.claim_info?.claimed_at ?? a.approved_at ?? a.created_at).getTime();
      const bTime = new Date(b.claim_info?.claimed_at ?? b.approved_at ?? b.created_at).getTime();
      return aTime - bTime;
    });
  }, [myActive, otherActive]);
}
