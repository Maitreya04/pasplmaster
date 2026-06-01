import {
  customerNameSizeClass,
  orderAgePill,
} from '../../../lib/billing/orderAgeTier';
import { billingShell } from './billingShell';

interface BillingBillHeaderProps {
  customerName: string;
  orderId?: string | number | null;
  createdAt?: string | null;
  priority?: string;
  transportName?: string | null;
  carrierName?: string | null;
}

function OrderTypePill({
  priority,
  transportName,
  carrierName,
}: {
  priority?: string;
  transportName?: string | null;
  carrierName?: string | null;
}): React.JSX.Element {
  if (priority === 'urgent') {
    return (
      <span className={billingShell.metaPillNegative} aria-label="Urgent order">
        Urgent
      </span>
    );
  }

  if (transportName) {
    const label = carrierName ? `Transport · ${carrierName}` : transportName;
    return (
      <span className={billingShell.metaPillAccent} aria-label={`Transport order: ${label}`}>
        {label}
      </span>
    );
  }

  return (
    <span className={billingShell.metaPillNeutral} aria-label="Local order">
      Local
    </span>
  );
}

function OrderAgePill({ createdAt }: { createdAt: string }): React.JSX.Element | null {
  const pill = orderAgePill(createdAt);
  if (!pill) return null;

  const className =
    pill.tier === 'critical'
      ? billingShell.metaPillNegative
      : billingShell.metaPillWarning;

  return (
    <span className={className} aria-label={`Order age: ${pill.label}`}>
      {pill.label}
    </span>
  );
}

export function BillingBillHeader({
  customerName,
  orderId,
  createdAt,
  priority,
  transportName,
  carrierName,
}: BillingBillHeaderProps): React.JSX.Element {
  return (
    <header className={billingShell.header}>
      <h1
        className={`${customerNameSizeClass(customerName)} font-medium text-[var(--content-primary)] truncate min-w-0 shrink`}
      >
        {customerName}
      </h1>

      <OrderTypePill
        priority={priority}
        transportName={transportName}
        carrierName={carrierName}
      />

      {createdAt ? <OrderAgePill createdAt={createdAt} /> : null}

      {orderId ? (
        <span className={billingShell.orderId}>#{orderId}</span>
      ) : null}
    </header>
  );
}
