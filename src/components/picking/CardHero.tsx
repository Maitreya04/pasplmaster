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
    <div className="relative flex flex-col min-h-0 px-4 pt-3 pb-2">
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

      <div className="flex items-start justify-between gap-2 mb-2">
        {positionLabel && (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)] tabular-nums">
            {positionLabel}
          </span>
        )}
        {isFlagged && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[var(--bg-negative-subtle)] px-2.5 py-1 text-[10px] font-semibold text-[var(--content-negative)]">
            Flagged
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onRackTap}
        disabled={isDone}
        className={`w-full text-left rounded-2xl p-3 mb-2 pick-pressable transition-colors ${
          isAwaitingRack
            ? 'bg-[var(--bg-tertiary)] border-2 border-dashed border-[var(--border-opaque)]'
            : isVerified
              ? 'bg-[var(--bg-positive-subtle)] border-2 border-[var(--border-positive)]'
              : 'bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] opacity-80'
        }`}
        aria-label={isAwaitingRack ? 'Confirm you are at this rack' : 'Verified rack'}
      >
        <div className="flex items-center gap-2">
          <MapPin
            size={16}
            weight="fill"
            className={
              isAwaitingRack
                ? 'text-[var(--content-tertiary)]'
                : 'text-[var(--content-positive)]'
            }
          />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
            {isAwaitingRack ? 'Walk to rack' : 'Rack'}
          </span>
          {isVerified && !isDone && (
            <Check size={14} weight="bold" className="text-[var(--content-positive)] ml-auto" />
          )}
        </div>
        <p className="font-mono font-bold text-[56px] sm:text-[64px] leading-none mt-1 text-[var(--content-primary)]">
          {rackNo ?? '—'}
        </p>
        {isAwaitingRack && (
          <p className="text-[11px] text-[var(--content-tertiary)] mt-1">
            Tap when you&apos;re at this rack (no label to scan)
          </p>
        )}
      </button>

      <p className="font-mono font-bold text-[40px] sm:text-[48px] leading-none text-[var(--content-primary)] break-all">
        {partNo}
      </p>
      <p className="text-sm text-[var(--content-secondary)] mt-1 line-clamp-2">{itemName}</p>
      {flagReason && isFlagged && (
        <p className="text-xs text-[var(--content-negative)] mt-1 font-medium">{flagReason}</p>
      )}

      {!isDone && !hideProgressMetrics && (
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              {isVerified ? 'Remaining' : 'To pick'}
            </p>
            <div className="flex items-baseline gap-1 tabular-nums">
              <span className="font-mono font-bold text-[32px] leading-none text-[var(--content-primary)]">
                {isVerified ? remainingQty : targetQty}
              </span>
              <span className="text-sm text-[var(--content-tertiary)]">pcs</span>
            </div>
          </div>
          <div className="rounded-full bg-[var(--bg-tertiary)] px-3 py-1.5 font-mono text-lg font-bold tabular-nums text-[var(--content-primary)]">
            {pickedQty}
            <span className="text-[var(--content-tertiary)] font-normal"> / </span>
            {targetQty}
            <span className="ml-1 text-xs font-semibold text-[var(--content-tertiary)]">pcs</span>
          </div>
        </div>
      )}

      {!isDone && !hideProgressMetrics && targetQty > 0 && (
        <div className="mt-2">
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
