import {
  ArrowRight,
  ArrowUp,
  CheckCircle,
  Circle,
  Flag,
  MapPin,
  Minus,
} from '@phosphor-icons/react';

export type PickLineStatusKind = 'now' | 'pending' | 'partial' | 'picked' | 'flagged' | 'skipped';

export interface PickLineStatusRow {
  itemId: number;
  code: string;
  rackNo: string | null;
  itemName: string;
  targetQty: number;
  pickedQty: number;
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
  /** 0–1 lift from swipe-up drag on the deck */
  dragProgress?: number;
  /** Show the full line list expanded (not a short peek). */
  defaultExpanded?: boolean;
  onJump: (itemId: number) => void;
  onOpenQueue: () => void;
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

function lineActionHint(row: PickLineStatusRow): string | null {
  if (row.awaitingAdvance) return 'Tap card · Next line';
  if (row.status === 'now') {
    if (!row.rackVerified) return 'Step 1 · At rack';
    if (row.pickedQty > 0 && row.pickedQty < row.targetQty) return 'Step 2 · Picking';
    return 'Step 2 · Pick qty';
  }
  if (row.status === 'partial') return 'Step 2 · Finish qty';
  if (row.status === 'pending' || row.status === 'skipped') return 'Tap to jump';
  return null;
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
      text: started ? `${row.pickedQty}/${row.targetQty}` : `${row.targetQty} pcs`,
      className: started
        ? 'font-mono text-xs font-bold tabular-nums text-[var(--content-warning-on-light)]'
        : 'font-mono text-xs font-semibold tabular-nums text-[var(--role-primary)]',
    };
  }
  return {
    text: `${row.targetQty} pcs`,
    className: 'font-mono text-xs font-semibold tabular-nums text-[var(--content-secondary)]',
  };
}

