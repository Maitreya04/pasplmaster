import {
  buildHandoffScanSteps,
  formatChangeCountLine,
  formatHandoffCompletedClock,
  formatHandoffDuration,
  formatHandoffMetaLine,
  type OrderHandoffSummary,
} from '../../../lib/billing/orderHandoffFromEvents';

export interface OrderHandoffRowProps {
  summary: OrderHandoffSummary;
  salesperson?: string | null;
}

export function OrderHandoffRow({
  summary,
  salesperson,
}: OrderHandoffRowProps): React.JSX.Element {
  const steps = buildHandoffScanSteps(summary, salesperson);
  const duration = formatHandoffDuration(summary.submittedAt, summary.completedAt);
  const completedClock = formatHandoffCompletedClock(summary.completedAt);
  const metaLine = formatHandoffMetaLine(duration, completedClock);
  const changeLine = formatChangeCountLine(summary.changeCount);

  return (
    <div className="billing-handoff-band billing-handoff-band--header shrink-0">
      <div className="flex min-w-0 items-center justify-between gap-4">
        <div
          className="billing-handoff-scan min-w-0 flex-1 overflow-x-auto"
          aria-label="Who worked this order"
        >
          {steps.map((step, index) => (
            <div
              key={step.key}
              className={`billing-handoff-segment ${index === 0 ? 'billing-handoff-segment--first' : ''}`}
            >
              <span className="billing-handoff-segment__label">{step.label}</span>
              <span className="billing-handoff-segment__name">{step.name}</span>
            </div>
          ))}
        </div>

        {metaLine ? (
          <span className="billing-handoff-meta shrink-0 tabular-nums">{metaLine}</span>
        ) : null}
      </div>

      {changeLine ? (
        <p className="mt-1 font-ds-micro font-medium text-[var(--content-quaternary)]">
          {changeLine}
        </p>
      ) : null}
    </div>
  );
}
