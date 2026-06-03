function formatStatValue(value: number | string): string {
  return typeof value === 'number' ? value.toLocaleString('en-IN') : value;
}

interface BillingWorkStatProps {
  label: string;
  value: number | string;
}

/** Paired label + hero number — same scale for every stat in a work header. */
export function BillingWorkStat({ label, value }: BillingWorkStatProps): React.JSX.Element {
  return (
    <div className="billing-work-stat">
      <span className="billing-work-stat__label">{label}</span>
      <span className="billing-work-stat__value">{formatStatValue(value)}</span>
    </div>
  );
}
