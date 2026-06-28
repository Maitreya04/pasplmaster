import { CheckCircle } from '@phosphor-icons/react';
import { normalizeUom, uomLabel } from '../../../lib/picking/pickerMicrocopy';
import type { PickLineUiState } from '../lib/pickLineCta';

export interface PickQtyMeterProps {
  totalLogged: number;
  targetQty: number;
  remaining: number;
  uom: string;
  uiState: PickLineUiState;
}

function panelLabel(uiState: PickLineUiState, remaining: number): string {
  if (uiState === 'marked_picked' || uiState === 'complete') return 'Complete';
  if (uiState === 'marked_partial') return 'Partial pick';
  if (uiState === 'in_progress' && remaining > 0) return 'Still to pick';
  return 'Pick qty';
}

function subtext(
  uiState: PickLineUiState,
  totalLogged: number,
  targetQty: number,
  remaining: number,
  uom: string,
): string {
  const u = uomLabel(uom, remaining > 0 ? remaining : targetQty);
  if (uiState === 'marked_picked' || uiState === 'complete') {
    return `All ${targetQty} ${uomLabel(uom, targetQty)} logged`;
  }
  if (uiState === 'marked_partial') {
    return `${totalLogged > 0 ? totalLogged : targetQty} logged — billing will review`;
  }
  if (totalLogged > 0 && remaining > 0) {
    return `${remaining} ${u} left on this line`;
  }
  return `${targetQty} on this line`;
}

export function PickQtyMeter({
  totalLogged,
  targetQty,
  remaining,
  uom,
  uiState,
}: PickQtyMeterProps): React.JSX.Element {
  const uomNorm = normalizeUom(uom);
  const isDone = uiState === 'marked_picked' || uiState === 'complete';
  const isPartialMarked = uiState === 'marked_partial';
  const displayLogged = isDone && totalLogged === 0 ? targetQty : totalLogged;
  const pct = targetQty > 0 ? Math.min(100, Math.round((displayLogged / targetQty) * 100)) : 0;
  const heroQty =
    uiState === 'in_progress' && remaining > 0 && !isDone
      ? remaining
      : isDone
        ? targetQty
        : targetQty;

  const panelClass = isDone
    ? 'pick-ticket-qty-panel pick-ticket-qty-panel--complete'
    : isPartialMarked
      ? 'pick-ticket-qty-panel pick-ticket-qty-panel--partial'
      : 'pick-ticket-qty-panel';

  return (
    <div className={panelClass}>
      <div className="pick-ticket-step-row">
        <span className="pick-ticket-step" aria-hidden>
          3
        </span>
        <p
          className={`pick-identity-label ${
            isDone
              ? 'text-[var(--content-positive)]'
              : isPartialMarked
                ? 'text-[var(--content-warning-on-light)]'
                : 'text-[var(--amber-9)]'
          }`}
        >
          {panelLabel(uiState, remaining)}
        </p>
        {isDone ? (
          <CheckCircle
            size={14}
            weight="fill"
            className="ml-auto text-[var(--content-positive)]"
            aria-hidden
          />
        ) : null}
      </div>

      <div
        className="pick-qty-meter-track mt-2"
        role="progressbar"
        aria-valuenow={displayLogged}
        aria-valuemin={0}
        aria-valuemax={targetQty}
        aria-label={`${displayLogged} of ${targetQty} picked`}
      >
        <div
          className={`pick-qty-meter-fill ${isDone ? 'pick-qty-meter-fill--complete' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="pick-ticket-qty-row mt-2">
        <span className="pick-ticket-qty-value font-mono font-extrabold tabular-nums">
          {heroQty}
        </span>
        <span className="font-mono text-sm font-bold tabular-nums text-[var(--content-tertiary)]">
          / {targetQty}
        </span>
        <span className="pick-ticket-uom">{uomNorm}</span>
      </div>
      <p className="mt-1 font-ds-micro text-[var(--content-tertiary)]">
        {subtext(uiState, displayLogged, targetQty, remaining, uom)}
      </p>
    </div>
  );
}
