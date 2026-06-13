import { Link } from 'react-router-dom';
import { MapPin, X } from '@phosphor-icons/react';
import type { NearbyGeofencedCustomer } from '../../types/visit';
import { formatDistanceM } from '../../lib/geo/distanceUtils';

export function NearbyGeofencePrompt({
  customer,
  onDismiss,
}: {
  customer: NearbyGeofencedCustomer;
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <div className="mx-4 mb-3 rounded-xl border border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] px-3 py-3">
      <div className="flex items-start gap-3">
        <MapPin size={20} weight="fill" className="mt-0.5 shrink-0 text-[var(--content-accent)]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--content-primary)]">
            Near {customer.customer_name}
          </p>
          <p className="text-xs text-[var(--content-secondary)]">
            About {formatDistanceM(customer.distance_m)} away · tap to open customer
          </p>
          <Link
            to={`/sales/customer/${customer.customer_id}`}
            className="mt-2 inline-flex rounded-lg bg-[var(--role-primary)] px-3 py-2 text-xs font-semibold text-white"
          >
            Open customer
          </Link>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-lg p-2 text-[var(--content-tertiary)]"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
