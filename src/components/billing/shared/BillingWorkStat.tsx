import { BillingFigure } from './BillingFigure';

interface BillingWorkStatProps {
  label: string;
  value: number | string;
}

/** Paired label + hero number — same scale for every stat in a work header. */
export function BillingWorkStat({ label, value }: BillingWorkStatProps): React.JSX.Element {
  return (
    <div className="billing-work-stat shrink-0">
      <span className="billing-work-stat__label">{label}</span>
      <BillingFigure
        value={value}
        kind={typeof value === 'number' ? 'integer' : 'text'}
        size="stat"
        className="billing-work-stat__value"
      />
    </div>
  );
}
