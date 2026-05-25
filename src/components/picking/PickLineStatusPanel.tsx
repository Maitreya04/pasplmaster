import { ArrowUp, CheckCircle, Circle, Flag, MapPin, Minus } from '@phosphor-icons/react';

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
}

interface PickLineStatusPanelProps {
  rows: PickLineStatusRow[];
  pickedCount: number;
  flaggedCount: number;
  remainingCount: number;
  totalCount: number;
  /** 0–1 lift from swipe-up drag on the deck */
  dragProgress?: number;
  onJump: (itemId: number) => void;
  onOpenQueue: () => void;
}

function StatusIcon({ status }: { status: PickLineStatusKind }): React.JSX.Element {
  switch (status) {
    case 'picked':
      return (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-positive-subtle)]">
          <CheckCircle size={15} weight="fill" className="text-[var(--content-positive)]" />
        </span>
      );
    case 'flagged':
      return (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-negative-subtle)]">
          <Flag size={14} weight="fill" className="text-[var(--content-negative)]" />
        </span>
      );
    case 'partial':
      return (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-warning-subtle)]">
          <Minus size={14} weight="bold" className="text-[var(--content-warning-on-light)]" />
        </span>
      );
    case 'now':
      return (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-accent-subtle)] ring-2 ring-[var(--role-primary)]">
          <MapPin size={14} weight="fill" className="text-[var(--role-primary)]" />
        </span>
      );
    case 'skipped':
      return (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-warning-subtle)]">
          <Circle size={12} weight="fill" className="text-[var(--content-warning-on-light)]" />
        </span>
      );
    default:
      return (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-tertiary)]">
          <Circle size={10} weight="regular" className="text-[var(--content-quaternary)]" />
        </span>
      );
  }
}

function statusLabel(status: PickLineStatusKind): string {
  switch (status) {
    case 'picked':
      return 'Picked';
    case 'flagged':
      return 'Flagged';
    case 'partial':
      return 'Partial';
    case 'now':
      return 'Current line';
    case 'skipped':
      return 'Skipped';
    default:
      return 'To pick';
  }
}

/**
 * Always-visible pick status below the deck — ticks, flags, and tap-to-jump.
 * Swipe up on the deck (or the handle) opens the full queue sheet.
 */
export function PickLineStatusPanel({
  rows,
  pickedCount,
  flaggedCount,
  remainingCount,
  totalCount,
  dragProgress = 0,
  onJump,
  onOpenQueue,
}: PickLineStatusPanelProps): React.JSX.Element {
  const liftPx = Math.round(Math.min(1, Math.max(0, dragProgress)) * 10);
  const doneRows = rows.filter((r) => r.status === 'picked' || r.status === 'flagged');
  const activeRows = rows.filter((r) => r.status !== 'picked' && r.status !== 'flagged');

  return (
    <div
      className="pick-status-panel space-y-2 transition-transform duration-150 ease-out"
      style={{ transform: liftPx > 0 ? `translateY(-${liftPx}px)` : undefined }}
    >
      <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-sm">
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

        <ul className="pick-status-list max-h-[min(11rem,28dvh)] overflow-y-auto overscroll-contain">
          {doneRows.length > 0 && (
            <>
              <li className="sticky top-0 z-[1] bg-[var(--bg-secondary)] px-3 py-1.5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[var(--content-tertiary)]">
                  Done
                </p>
              </li>
              {doneRows.map((row) => (
                <StatusRow key={row.itemId} row={row} onJump={onJump} />
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
                <StatusRow key={row.itemId} row={row} onJump={onJump} />
              ))}
            </>
          )}
        </ul>
      </div>

      <button
        type="button"
        onClick={onOpenQueue}
        className="group w-full rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 pick-pressable text-left shadow-sm transition-[border-color,background-color] duration-200 active:border-[var(--role-primary)] active:bg-[var(--bg-accent-subtle)]"
        aria-label="Open full pick queue — swipe up on card"
      >
        <div className="mb-2 flex justify-center">
          <span className="block h-1 w-10 rounded-full bg-[var(--border-opaque)] transition-colors group-active:bg-[var(--role-primary)]" />
        </div>
        <div className="flex items-center justify-center gap-2 text-xs font-medium text-[var(--content-secondary)]">
          <ArrowUp
            size={14}
            weight="bold"
            className="text-[var(--content-tertiary)] transition-transform duration-200 group-active:-translate-y-0.5 group-active:text-[var(--role-primary)]"
          />
          <span>Tap or swipe up for full queue · jump to any line</span>
        </div>
      </button>
    </div>
  );
}

function StatusRow({
  row,
  onJump,
}: {
  row: PickLineStatusRow;
  onJump: (itemId: number) => void;
}): React.JSX.Element {
  const isNow = row.status === 'now';

  return (
    <li className="border-b border-[var(--border-faint)] last:border-b-0">
      <button
        type="button"
        onClick={() => onJump(row.itemId)}
        className={`flex w-full min-h-11 items-center gap-2.5 px-3 py-2.5 text-left pick-pressable transition-colors ${
          isNow
            ? 'bg-[var(--bg-accent-subtle)]'
            : 'hover:bg-[var(--bg-tertiary)] active:bg-[var(--bg-tertiary)]'
        }`}
        aria-label={`${statusLabel(row.status)}: ${row.code}, rack ${row.rackNo ?? 'unknown'}. Tap to jump.`}
      >
        <StatusIcon status={row.status} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs font-bold text-[var(--content-primary)]">
            {row.code}
          </p>
          <p className="truncate text-[10px] text-[var(--content-tertiary)]">
            {row.brandLabel ? `${row.brandLabel} · ` : ''}
            Rack {row.rackNo ?? '—'}
            {row.status === 'flagged' && row.flagReason ? ` · ${row.flagReason}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {row.status === 'flagged' ? (
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--content-negative)]">
              Flag
            </span>
          ) : row.status === 'picked' ? (
            <span className="font-mono text-xs font-bold tabular-nums text-[var(--content-positive)]">
              {row.pickedQty}/{row.targetQty}
            </span>
          ) : row.status === 'partial' ? (
            <span className="font-mono text-xs font-bold tabular-nums text-[var(--content-warning-on-light)]">
              {row.pickedQty}/{row.targetQty}
            </span>
          ) : (
            <span className="font-mono text-xs font-semibold tabular-nums text-[var(--content-secondary)]">
              {row.targetQty} pcs
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

/** @deprecated Use PickLineStatusPanel */
export type PickDoneStripEntry = PickLineStatusRow;
export { PickLineStatusPanel as PickDoneStrip };
