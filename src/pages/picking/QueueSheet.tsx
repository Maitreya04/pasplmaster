import { useCallback, useMemo, useState } from 'react';
import { ArrowDown, CheckCircle, Flag, MapPin, SkipForward } from '@phosphor-icons/react';
import { BottomSheet, BigButton } from '../../components/shared';
import { TransportChip } from '../../components/picking/TransportChip';
import { UomBadge } from '../../components/picking/UomBadge';
import { formatBilledLabel, formatLineCountLabel } from '../../lib/picking/pickQueueDisplay';
import {
  formatPickLineTotalPrice,
  groupPickLinesByRack,
  truncatePickDescription,
  type PickLineListEntry,
} from '../../lib/picking/pickLineListDisplay';
import { normalizeUom } from '../../lib/picking/pickerMicrocopy';
import { useSwipeReveal } from '../../hooks/useSwipeReveal';

const SWIPE_ACTION_BUTTON_WIDTH = 80;

export type QueueSheetRowStatus = 'now' | 'next' | 'picked' | 'flagged' | 'skipped';

export interface QueueSheetRow {
  itemId: number;
  rackNo: string | null;
  itemCode: string | null;
  itemName: string;
  brandLabel?: string | null;
  targetQty: number;
  pickedQty?: number;
  uom?: string;
  unitPrice?: number | null;
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
  billedAt?: string | null;
  orderNumber?: string | null;
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
  billedAt,
  orderNumber,
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
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Pick status & queue">
      <div className="space-y-5">
        {(transportName || customerName) && (
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-3 space-y-2">
            {customerName && (
              <p className="text-lg font-bold text-[var(--content-primary)] truncate leading-tight">
                {customerName}
              </p>
            )}
            {billedAt && (
              <p className="text-sm text-[var(--content-secondary)]">
                {formatBilledLabel(billedAt)}
              </p>
            )}
            {transportName ? (
              <TransportChip name={transportName} size="md" />
            ) : (
              <p className="text-xs font-semibold text-[var(--content-warning)]">
                No transport set
              </p>
            )}
            {orderNumber && (
              <p className="font-mono text-xs text-[var(--content-quaternary)]">{orderNumber}</p>
            )}
          </div>
        )}

