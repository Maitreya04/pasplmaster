import type { PickLineMrpState } from '../../lib/picking/pickLineMrp';
import {
  getActiveSegment,
  pickLineSegmentsCommittedQty,
  pickLineSplitRemaining,
} from '../../lib/picking/pickLineMrp';

export interface PickMrpSplitProgressProps {
  lineMrp: PickLineMrpState;
  targetQty: number;
  onUndoLastSegment?: () => void;
  onResetSplitLine?: () => void;
}

export function PickMrpSplitProgress({
  lineMrp,
  targetQty,
  onUndoLastSegment,
  onResetSplitLine,
}: PickMrpSplitProgressProps): React.JSX.Element {
  const goal = lineMrp.originalTargetQty ?? targetQty;
  const committed = pickLineSegmentsCommittedQty(lineMrp);
  const remaining = pickLineSplitRemaining(lineMrp, targetQty);
  const pct = goal > 0 ? Math.min(100, (committed / goal) * 100) : 0;
  const active = getActiveSegment(lineMrp);
  const committedSegments = lineMrp.segments.filter((s) => s.committed);
  const lastCommitted = committedSegments[committedSegments.length - 1];

  return (
    <div className="mx-3 mb-2 overflow-hidden rounded-2xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] sm:mx-4">
      <div className="px-3 py-2.5 sm:px-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-warning-on-light)]">
            Split by MRP
          </p>
          <p className="font-mono text-xs font-bold tabular-nums text-[var(--content-warning-on-light)]">
            {committed} / {goal} pcs
          </p>
        </div>

        <div className="mt-2 h-1 overflow-hidden rounded bg-[var(--border-subtle)]">
          <div
            className="h-full rounded bg-[var(--bg-warning)] transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {committedSegments.map((seg, i) => (
            <span
              key={`${seg.mrp}-${i}-${seg.orderItemId ?? 'x'}`}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] px-2 py-0.5 text-[10px] font-semibold text-[var(--content-positive)]"
            >
              ₹{Math.round(seg.mrp)} ×{seg.qty} ✓
            </span>
          ))}
          {active && !active.committed ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-warning)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[10px] font-semibold text-[var(--content-warning-on-light)]">
              ₹{Math.round(active.mrp)} · picking…
            </span>
          ) : null}
        </div>

        {remaining > 0 ? (
          <p className="mt-2 text-[10px] font-medium text-[var(--content-warning-on-light)]">
            {remaining} pcs left · pick next MRP batch
          </p>
        ) : (
          <p className="mt-2 text-[10px] font-semibold text-[var(--content-positive)]">
            All batches picked · billing will see {committedSegments.length} line
            {committedSegments.length !== 1 ? 's' : ''}
          </p>
        )}

        {lastCommitted && onUndoLastSegment && remaining >= 0 ? (
          <button
            type="button"
            onClick={onUndoLastSegment}
            className="mt-2 text-[10px] font-semibold text-[var(--content-secondary)] pick-pressable"
          >
            Undo last batch (₹{Math.round(lastCommitted.mrp)} ×{lastCommitted.qty})
          </button>
        ) : null}

        {onResetSplitLine && committed > 0 ? (
          <button
            type="button"
            onClick={onResetSplitLine}
            className="mt-1 block text-[10px] font-semibold text-[var(--content-secondary)] pick-pressable"
          >
            Reset entire line
          </button>
        ) : null}
      </div>
    </div>
  );
}
