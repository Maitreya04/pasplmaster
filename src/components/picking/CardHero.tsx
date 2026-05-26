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
    <div className="relative flex min-h-0 flex-col px-3 pt-2 pb-2 sm:px-4 sm:pt-3">
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

      <div className="mb-2 flex items-start justify-between gap-2">
        {positionLabel ? (
          <span className="min-w-0 text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)] tabular-nums">
            {positionLabel}
          </span>
        ) : (
          <span />
        )}
        {!isDone && hideProgressMetrics && (
          <div className="shrink-0 rounded-xl bg-[var(--bg-inverse-primary)] px-3 py-1.5 text-right">
            <span className="font-mono text-lg font-extrabold tabular-nums leading-none text-white">
              {targetQty}
            </span>
            <span className="ml-1 text-[10px] font-semibold uppercase text-white/70">pcs</span>
          </div>
        )}
        {isFlagged && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--bg-negative-subtle)] px-2.5 py-1 text-[10px] font-semibold text-[var(--content-negative)]">
            Flagged
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onRackTap}
        disabled={isDone}
        className={`mb-2 w-full rounded-2xl p-3 text-left pick-pressable transition-colors ${
          isAwaitingRack
            ? 'border-2 border-dashed border-[var(--border-opaque)] bg-[var(--bg-tertiary)]'
            : isVerified
              ? 'border-2 border-[var(--border-positive)] bg-[var(--bg-positive-subtle)]'
              : 'border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] opacity-80'
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
            <Check size={14} weight="bold" className="ml-auto text-[var(--content-positive)]" />
          )}
        </div>
        <p className="pick-hero-rack mt-1 font-mono font-extrabold text-[var(--content-primary)]">
          {rackNo ?? '—'}
        </p>
        {isAwaitingRack && (
          <p className="mt-1 text-[11px] text-[var(--content-tertiary)]">
            Tap when you&apos;re at this rack (no label to scan)
          </p>
        )}
      </button>

      <p className="pick-hero-code break-all font-mono font-bold text-[var(--content-primary)]">
        {partNo}
      </p>
      <p className="mt-1 line-clamp-2 text-sm leading-snug text-[var(--content-secondary)]">{itemName}</p>
      {flagReason && isFlagged && (
        <p className="mt-1 text-xs font-medium text-[var(--content-negative)]">{flagReason}</p>
      )}

      {!isDone && !hideProgressMetrics && (
        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
              {isVerified ? 'Remaining' : 'To pick'}
            </p>
            <div className="flex items-baseline gap-1 tabular-nums">
              <span className="pick-metric-value font-mono font-extrabold text-[var(--content-primary)]">
                {isVerified ? remainingQty : targetQty}
              </span>
              <span className="text-sm text-[var(--content-tertiary)]">pcs</span>
            </div>
          </div>
          <div className="rounded-full bg-[var(--bg-tertiary)] px-3 py-1.5 font-mono text-lg font-bold tabular-nums text-[var(--content-primary)]">
            {pickedQty}
            <span className="font-normal text-[var(--content-tertiary)]"> / </span>
            {targetQty}
            <span className="ml-1 text-xs font-semibold text-[var(--content-tertiary)]">pcs</span>
          </div>
        </div>
      )}

      {!isDone && !hideProgressMetrics && targetQty > 0 && pickedQty > 0 && (
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
