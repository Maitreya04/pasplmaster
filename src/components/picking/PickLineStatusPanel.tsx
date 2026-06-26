import {
  ArrowRight,
  CheckCircle,
  Circle,
  Flag,
  MapPin,
  Minus,
} from '@phosphor-icons/react';
import { useCallback, useRef } from 'react';
import { UomBadge } from './UomBadge';
import {
  formatPickLineTotalPrice,
  groupPickLinesByRack,
  truncatePickDescription,
  type PickLineListEntry,
} from '../../lib/picking/pickLineListDisplay';
import { normalizeUom } from '../../lib/picking/pickerMicrocopy';

export type PickLineStatusKind = 'now' | 'pending' | 'partial' | 'picked' | 'flagged' | 'skipped';

export interface PickLineStatusRow {
  itemId: number;
  code: string;
  rackNo: string | null;
  itemName: string;
  targetQty: number;
  pickedQty: number;
  uom?: string;
  unitPrice?: number | null;
  status: PickLineStatusKind;
  flagReason?: string | null;
  brandLabel?: string | null;
  /** Gate 1 — picker confirmed physical rack (scan or tap). */
  rackVerified?: boolean;
  /** Picked/flagged on card — waiting for "Next line" tap on the deck. */
  awaitingAdvance?: boolean;
}

interface PickLineStatusPanelProps {
  rows: PickLineStatusRow[];
  /** Card currently on screen — for a subtle "Viewing" signifier in the list */
  currentItemId?: number | null;
  pickedCount: number;
  flaggedCount: number;
  remainingCount: number;
  totalCount: number;
  /** 0–1 lift from swipe-up drag on the deck or handle */
  dragProgress?: number;
  /** Show the full line list expanded (not a short peek). */
  defaultExpanded?: boolean;
  onJump: (itemId: number) => void;
  onOpenQueue: () => void;
  onQueueDrag?: (progress: number) => void;
  onQueueDragEnd?: () => void;
}

function StatusIcon({ status }: { status: PickLineStatusKind }): React.JSX.Element {
  switch (status) {
    case 'picked':
      return (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-positive-subtle)] ring-2 ring-[var(--border-positive)]">
          <CheckCircle size={16} weight="fill" className="text-[var(--content-positive)]" />
        </span>
      );
    case 'flagged':
      return (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-negative-subtle)] ring-2 ring-[var(--border-negative)]">
          <Flag size={15} weight="fill" className="text-[var(--content-negative)]" />
        </span>
      );
    case 'partial':
      return (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-warning-subtle)] ring-2 ring-[var(--border-warning)]">
          <Minus size={15} weight="bold" className="text-[var(--content-warning-on-light)]" />
        </span>
      );
    case 'now':
      return (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-accent-subtle)] ring-2 ring-[var(--role-primary)]">
          <MapPin size={15} weight="fill" className="text-[var(--role-primary)]" />
        </span>
      );
    case 'skipped':
      return (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--bg-warning-subtle)]">
          <Circle size={12} weight="fill" className="text-[var(--content-warning-on-light)]" />
        </span>
      );
    default:
      return (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-[var(--border-opaque)] bg-[var(--bg-primary)]">
          <Circle size={11} weight="regular" className="text-[var(--content-quaternary)]" />
        </span>
      );
  }
}

function statusLabel(status: PickLineStatusKind): string {
  switch (status) {
    case 'picked':
      return 'Picked — line complete';
    case 'flagged':
      return 'Flagged for billing';
    case 'partial':
      return 'Partially picked';
    case 'now':
      return 'Current line — picking now';
    case 'skipped':
      return 'Skipped';
    default:
      return 'Not started';
  }
}

function rowUom(row: PickLineStatusRow): string {
  return normalizeUom(row.uom);
}

