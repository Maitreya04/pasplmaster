import { CheckCircle } from '@phosphor-icons/react';
import { normalizeUom } from '../../../lib/picking/pickerMicrocopy';
import { pickQtyOrderCopy, pickQtyVariance } from '../lib/pickQtyDisplay';
import type { PickLineUiState } from '../lib/pickLineCta';

export interface PickQtyMeterProps {
  totalLogged: number;
  /** Billing-approved qty on the order line — never the shrunk segment row qty. */
  targetQty: number;
  remaining: number;
  uom: string;
  uiState: PickLineUiState;
}

function panelLabel(uiState: PickLineUiState, remaining: number, isOver: boolean): string {
  if (isOver) return 'Over order qty';
  if (uiState === 'marked_picked' || uiState === 'complete') return 'Complete';
  if (uiState === 'marked_partial') return 'Partial pick';
  if (uiState === 'in_progress' && remaining > 0) return 'Still to pick';
  return 'Pick qty';
}

export function PickQtyMeter({
  totalLogged,
  targetQty: orderedQty,
  remaining,
  uom,
  uiState,
}: PickQtyMeterProps): React.JSX.Element {
  const uomNorm = normalizeUom(uom);
  const isDone = uiState === 'marked_picked' || uiState === 'complete';
  const isPartialMarked = uiState === 'marked_partial';
  const loggedQty = isDone && totalLogged === 0 ? orderedQty : totalLogged;
  const { isOver, isUnder } = pickQtyVariance(loggedQty, orderedQty);
  const pct =
    orderedQty > 0 ? Math.min(100, Math.round((loggedQty / orderedQty) * 100)) : 0;

  const panelClass = isOver
    ? 'pick-ticket-qty-panel pick-ticket-qty-panel--partial'
    : isDone
      ? 'pick-ticket-qty-panel pick-ticket-qty-panel--complete'
      : isPartialMarked
        ? 'pick-ticket-qty-panel pick-ticket-qty-panel--partial'
        : 'pick-ticket-qty-panel';

  const subtext =
    isDone || isPartialMarked
      ? pickQtyOrderCopy(loggedQty, orderedQty, uom)
      : totalLogged > 0 && remaining > 0
        ? `${remaining} ${uomNorm.toLowerCase()} left · ${orderedQty} on order`
        : `${orderedQty} ${uomNorm.toLowerCase()} on order`;

  return (
    <div className={panelClass}>
      <div className="pick-ticket-step-row">
        <span className="pick-ticket-step" aria-hidden>
          3
        </span>
        <p
          className={`pick-identity-label ${
            isOver
              ? 'text-[var(--content-warning-on-light)]'
              : isDone
                ? 'text-[var(--content-positive)]'
                : isPartialMarked
                  ? 'text-[var(--content-warning-on-light)]'
                  : 'text-[var(--amber-9)]'
          }`}
        >
          {panelLabel(uiState, remaining, isOver)}
        </p>
        {isDone && !isOver ? (
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
        aria-valuenow={loggedQty}
        aria-valuemin={0}
        aria-valuemax={orderedQty}
        aria-label={`${loggedQty} logged of ${orderedQty} on order`}
      >
        <div
          className={`pick-qty-meter-fill ${isDone && !isOver ? 'pick-qty-meter-fill--complete' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="pick-ticket-qty-row mt-2">
        <span className="pick-ticket-qty-value font-mono font-extrabold tabular-nums">
          {loggedQty}
        </span>
        <span className="font-mono text-sm font-bold tabular-nums text-[var(--content-tertiary)]">
          / {orderedQty}
        </span>
        <span className="pick-ticket-uom">{uomNorm}</span>
        <span className="ml-1 font-ds-micro font-semibold text-[var(--content-quaternary)]">
          on order
        </span>
      </div>
      <p
        className={`mt-1 font-ds-micro ${
          isOver
            ? 'font-semibold text-[var(--content-warning-on-light)]'
            : isUnder && (isPartialMarked || isDone)
              ? 'text-[var(--content-warning-on-light)]'
              : 'text-[var(--content-tertiary)]'
        }`}
      >
        {subtext}
      </p>
    </div>
  );
}
