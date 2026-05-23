import { useState } from 'react';
import { CheckCircle, Flag, MapPin, ArrowDown } from '@phosphor-icons/react';
import { BottomSheet, BigButton } from '../../components/shared';

export type QueueSheetRowStatus = 'now' | 'next' | 'picked' | 'flagged' | 'skipped';

export interface QueueSheetRow {
  itemId: number;
  rackNo: string | null;
  itemCode: string | null;
  itemName: string;
  targetQty: number;
  status: QueueSheetRowStatus;
}

export interface QueueSheetCounts {
  picked: number;
  flagged: number;
  remaining: number;
  total: number;
  packAssisted: number;
  manual: number;
  reasonBadges: [string, number][];
}

interface QueueSheetProps {
  isOpen: boolean;
  onClose: () => void;
  rows: QueueSheetRow[];
  counts: QueueSheetCounts;
  onSkipItem: (itemId: number, reason: string) => void;
  /** Item id currently being processed (highlighted as "Now"). */
  currentItemId: number | null;
  /** When set, rows become tappable to jump to that card in the deck. */
  onJump?: (itemId: number) => void;
}

const SKIP_REASONS = [
  'Need ladder',
  'Box buried',
  'Out of stock here',
  'Wrong location',
  'Other',
];

export function QueueSheet({
  isOpen,
  onClose,
  rows,
  counts,
  onSkipItem,
  currentItemId,
  onJump,
}: QueueSheetProps): React.JSX.Element | null {
  const [skipTargetId, setSkipTargetId] = useState<number | null>(null);
  const [skipReason, setSkipReason] = useState<string>('');

  const now = rows.find((r) => r.itemId === currentItemId);
  const nextRows = rows.filter(
    (r) => r.status === 'next' && r.itemId !== currentItemId,
  );
  const skippedRows = rows.filter((r) => r.status === 'skipped');
  const doneRows = rows.filter((r) => r.status === 'picked' || r.status === 'flagged');

  function commitSkip() {
    if (skipTargetId === null || !skipReason.trim()) return;
    onSkipItem(skipTargetId, skipReason.trim());
    setSkipTargetId(null);
    setSkipReason('');
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Pick queue">
      <div className="space-y-5">
        {/* Counts header */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-[var(--bg-positive-subtle)] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-positive)]">Done</p>
            <p className="font-mono font-bold text-2xl text-[var(--content-positive)] leading-tight">
              {counts.picked}
            </p>
            <p className="text-[10px] text-[var(--content-positive)]/70">lines</p>
          </div>
          <div className="rounded-xl bg-[var(--bg-tertiary)] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">Left</p>
            <p className="font-mono font-bold text-2xl text-[var(--content-primary)] leading-tight">
              {counts.remaining}
            </p>
            <p className="text-[10px] text-[var(--content-tertiary)]">lines</p>
          </div>
          <div className="rounded-xl bg-[var(--bg-negative-subtle)] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-negative)]">Flagged</p>
            <p className="font-mono font-bold text-2xl text-[var(--content-negative)] leading-tight">
              {counts.flagged}
            </p>
            <p className="text-[10px] text-[var(--content-negative)]/70">lines</p>
          </div>
        </div>

        {/* Audit chips — relegated from header so they don't clutter the operating view */}
        {(counts.packAssisted > 0 || counts.manual > 0 || counts.reasonBadges.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {counts.packAssisted > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[10px] text-[var(--content-tertiary)]">
                Pack-assisted: {counts.packAssisted}
              </span>
            )}
            {counts.manual > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[10px] text-[var(--content-tertiary)]">
                Manual: {counts.manual}
              </span>
            )}
            {counts.reasonBadges.map(([reason, total]) => (
              <span
                key={reason}
                className="px-2 py-0.5 rounded-full bg-[var(--bg-negative-subtle)] text-[10px] text-[var(--content-negative)]"
              >
                {reason}: {total}
              </span>
            ))}
          </div>
        )}

        {/* Now */}
        {now && (
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)] mb-2">
              Now
            </p>
            <Row row={now} highlighted onJump={onJump} />
          </section>
        )}

        {/* Up next */}
        {nextRows.length > 0 && (
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)] mb-2">
              Up next ({nextRows.length})
            </p>
            <div className="space-y-1.5">
              {nextRows.map((r) => (
                <Row
                  key={r.itemId}
                  row={r}
                  onJump={onJump}
                  onSkip={skipTargetId === null ? () => {
                    setSkipTargetId(r.itemId);
                    setSkipReason('');
                  } : undefined}
                />
              ))}
            </div>
          </section>
        )}

        {/* Skipped */}
        {skippedRows.length > 0 && (
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-warning-on-light)] mb-2">
              Skipped — come back ({skippedRows.length})
            </p>
            <div className="space-y-1.5">
              {skippedRows.map((r) => (
                <Row key={r.itemId} row={r} onJump={onJump} />
              ))}
            </div>
          </section>
        )}

        {/* Done — collapsed by default */}
        {doneRows.length > 0 && (
          <DoneSection rows={doneRows} />
        )}
      </div>

      {/* Skip reason inline confirm */}
      {skipTargetId !== null && (
        <div className="fixed left-0 right-0 bottom-0 z-[70] p-4 bg-[var(--bg-secondary)] border-t border-[var(--border-subtle)] space-y-3">
          <p className="text-sm font-semibold text-[var(--content-primary)]">
            Skip & come back
          </p>
          <p className="text-xs text-[var(--content-tertiary)]">
            Pick a reason. The item moves to the end of the queue and stays available.
          </p>
          <div className="flex flex-wrap gap-2">
            {SKIP_REASONS.map((r) => (
              <button
                key={r}
                onClick={() => setSkipReason(r)}
                className={`
                  px-3 py-2 rounded-full text-xs font-medium pick-pressable
                  ${skipReason === r
                    ? 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)] ring-1 ring-[var(--border-warning)]'
                    : 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)]'}
                `}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <BigButton
              variant="secondary"
              onClick={() => {
                setSkipTargetId(null);
                setSkipReason('');
              }}
              className="flex-1"
            >
              Cancel
            </BigButton>
            <BigButton
              variant="primary"
              onClick={commitSkip}
              disabled={!skipReason}
              className="flex-1 bg-[var(--bg-warning)] text-[var(--content-primary)]"
            >
              Skip
            </BigButton>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

function Row({
  row,
  highlighted = false,
  onSkip,
  onJump,
}: {
  row: QueueSheetRow;
  highlighted?: boolean;
  onSkip?: () => void;
  onJump?: (itemId: number) => void;
}) {
  const isPicked = row.status === 'picked';
  const isFlagged = row.status === 'flagged';
  const isSkipped = row.status === 'skipped';
  const canJump = onJump && row.status !== 'picked' && row.status !== 'flagged';

  const inner = (
    <>
      <div className="flex items-center gap-1 shrink-0">
        {isPicked ? (
          <CheckCircle size={16} weight="fill" className="text-[var(--content-positive)]" />
        ) : isFlagged ? (
          <Flag size={16} weight="fill" className="text-[var(--content-negative)]" />
        ) : (
          <MapPin size={14} weight="regular" className="text-[var(--content-tertiary)]" />
        )}
        <span className="font-mono text-xs font-bold text-[var(--content-primary)] min-w-12">
          {row.rackNo ?? '—'}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs text-[var(--content-secondary)] truncate">
          {row.itemCode ?? row.itemId}
        </p>
        <p className="text-xs text-[var(--content-tertiary)] truncate">
          {row.itemName}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-mono text-sm font-semibold text-[var(--content-primary)] tabular-nums">
          {row.targetQty} pcs
        </p>
        {onSkip && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSkip();
            }}
            className="text-[10px] font-medium text-[var(--content-warning-on-light)] underline mt-0.5"
          >
            Skip
          </button>
        )}
      </div>
    </>
  );

  if (canJump) {
    return (
      <button
        type="button"
        onClick={() => onJump(row.itemId)}
        className={`
          flex w-full items-center gap-3 px-3 py-2.5 rounded-xl border-[1.5px] text-left pick-pressable
          ${highlighted
            ? 'bg-[var(--bg-secondary)] border-[var(--border-selected)]'
            : isSkipped
              ? 'bg-[var(--bg-warning-subtle)] border-[var(--border-warning)]'
              : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)]'}
        `}
      >
        {inner}
      </button>
    );
  }

  return (
    <div
      className={`
        flex items-center gap-3 px-3 py-2.5 rounded-xl border-[1.5px]
        ${highlighted
          ? 'bg-[var(--bg-secondary)] border-[var(--border-selected)]'
          : isSkipped
            ? 'bg-[var(--bg-warning-subtle)] border-[var(--border-warning)]'
            : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)]'}
      `}
    >
      {inner}
    </div>
  );
}

function DoneSection({ rows }: { rows: QueueSheetRow[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)] mb-2 pick-pressable"
      >
        <ArrowDown
          size={12}
          weight="bold"
          className={expanded ? 'rotate-0' : '-rotate-90'}
          style={{ transition: 'transform 160ms cubic-bezier(0.23, 1, 0.32, 1)' }}
        />
        Done ({rows.length})
      </button>
      {expanded && (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <Row key={r.itemId} row={r} />
          ))}
        </div>
      )}
    </section>
  );
}