function qtyDisplay(row: PickLineStatusRow): { text: string; className: string } {
  if (row.status === 'flagged') {
    return { text: 'Flag', className: 'text-[10px] font-bold uppercase tracking-wide text-[var(--content-negative)]' };
  }
  if (row.status === 'picked') {
    const complete = row.targetQty > 0 && row.pickedQty >= row.targetQty;
    if (complete) {
      return {
        text: 'Done',
        className: 'text-[11px] font-bold uppercase tracking-wide text-[var(--content-positive)]',
      };
    }
    return {
      text: row.pickedQty > 0 ? `${row.pickedQty}/${row.targetQty}` : 'Done · 0',
      className: 'font-mono text-xs font-bold tabular-nums text-[var(--content-positive)]',
    };
  }
  if (row.status === 'partial') {
    return {
      text: `${row.pickedQty}/${row.targetQty}`,
      className: 'font-mono text-xs font-bold tabular-nums text-[var(--content-warning-on-light)]',
    };
  }
  if (row.status === 'now') {
    const started = row.pickedQty > 0;
    return {
      text: started ? `${row.pickedQty}/${row.targetQty}` : String(row.targetQty),
      className: started
        ? 'font-mono text-xs font-bold tabular-nums text-[var(--content-warning-on-light)]'
        : 'font-mono text-xs font-semibold tabular-nums text-[var(--role-primary)]',
    };
  }
  return {
    text: String(row.targetQty),
    className: 'font-mono text-xs font-semibold tabular-nums text-[var(--content-secondary)]',
  };
}

function toListEntry(row: PickLineStatusRow): PickLineListEntry {
  return {
    itemId: row.itemId,
    rackNo: row.rackNo,
    partCode: row.code,
    itemName: row.itemName,
    targetQty: row.targetQty,
    pickedQty: row.pickedQty,
    uom: rowUom(row),
    unitPrice: row.unitPrice,
    status: row.awaitingAdvance ? 'picked' : row.status,
    flagReason: row.flagReason,
  };
}

function RackGroupHeader({ label, count }: { label: string; count: number }): React.JSX.Element {
  return (
    <li className="sticky top-0 z-[1] border-b border-[var(--border-faint)] bg-[var(--bg-secondary)] px-3 py-1.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-extrabold tabular-nums text-[var(--role-primary)]">
          {label}
        </span>
        <span className="h-px flex-1 bg-[var(--border-faint)]" aria-hidden />
        <span className="text-[9px] font-semibold tabular-nums text-[var(--content-quaternary)]">
          {count} line{count === 1 ? '' : 's'}
        </span>
      </div>
    </li>
  );
}

function renderGroupedRows(
  rows: PickLineStatusRow[],
  currentItemId: number | null,
  onJump: (itemId: number) => void,
): React.JSX.Element[] {
  const entries = rows.map(toListEntry);
  const groups = groupPickLinesByRack(entries);
  const useRackGrouping = groups.some((g) => g.rows.length > 1);
  const out: React.JSX.Element[] = [];

  for (const group of groups) {
    if (useRackGrouping) {
      out.push(
        <RackGroupHeader key={`rack-${group.rackKey}`} label={group.rackLabel} count={group.rows.length} />,
      );
    }
    for (const entry of group.rows) {
      const row = rows.find((r) => r.itemId === entry.itemId);
      if (!row) continue;
      out.push(
        <StatusRow
          key={row.itemId}
          row={row}
          isViewing={currentItemId === row.itemId}
          showRackColumn={!useRackGrouping}
          onJump={onJump}
        />,
      );
    }
  }

  return out;
}

/**
 * Minimal pick status strip below the deck — shows progress, pull up for full queue.
 * Collapsed by default to maximize card space (Krug: don't steal real estate).
 */
