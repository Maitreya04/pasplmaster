import { useCallback, useMemo, useState } from 'react';
import { ArrowDown, CheckCircle, Flag, MapPin, SkipForward } from '@phosphor-icons/react';
import { BottomSheet, BigButton } from '../../components/shared';
import { TransportChip } from '../../components/picking/TransportChip';
import { useSwipeReveal } from '../../hooks/useSwipeReveal';

const SWIPE_ACTION_BUTTON_WIDTH = 80;

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
  transportName?: string | null;
  customerName?: string | null;
  /** When set, rows become tappable to jump to that card in the deck. */
  onJump?: (itemId: number) => void;
  /** Swipe-left to mark a line complete without leaving the queue. */
  onCompleteItem?: (itemId: number) => void;
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
  transportName,
  customerName,
  onJump,
  onCompleteItem,
}: QueueSheetProps): React.JSX.Element | null {
  const [skipTargetId, setSkipTargetId] = useState<number | null>(null);
  const [skipReason, setSkipReason] = useState<string>('');
  const [openSwipeItemId, setOpenSwipeItemId] = useState<number | null>(null);

  const closeSwipe = useCallback(() => setOpenSwipeItemId(null), []);

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
        {(transportName || customerName) && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2.5 space-y-1.5">
            {customerName && (
              <p className="text-sm font-semibold text-[var(--content-primary)] truncate">
                {customerName}
              </p>
            )}
            {transportName ? (
              <TransportChip name={transportName} size="md" />
            ) : (
              <p className="text-xs font-semibold text-[var(--content-warning)]">
                No transport set
              </p>
            )}
          </div>
        )}

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

        {onCompleteItem && (
          <p className="text-[11px] text-[var(--content-tertiary)]">
            Swipe left on a line to pick or skip without leaving the queue.
          </p>
        )}

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
            <Row
              row={now}
              highlighted
              onJump={onJump}
              onCompleteItem={onCompleteItem}
              isSwipeOpen={openSwipeItemId === now.itemId}
              onSwipeOpenChange={(open) => setOpenSwipeItemId(open ? now.itemId : null)}
              onSkip={() => {
                closeSwipe();
                setSkipTargetId(now.itemId);
                setSkipReason('');
              }}
            />
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
                  onCompleteItem={onCompleteItem}
                  isSwipeOpen={openSwipeItemId === r.itemId}
                  onSwipeOpenChange={(open) => setOpenSwipeItemId(open ? r.itemId : null)}
                  onSkip={skipTargetId === null ? () => {
                    closeSwipe();
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
                <Row
                  key={r.itemId}
                  row={r}
                  onJump={onJump}
                  onCompleteItem={onCompleteItem}
                  isSwipeOpen={openSwipeItemId === r.itemId}
                  onSwipeOpenChange={(open) => setOpenSwipeItemId(open ? r.itemId : null)}
                />
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
  onCompleteItem,
  isSwipeOpen = false,
  onSwipeOpenChange,
}: {
  row: QueueSheetRow;
  highlighted?: boolean;
  onSkip?: () => void;
  onJump?: (itemId: number) => void;
  onCompleteItem?: (itemId: number) => void;
  isSwipeOpen?: boolean;
  onSwipeOpenChange?: (open: boolean) => void;
}) {
  const isPicked = row.status === 'picked';
  const isFlagged = row.status === 'flagged';
  const isSkipped = row.status === 'skipped';
  const canJump = Boolean(onJump && row.status !== 'picked' && row.status !== 'flagged');
  const canSwipe = Boolean(onCompleteItem && !isPicked && !isFlagged);

  if (canSwipe) {
    return (
      <SwipeableQueueRow
        row={row}
        highlighted={highlighted}
        isSkipped={isSkipped}
        canJump={canJump}
        onJump={onJump}
        onSkip={onSkip}
        onCompleteItem={onCompleteItem!}
        isOpen={isSwipeOpen}
        onOpenChange={onSwipeOpenChange ?? (() => {})}
      />
    );
  }

  return (
    <StaticQueueRow
      row={row}
      highlighted={highlighted}
      isPicked={isPicked}
      isFlagged={isFlagged}
      isSkipped={isSkipped}
      canJump={canJump}
      onJump={onJump}
    />
  );
}