/**
 * Always-visible pick status below the deck — ticks, flags, and tap-to-jump.
 * Swipe up on the deck (or the handle) opens the full queue sheet.
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
}: PickLineStatusPanelProps): React.JSX.Element {
  const drag = Math.min(1, Math.max(0, dragProgress));
  const liftPx = Math.round(drag * 22);
  const baseListRem = defaultExpanded ? Math.min(28, 8 + rows.length * 2.75) : 11;
  const listMaxRem = baseListRem + drag * 10;
  const doneRows = rows.filter((r) => r.status === 'picked' || r.status === 'flagged');
  const activeRows = rows.filter((r) => r.status !== 'picked' && r.status !== 'flagged');
  const openingQueue = drag > 0.35;

  return (
    <div
      className="pick-status-panel space-y-2 transition-transform duration-150 ease-out"
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
          onClick={onOpenQueue}
          className="group flex w-full flex-col items-center border-b border-[var(--border-faint)] px-3 py-2.5 pick-pressable"
          aria-label="Open full pick queue. Swipe up on the card above."
        >
          <span className="mb-1.5 block h-1.5 w-12 rounded-full bg-[var(--border-opaque)] transition-all duration-200 group-active:w-14 group-active:bg-[var(--role-primary)]" />
          <span
            className={`text-[10px] font-semibold transition-colors duration-150 ${
              openingQueue
                ? 'text-[var(--role-primary)]'
                : 'text-[var(--content-tertiary)] group-active:text-[var(--role-primary)]'
            }`}
          >
            {openingQueue
              ? 'Release to open full queue'
              : defaultExpanded
                ? 'Pull for full queue sheet · list below'
                : 'Swipe up on card or pull here · full queue'}
          </span>
        </button>

        <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-faint)] px-3 py-2.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-positive-subtle)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-[var(--content-positive)]">
            <CheckCircle size={12} weight="fill" />
            {pickedCount} picked
          </span>
          {flaggedCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-negative-subtle)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-[var(--content-negative)]">
              <Flag size={12} weight="fill" />
              {flaggedCount} flagged
            </span>
          )}
          {remainingCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-[10px] font-semibold tabular-nums text-[var(--content-secondary)]">
              <Circle size={10} weight="regular" />
              {remainingCount} left
            </span>
          )}
          <span className="ml-auto text-[10px] font-medium tabular-nums text-[var(--content-quaternary)]">
            {totalCount} lines
          </span>
        </div>

        <ul
          className="pick-status-list overflow-y-auto overscroll-contain transition-[max-height] duration-150 ease-out"
          style={{ maxHeight: `min(${listMaxRem}rem, 36dvh)` }}
        >
          {doneRows.length > 0 && (
            <>
              <li className="sticky top-0 z-[1] bg-[var(--bg-secondary)] px-3 py-1.5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--content-positive)]">
                  Done — picked or flagged
                </p>
              </li>
              {doneRows.map((row) => (
                <StatusRow
                  key={row.itemId}
                  row={row}
                  isViewing={currentItemId === row.itemId}
                  onJump={onJump}
                />
              ))}
            </>
          )}
          {activeRows.length > 0 && (
            <>
              <li className="sticky top-0 z-[1] bg-[var(--bg-secondary)] px-3 py-1.5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--content-tertiary)]">
                  {doneRows.length > 0 ? 'Still to pick' : 'All lines'}
                </p>
              </li>
              {activeRows.map((row) => (
                <StatusRow
                  key={row.itemId}
                  row={row}
                  isViewing={currentItemId === row.itemId}
                  onJump={onJump}
                />
              ))}
            </>
          )}
        </ul>
      </div>

      <button
        type="button"
        onClick={onOpenQueue}
        className="group flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-4 py-3 pick-pressable text-sm font-semibold text-[var(--content-secondary)] transition-colors active:border-[var(--role-primary)] active:bg-[var(--bg-accent-subtle)] active:text-[var(--role-primary)]"
        aria-label="Open full pick queue"
      >
        <ArrowUp
          size={18}
          weight="bold"
          className="transition-transform duration-200 group-active:-translate-y-0.5"
        />
        Open full queue
      </button>
    </div>
  );
}

function StatusRow({
  row,
  isViewing,
  onJump,
}: {
  row: PickLineStatusRow;
  isViewing: boolean;
  onJump: (itemId: number) => void;
}): React.JSX.Element {
  const isNow = row.status === 'now';
  const isPicked = row.status === 'picked';
  const isPartial = row.status === 'partial';
  const awaitingAdvance = row.awaitingAdvance === true;
  const qty = qtyDisplay(row);
  const actionHint = lineActionHint(row);
  const partialPct =
    isPartial && row.targetQty > 0
      ? Math.round((row.pickedQty / row.targetQty) * 100)
      : 0;

  return (
    <li className="border-b border-[var(--border-faint)] last:border-b-0">
      <button
        type="button"
        onClick={() => onJump(row.itemId)}
        className={`flex w-full min-h-[52px] flex-col gap-1 px-3 py-2.5 text-left pick-pressable transition-colors ${
          awaitingAdvance
            ? 'bg-[var(--bg-positive-subtle)] ring-1 ring-inset ring-[var(--border-positive)]'
            : isNow
              ? 'bg-[var(--bg-accent-subtle)] ring-1 ring-inset ring-[var(--role-primary)]/30'
              : isPicked
                ? 'bg-[var(--bg-positive-subtle)]/40'
                : 'hover:bg-[var(--bg-tertiary)] active:bg-[var(--bg-tertiary)]'
        }`}
        aria-label={`${statusLabel(row.status)}: ${row.code}, rack ${row.rackNo ?? 'unknown'}. ${actionHint ?? 'Tap to jump'}.`}
      >
        <div className="flex items-center gap-2.5">
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
                <span className="shrink-0 rounded bg-[var(--role-primary)] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[var(--content-on-color)]">
                  On card
                </span>
              )}
              {awaitingAdvance && (
                <span className="shrink-0 rounded-full bg-[var(--bg-positive)] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
                  Next
                </span>
              )}
            </div>
            <p className="truncate text-[10px] text-[var(--content-tertiary)]">
              {row.brandLabel ? `${row.brandLabel} · ` : ''}
              Rack {row.rackNo ?? '—'}
              {row.status === 'flagged' && row.flagReason ? ` · ${row.flagReason}` : ''}
            </p>
            {actionHint ? (
              <p
                className={`mt-0.5 text-[10px] font-semibold ${
                  awaitingAdvance
                    ? 'text-[var(--content-positive)]'
                    : isNow
                      ? 'text-[var(--role-primary)]'
                      : 'text-[var(--content-quaternary)]'
                }`}
              >
                {actionHint}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={qty.className}>{qty.text}</span>
            <ArrowRight
              size={14}
              weight="bold"
              className={
                isNow || awaitingAdvance
                  ? 'text-[var(--role-primary)]'
                  : 'text-[var(--content-quaternary)]'
              }
              aria-hidden
            />
          </div>
        </div>
        {isPartial && row.targetQty > 0 && (
          <div
            className="ml-9 h-1 overflow-hidden rounded-full bg-[var(--bg-tertiary)]"
            role="progressbar"
            aria-valuenow={row.pickedQty}
            aria-valuemin={0}
            aria-valuemax={row.targetQty}
            aria-label={`${row.pickedQty} of ${row.targetQty} pieces picked`}
          >
            <div
              className="h-full rounded-full bg-[var(--bg-warning)] transition-[width] duration-200"
              style={{ width: `${partialPct}%` }}
            />
          </div>
        )}
        {isNow && row.rackVerified && row.targetQty > 0 && row.pickedQty > 0 && row.pickedQty < row.targetQty && (
          <div
            className="ml-9 h-1 overflow-hidden rounded-full bg-[var(--bg-tertiary)]"
            role="progressbar"
            aria-valuenow={row.pickedQty}
            aria-valuemin={0}
            aria-valuemax={row.targetQty}
          >
            <div
              className="h-full rounded-full bg-[var(--role-primary)] transition-[width] duration-200"
              style={{ width: `${partialPct || Math.max(4, Math.round((row.pickedQty / row.targetQty) * 100))}%` }}
            />
          </div>
        )}
      </button>
    </li>
  );
}

/** @deprecated Use PickLineStatusPanel */
export type PickDoneStripEntry = PickLineStatusRow;
export { PickLineStatusPanel as PickDoneStrip };