export function PickLineStatusPanel({
  rows,
  currentItemId = null,
  pickedCount,
  flaggedCount,
  remainingCount,
  totalCount,
  dragProgress = 0,
  defaultExpanded = false,
  onJump,
  onOpenQueue,
  onQueueDrag,
  onQueueDragEnd,
}: PickLineStatusPanelProps): React.JSX.Element {
  const drag = Math.min(1, Math.max(0, dragProgress));
  const liftPx = Math.round(drag * 22);
  // Collapsed: show minimal 1-line summary. Expanded: show list.
  const baseListRem = defaultExpanded ? Math.min(16, 4 + rows.length * 1.8) : 0;
  const listMaxRem = baseListRem + drag * 12;
  const doneRows = rows.filter((r) => r.status === 'picked' || r.status === 'flagged');
  const activeRows = rows.filter((r) => r.status !== 'picked' && r.status !== 'flagged');
  const currentRow = rows.find((r) => r.itemId === currentItemId) ?? activeRows[0] ?? null;
  const openingQueue = drag > 0.35;
  const showList = defaultExpanded || drag > 0.1;

  const handleDragRef = useRef<{ startY: number; dragging: boolean; dragged: boolean }>({
    startY: 0,
    dragging: false,
    dragged: false,
  });
  const VERTICAL_OPEN_PX = 28;
  const VERTICAL_DRAG_MAX_PX = 80;

  const finishHandleDrag = useCallback(
    (clientY: number) => {
      if (!handleDragRef.current.dragging) return;
      const deltaY = clientY - handleDragRef.current.startY;
      handleDragRef.current.dragging = false;
      onQueueDragEnd?.();
      if (deltaY < -VERTICAL_OPEN_PX) {
        handleDragRef.current.dragged = true;
        onOpenQueue();
      }
    },
    [onOpenQueue, onQueueDragEnd],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      handleDragRef.current = { startY: event.clientY, dragging: true, dragged: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!handleDragRef.current.dragging) return;
      const deltaY = event.clientY - handleDragRef.current.startY;
      if (Math.abs(deltaY) > 6) {
        handleDragRef.current.dragged = true;
      }
      if (deltaY >= 0) {
        onQueueDrag?.(0);
        return;
      }
      onQueueDrag?.(Math.min(1, Math.abs(deltaY) / VERTICAL_DRAG_MAX_PX));
      event.preventDefault();
    },
    [onQueueDrag],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      finishHandleDrag(event.clientY);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* noop */
      }
    },
    [finishHandleDrag],
  );

  return (
    <div
      className="pick-status-panel shrink-0 space-y-2 transition-transform duration-150 ease-out"
      style={{ transform: liftPx > 0 ? `translateY(-${liftPx}px)` : undefined }}
    >
      <div
        className={`overflow-hidden rounded-2xl border bg-[var(--bg-secondary)] shadow-sm transition-[border-color,box-shadow] duration-150 ${
          openingQueue
            ? 'border-[var(--role-primary)] shadow-md ring-2 ring-[var(--role-primary)]/15'
            : 'border-[var(--border-subtle)]'
        }`}
      >
        <button
          type="button"
          onClick={() => {
            if (handleDragRef.current.dragged) {
              handleDragRef.current.dragged = false;
              return;
            }
            onOpenQueue();
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="group flex w-full touch-none flex-col items-center border-b border-[var(--border-faint)] px-3 py-2 pick-pressable"
          style={{ touchAction: 'none' }}
          aria-label="Open full pick queue. Swipe up on the card above."
        >
          <span className="mb-1 block h-1 w-10 rounded-full bg-[var(--border-opaque)] transition-all duration-200 group-active:w-12 group-active:bg-[var(--role-primary)]" />
          <span
            className={`text-[10px] font-semibold transition-colors duration-150 ${
              openingQueue
                ? 'text-[var(--role-primary)]'
                : 'text-[var(--content-tertiary)] group-active:text-[var(--role-primary)]'
            }`}
          >
            {openingQueue
              ? 'Release for full queue'
              : 'Swipe up for pick queue'}
          </span>
        </button>

        {/* Compact summary row — always visible */}
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-bold tabular-nums text-[var(--content-positive)]">
            <CheckCircle size={14} weight="fill" />
            {pickedCount}
          </span>
          {flaggedCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold tabular-nums text-[var(--content-negative)]">
              <Flag size={14} weight="fill" />
              {flaggedCount}
            </span>
          )}
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums text-[var(--content-secondary)]">
            <Circle size={10} weight="regular" />
            {remainingCount} left
          </span>
          <span className="ml-auto text-[10px] font-medium tabular-nums text-[var(--content-quaternary)]">
            {totalCount} lines
          </span>
        </div>

        {!showList && currentRow && (
          <button
            type="button"
            onClick={() => onJump(currentRow.itemId)}
            className="flex w-full min-h-[44px] items-center gap-2 border-t border-[var(--border-faint)] px-3 py-2 text-left pick-pressable active:bg-[var(--bg-tertiary)]"
            aria-label={`Current line: ${currentRow.code}, rack ${currentRow.rackNo ?? 'unknown'}`}
          >
            <span className="shrink-0 font-mono text-sm font-extrabold tabular-nums text-[var(--role-primary)]">
              {currentRow.rackNo ?? '—'}
            </span>
            <p className="min-w-0 flex-1 truncate font-mono text-xs font-bold text-[var(--content-primary)]">
              {currentRow.code}
            </p>
            <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-[var(--content-secondary)]">
              {currentRow.targetQty} {rowUom(currentRow).toLowerCase()}
            </span>
            <ArrowRight size={12} weight="bold" className="shrink-0 text-[var(--content-quaternary)]" />
          </button>
        )}

        {/* List — only when expanded or dragging */}
        {showList && (
          <ul
            className="pick-status-list overflow-y-auto overscroll-contain border-t border-[var(--border-faint)] transition-[max-height] duration-150 ease-out"
            style={{ maxHeight: `min(${listMaxRem}rem, 28dvh)` }}
          >
            {doneRows.length > 0 && (
              <>
                <li className="sticky top-0 z-[1] bg-[var(--bg-secondary)] px-3 py-1">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--content-positive)]">
                    Done
                  </p>
                </li>
                {renderGroupedRows(doneRows, currentItemId, onJump)}
              </>
            )}
            {activeRows.length > 0 && (
              <>
                <li className="sticky top-0 z-[1] bg-[var(--bg-secondary)] px-3 py-1">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--content-tertiary)]">
                    {doneRows.length > 0 ? 'To pick' : 'All lines'}
                  </p>
                </li>
                {renderGroupedRows(activeRows, currentItemId, onJump)}
              </>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusRow({
  row,
  isViewing,
  showRackColumn = true,
  onJump,
}: {
  row: PickLineStatusRow;
  isViewing: boolean;
  showRackColumn?: boolean;
  onJump: (itemId: number) => void;
}): React.JSX.Element {
  const isNow = row.status === 'now';
  const isPicked = row.status === 'picked';
  const awaitingAdvance = row.awaitingAdvance === true;
  const qty = qtyDisplay(row);
  const priceLabel = formatPickLineTotalPrice(row.targetQty, row.unitPrice);
  const uomNorm = rowUom(row);

  return (
    <li className="border-b border-[var(--border-faint)] last:border-b-0">
      <button
        type="button"
        onClick={() => onJump(row.itemId)}
        className={`flex w-full min-h-[44px] items-center gap-2 px-3 py-1.5 text-left pick-pressable transition-colors ${
          awaitingAdvance
            ? 'bg-[var(--bg-positive-subtle)]'
            : isNow
              ? 'bg-[var(--bg-accent-subtle)]'
              : isPicked
                ? 'bg-[var(--bg-positive-subtle)]/30'
                : 'active:bg-[var(--bg-tertiary)]'
        }`}
        aria-label={`${statusLabel(row.status)}: ${row.code}, rack ${row.rackNo ?? 'unknown'}.`}
      >
        {showRackColumn ? (
          <span className="w-12 shrink-0 truncate font-mono text-[10px] font-bold tabular-nums text-[var(--content-tertiary)]">
            {row.rackNo ?? '—'}
          </span>
        ) : null}

        <StatusIcon status={awaitingAdvance ? 'picked' : row.status} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p
              className={`truncate font-mono text-xs font-bold ${
                isPicked || awaitingAdvance
                  ? 'text-[var(--content-positive)]'
                  : 'text-[var(--content-primary)]'
              }`}
            >
              {row.code}
            </p>
            {isViewing && (
              <span className="shrink-0 rounded bg-[var(--role-primary)] px-1 py-0.5 text-[7px] font-bold uppercase text-white">
                Now
              </span>
            )}
          </div>
          <p className="truncate text-[10px] leading-tight text-[var(--content-tertiary)]">
            {truncatePickDescription(row.itemName)}
            {row.status === 'flagged' && row.flagReason ? ` · ${row.flagReason}` : ''}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <div className="flex items-center justify-end gap-1.5">
            <span className={qty.className}>{qty.text}</span>
            <UomBadge uom={uomNorm} />
          </div>
          {priceLabel ? (
            <p className="mt-0.5 font-mono text-[9px] tabular-nums text-[var(--content-quaternary)]">
              {priceLabel}
            </p>
          ) : null}
        </div>

        <ArrowRight
          size={12}
          weight="bold"
          className={
            isNow || awaitingAdvance
              ? 'text-[var(--role-primary)]'
              : 'text-[var(--content-quaternary)]'
          }
          aria-hidden
        />
      </button>
    </li>
  );
}

/** @deprecated Use PickLineStatusPanel */
export type PickDoneStripEntry = PickLineStatusRow;
export { PickLineStatusPanel as PickDoneStrip };