        {/* Progress — picked / flagged / remaining */}
        <div className="space-y-1.5">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-[var(--border-subtle)]">
            {counts.picked > 0 && (
              <div
                className="h-full bg-[var(--bg-positive)] transition-all duration-300"
                style={{ width: `${(counts.picked / counts.total) * 100}%` }}
              />
            )}
            {counts.flagged > 0 && (
              <div
                className="h-full bg-[var(--bg-negative)] transition-all duration-300"
                style={{ width: `${(counts.flagged / counts.total) * 100}%` }}
              />
            )}
            {counts.remaining > 0 && (
              <div
                className="h-full bg-[var(--border-opaque)] transition-all duration-300"
                style={{ width: `${(counts.remaining / counts.total) * 100}%` }}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-[var(--content-positive)]">
              <CheckCircle size={14} weight="fill" />
              {counts.picked} picked
            </span>
            {counts.flagged > 0 && (
              <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-[var(--content-negative)]">
                <Flag size={14} weight="fill" />
                {counts.flagged} flagged
              </span>
            )}
            <span className="tabular-nums text-[var(--content-secondary)]">
              {counts.remaining} left
            </span>
            <span className="ml-auto text-[var(--content-quaternary)] tabular-nums">
              {formatLineCountLabel(counts.total, { short: true })}
            </span>
          </div>
        </div>

        {onJump && (
          <p className="text-[11px] text-[var(--content-tertiary)]">
            Tap any line to jump to it in the pick deck.
          </p>
        )}

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
              {renderGroupedQueueRows(nextRows, (row, showRackColumn) => (
                <Row
                  key={row.itemId}
                  row={row}
                  showRackColumn={showRackColumn}
                  onJump={onJump}
                  onCompleteItem={onCompleteItem}
                  isSwipeOpen={openSwipeItemId === row.itemId}
                  onSwipeOpenChange={(open) => setOpenSwipeItemId(open ? row.itemId : null)}
                  onSkip={skipTargetId === null ? () => {
                    closeSwipe();
                    setSkipTargetId(row.itemId);
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
          <DoneSection rows={doneRows} onJump={onJump} />
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
  showRackColumn = true,
  onSkip,
  onJump,
  onCompleteItem,
  isSwipeOpen = false,
  onSwipeOpenChange,
}: {
  row: QueueSheetRow;
  highlighted?: boolean;
  showRackColumn?: boolean;
  onSkip?: () => void;
  onJump?: (itemId: number) => void;
  onCompleteItem?: (itemId: number) => void;
  isSwipeOpen?: boolean;
  onSwipeOpenChange?: (open: boolean) => void;
}) {
  const isPicked = row.status === 'picked';
  const isFlagged = row.status === 'flagged';
  const isSkipped = row.status === 'skipped';
  const canJump = Boolean(onJump);
  const canSwipe = Boolean(onCompleteItem && !isPicked && !isFlagged);

  if (canSwipe) {
    return (
      <SwipeableQueueRow
        row={row}
        highlighted={highlighted}
        showRackColumn={showRackColumn}
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
      showRackColumn={showRackColumn}
      isPicked={isPicked}
      isFlagged={isFlagged}
      isSkipped={isSkipped}
      canJump={canJump}
      onJump={onJump}
    />
  );
}

function queueRowUom(row: QueueSheetRow): string {
  return normalizeUom(row.uom);
}

function toQueueListEntry(row: QueueSheetRow): PickLineListEntry {
  const status =
    row.status === 'now'
      ? 'now'
      : row.status === 'picked'
        ? 'picked'
        : row.status === 'flagged'
          ? 'flagged'
          : row.status === 'skipped'
            ? 'skipped'
            : 'pending';

  return {
    itemId: row.itemId,
    rackNo: row.rackNo,
    partCode: row.itemCode ?? String(row.itemId),
    itemName: row.itemName,
    targetQty: row.targetQty,
    pickedQty: row.pickedQty,
    uom: queueRowUom(row),
    unitPrice: row.unitPrice,
    status,
  };
}

function RackSectionHeader({ label, count }: { label: string; count: number }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 px-1 py-1.5">
      <span className="font-mono text-xs font-extrabold tabular-nums text-[var(--role-primary)]">
        {label}
      </span>
      <span className="h-px flex-1 bg-[var(--border-faint)]" aria-hidden />
      <span className="text-[9px] font-semibold tabular-nums text-[var(--content-quaternary)]">
        {count} line{count === 1 ? '' : 's'}
      </span>
    </div>
  );
}

function renderGroupedQueueRows(
  rows: QueueSheetRow[],
  renderRow: (row: QueueSheetRow, showRackColumn: boolean) => React.JSX.Element,
): React.JSX.Element[] {
  const groups = groupPickLinesByRack(rows.map(toQueueListEntry));
  const useRackGrouping = groups.some((g) => g.rows.length > 1);
  const out: React.JSX.Element[] = [];

  for (const group of groups) {
    if (useRackGrouping) {
      out.push(
        <RackSectionHeader key={`rack-${group.rackKey}`} label={group.rackLabel} count={group.rows.length} />,
      );
    }
    for (const entry of group.rows) {
      const row = rows.find((r) => r.itemId === entry.itemId);
      if (!row) continue;
      out.push(renderRow(row, !useRackGrouping));
    }
  }

  return out;
}

function QueueRowContent({
  row,
  isPicked,
  isFlagged,
  showRackColumn = true,
}: {
  row: QueueSheetRow;
  isPicked: boolean;
  isFlagged: boolean;
  showRackColumn?: boolean;
}) {
  const priceLabel = formatPickLineTotalPrice(row.targetQty, row.unitPrice);
  const uomNorm = queueRowUom(row);

  return (
    <>
      {showRackColumn ? (
        <div className="flex w-12 shrink-0 items-center gap-1">
          {isPicked ? (
            <CheckCircle size={14} weight="fill" className="text-[var(--content-positive)]" />
          ) : isFlagged ? (
            <Flag size={14} weight="fill" className="text-[var(--content-negative)]" />
          ) : (
            <MapPin size={12} weight="regular" className="text-[var(--content-tertiary)]" />
          )}
          <span className="truncate font-mono text-[10px] font-bold text-[var(--content-tertiary)]">
            {row.rackNo ?? '—'}
          </span>
        </div>
      ) : (
        <div className="flex shrink-0 items-center">
          {isPicked ? (
            <CheckCircle size={14} weight="fill" className="text-[var(--content-positive)]" />
          ) : isFlagged ? (
            <Flag size={14} weight="fill" className="text-[var(--content-negative)]" />
          ) : (
            <MapPin size={12} weight="regular" className="text-[var(--content-tertiary)]" />
          )}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs font-bold text-[var(--content-primary)]">
          {row.itemCode ?? row.itemId}
        </p>
        <p className="truncate text-[10px] leading-tight text-[var(--content-tertiary)]">
          {row.brandLabel ? (
            <span className="mr-1 rounded bg-[var(--bg-tertiary)] px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[var(--content-quaternary)]">
              {row.brandLabel}
            </span>
          ) : null}
          {truncatePickDescription(row.itemName)}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <span className="font-mono text-xs font-bold tabular-nums text-[var(--content-primary)]">
            {row.targetQty}
          </span>
          <UomBadge uom={uomNorm} />
        </div>
        {priceLabel ? (
          <p className="mt-0.5 font-mono text-[9px] tabular-nums text-[var(--content-quaternary)]">
            {priceLabel}
          </p>
        ) : null}
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
  showRackColumn = true,
  isPicked,
  isFlagged,
  isSkipped,
  canJump,
  onJump,
}: {
  row: QueueSheetRow;
  highlighted: boolean;
  showRackColumn?: boolean;
  isPicked: boolean;
  isFlagged: boolean;
  isSkipped: boolean;
  canJump: boolean;
  onJump?: (itemId: number) => void;
}) {
  const inner = (
    <QueueRowContent
      row={row}
      isPicked={isPicked}
      isFlagged={isFlagged}
      showRackColumn={showRackColumn}
    />
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
  showRackColumn = true,
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
  showRackColumn?: boolean;
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
        <QueueRowContent
          row={row}
          isPicked={false}
          isFlagged={false}
          showRackColumn={showRackColumn}
        />
      </div>
    </div>
  );
}

function DoneSection({
  rows,
  onJump,
}: {
  rows: QueueSheetRow[];
  onJump?: (itemId: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <section>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mb-2 flex min-h-11 w-full items-center gap-1.5 pick-pressable text-left"
      >
        <CheckCircle size={14} weight="fill" className="text-[var(--content-positive)]" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
          Picked &amp; flagged ({rows.length})
        </span>
        <ArrowDown
          size={12}
          weight="bold"
          className={`ml-auto text-[var(--content-quaternary)] ${expanded ? 'rotate-0' : '-rotate-90'}`}
          style={{ transition: 'transform 160ms cubic-bezier(0.23, 1, 0.32, 1)' }}
        />
      </button>
      {expanded && (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <Row key={r.itemId} row={r} onJump={onJump} />
          ))}
        </div>
      )}
    </section>
  );
}
