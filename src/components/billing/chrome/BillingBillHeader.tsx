import { MapPin } from '@phosphor-icons/react';
import {
  customerNameSizeClass,
  orderAgePill,
} from '../../../lib/billing/orderAgeTier';
import { billingShell } from './billingShell';

interface BillingBillHeaderProps {
  customerName: string;
  /** Station / city label shown before the local address. */
  customerCity?: string | null;
  customerAddress?: string | null;
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
  customerCity,
  customerAddress,
  orderId,
  createdAt,
  priority,
  transportName,
  carrierName,
}: BillingBillHeaderProps): React.JSX.Element {
  const station = customerCity?.trim() ?? '';
  const address = customerAddress?.trim() ?? '';
  const locationLine = [station, address].filter(Boolean).join(' · ');

  return (
    <header className={billingShell.header}>
      <div className="min-w-0 shrink">
        <h1
          className={`${customerNameSizeClass(customerName)} font-medium leading-tight text-[var(--content-primary)] truncate min-w-0`}
        >
          {customerName}
        </h1>
        {locationLine ? (
          <p
            className="mt-0.5 flex min-w-0 items-center gap-1 truncate font-ds-caption-size leading-tight text-[var(--content-tertiary)]"
            title={locationLine}
          >
            <MapPin size={13} className="shrink-0 text-[var(--content-quaternary)]" />
            <span className="min-w-0 truncate">
              {station ? (
                <span className="font-medium text-[var(--content-secondary)]">{station}</span>
              ) : null}
              {station && address ? (
                <span className="px-1 text-[var(--content-quaternary)]">·</span>
              ) : null}
              {address ? <span>{address}</span> : null}
            </span>
          </p>
        ) : null}
      </div>

      <div className="ml-auto flex min-w-0 shrink-0 flex-col items-end gap-1.5">
        {orderId ? (
          <span className={billingShell.orderId}>#{orderId}</span>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          <OrderTypePill
            priority={priority}
            transportName={transportName}
            carrierName={carrierName}
          />
          {createdAt ? <OrderAgePill createdAt={createdAt} /> : null}
        </div>
      </div>
    </header>
  );
}