function QueueRowContent({
  row,
  isPicked,
  isFlagged,
}: {
  row: QueueSheetRow;
  isPicked: boolean;
  isFlagged: boolean;
}) {
  return (
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
      </div>
    </>
  );
}

function rowSurfaceClass(highlighted: boolean, isSkipped: boolean): string {
  if (highlighted) {
    return 'bg-[var(--bg-secondary)] border-[var(--border-selected)]';
  }
  if (isSkipped) {
    return 'bg-[var(--bg-warning-subtle)] border-[var(--border-warning)]';
  }
  return 'bg-[var(--bg-secondary)] border-[var(--border-subtle)]';
}

function StaticQueueRow({
  row,
  highlighted,
  isPicked,
  isFlagged,
  isSkipped,
  canJump,
  onJump,
}: {
  row: QueueSheetRow;
  highlighted: boolean;
  isPicked: boolean;
  isFlagged: boolean;
  isSkipped: boolean;
  canJump: boolean;
  onJump?: (itemId: number) => void;
}) {
  const inner = (
    <QueueRowContent row={row} isPicked={isPicked} isFlagged={isFlagged} />
  );

  if (canJump && onJump) {
    return (
      <button
        type="button"
        onClick={() => onJump(row.itemId)}
        className={`
          flex w-full items-center gap-3 px-3 py-2.5 rounded-xl border-[1.5px] text-left pick-pressable
          ${rowSurfaceClass(highlighted, isSkipped)}
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
        ${rowSurfaceClass(highlighted, isSkipped)}
      `}
    >
      {inner}
    </div>
  );
}

function SwipeableQueueRow({
  row,
  highlighted,
  isSkipped,
  canJump,
  onJump,
  onSkip,
  onCompleteItem,
  isOpen,
  onOpenChange,
}: {
  row: QueueSheetRow;
  highlighted: boolean;
  isSkipped: boolean;
  canJump: boolean;
  onJump?: (itemId: number) => void;
  onSkip?: () => void;
  onCompleteItem: (itemId: number) => void;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const actions = useMemo(() => {
    const next = [];
    if (onSkip) {
      next.push({ id: 'skip', widthPx: SWIPE_ACTION_BUTTON_WIDTH });
    }
    next.push({ id: 'pick', widthPx: SWIPE_ACTION_BUTTON_WIDTH });
    return next;
  }, [onSkip]);

  const { panelRef, bind, close } = useSwipeReveal({
    actions,
    isOpen,
    onOpenChange,
  });

  return (
    <div className="relative overflow-hidden rounded-xl">
      <div className="absolute inset-y-0 right-0 flex">
        {onSkip && (
          <button
            type="button"
            onClick={() => {
              close();
              onSkip();
            }}
            className="flex w-20 flex-col items-center justify-center gap-1 border-l border-[color-mix(in_srgb,var(--border-warning)_42%,var(--border-subtle))] bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]"
            aria-label={`Skip ${row.itemName}`}
          >
            <SkipForward size={20} weight="bold" />
            <span className="text-xs font-semibold">Skip</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            close();
            onCompleteItem(row.itemId);
          }}
          className="flex w-20 flex-col items-center justify-center gap-1 border-l border-[color-mix(in_srgb,var(--border-positive)_42%,var(--border-subtle))] bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]"
          aria-label={`Mark ${row.itemName} as picked`}
        >
          <CheckCircle size={20} weight="bold" />
          <span className="text-xs font-semibold">Pick</span>
        </button>
      </div>

      <div
        ref={panelRef}
        className={`
          relative flex items-center gap-3 border-[1.5px] px-3 py-2.5
          ${rowSurfaceClass(highlighted, isSkipped)}
          ${isOpen ? 'z-10 shadow-[0_8px_20px_rgba(15,23,42,0.06)]' : ''}
        `}
        style={{ touchAction: 'pan-y pinch-zoom' }}
        {...bind}
        onClick={() => {
          if (isOpen) {
            close();
            return;
          }
          if (canJump && onJump) {
            onJump(row.itemId);
          }
        }}
        role={canJump ? 'button' : undefined}
        tabIndex={canJump ? 0 : undefined}
        onKeyDown={canJump && onJump ? (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onJump(row.itemId);
          }
        } : undefined}
      >
        <QueueRowContent row={row} isPicked={false} isFlagged={false} />
      </div>
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
