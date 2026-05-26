import { Check, MapPin } from '@phosphor-icons/react';
import { ProgressBar } from '../shared';

export type CardPhase = 'awaiting_rack' | 'verified' | 'picked' | 'flagged' | 'overridden' | 'celebrating';

export interface CardHeroProps {
  rackNo: string | null;
  partNo: string;
  itemName: string;
  pickedQty: number;
  targetQty: number;
  phase: CardPhase;
  flagReason?: string | null;
  positionLabel?: string;
  onRackTap?: () => void;
  isFlagged?: boolean;
  /** When true, qty/progress moves to PickMetricRow below — keeps hero focused on rack + code. */
  hideProgressMetrics?: boolean;
}

export function CardHero({
  rackNo,
  partNo,
  itemName,
  pickedQty,
  targetQty,
  phase,
  flagReason,
  positionLabel,
  onRackTap,
  isFlagged = false,
  hideProgressMetrics = false,
}: CardHeroProps): React.JSX.Element {
  const isAwaitingRack = phase === 'awaiting_rack';
  const isVerified = phase === 'verified' || phase === 'celebrating';
  const isDone = phase === 'picked' || phase === 'flagged' || phase === 'overridden';
  const remainingQty = Math.max(0, targetQty - pickedQty);

  return (
    <div className="relative flex min-h-0 flex-col px-3 pt-2 pb-2 sm:px-4">
      {isFlagged && (
        <div className="absolute left-3 top-2 z-10 rounded-md bg-[var(--bg-negative)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          Flagged
        </div>
      )}
      {phase === 'picked' && (
        <div className="absolute left-3 top-2 z-10 rounded-md bg-[var(--bg-positive)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          Done
        </div>
      )}

      {/* Top bar: position label + QTY always visible */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          {positionLabel && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)] tabular-nums">
              {positionLabel}
            </span>
          )}
        </div>
        {/* QTY badge — ALWAYS visible, right-aligned */}
        {!isDone && (
          <div className="shrink-0 rounded-xl bg-[var(--bg-inverse-primary)] px-3 py-1.5 text-right">
            <span className="font-mono text-lg font-extrabold tabular-nums text-white leading-none">
              {targetQty}
            </span>
            <span className="ml-1 text-[10px] font-semibold uppercase text-white/70">pcs</span>
          </div>
        )}
        {isFlagged && (
          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-[var(--bg-negative-subtle)] px-2.5 py-1 text-[10px] font-semibold text-[var(--content-negative)]">
            Flagged
          </span>
        )}
      </div>

      {/* Compact rack + part row */}
      <div className="flex gap-2 mb-2">
        {/* Rack box */}
        <button
          type="button"
          onClick={onRackTap}
          disabled={isDone}
          className={`flex w-20 shrink-0 flex-col items-center justify-center rounded-xl py-2 pick-pressable transition-colors ${
            isAwaitingRack
              ? 'bg-[var(--bg-tertiary)] border-2 border-dashed border-[var(--border-opaque)]'
              : isVerified
                ? 'bg-[var(--bg-positive-subtle)] border-2 border-[var(--border-positive)]'
                : 'bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] opacity-80'
          }`}
          aria-label={isAwaitingRack ? 'Confirm you are at this rack' : 'Verified rack'}
        >
          <div className="flex items-center gap-1">
            <MapPin
              size={12}
              weight="fill"
              className={
                isAwaitingRack
                  ? 'text-[var(--content-tertiary)]'
                  : 'text-[var(--content-positive)]'
              }
            />
            <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              Rack
            </span>
            {isVerified && !isDone && (
              <Check size={10} weight="bold" className="text-[var(--content-positive)]" />
            )}
          </div>
          <p className="mt-0.5 font-mono text-base font-extrabold leading-tight text-[var(--content-primary)]">
            {rackNo ?? '—'}
          </p>
        </button>

        {/* Part code + item name */}
        <div className="min-w-0 flex-1">
          <p className="pick-hero-code truncate font-mono text-base font-bold text-[var(--content-primary)]">{partNo}</p>
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-[var(--content-secondary)]">{itemName}</p>
          {flagReason && isFlagged && (
            <p className="text-[10px] text-[var(--content-negative)] mt-0.5 font-medium">{flagReason}</p>
          )}
        </div>
      </div>

      {/* Awaiting rack hint — compact */}
      {isAwaitingRack && (
        <p className="text-[10px] text-[var(--content-tertiary)] mb-1 px-1">
          Tap rack or scan bin QR when you arrive
        </p>
      )}

      {/* Progress bar — only when not using PickMetricRow and qty > 0 */}
      {!isDone && !hideProgressMetrics && targetQty > 0 && pickedQty > 0 && (
        <div className="mt-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold text-[var(--content-tertiary)]">
              {pickedQty} picked · {remainingQty} left
            </span>
          </div>
          <ProgressBar
            segments={[
              { value: pickedQty, color: 'green' },
              { value: remainingQty, color: 'gray' },
            ]}
            total={targetQty}
          />
        </div>
      )}
    </div>
  );
}
