import { useEffect, useState } from 'react';
import { CloudArrowUp, Warning } from '@phosphor-icons/react';
import {
  formatOfflineLeaseRemaining,
  getOfflineLeaseWarningLevel,
} from '../../lib/offlinePickLease';

interface OfflinePickLeaseBannerProps {
  leaseExpiresAt: string | null | undefined;
  onExtendLease?: () => void;
  extending?: boolean;
}

export function OfflinePickLeaseBanner({
  leaseExpiresAt,
  onExtendLease,
  extending = false,
}: OfflinePickLeaseBannerProps): React.JSX.Element | null {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!leaseExpiresAt) return undefined;
    const timer = window.setInterval(() => setTick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [leaseExpiresAt]);

  const level = getOfflineLeaseWarningLevel(leaseExpiresAt);
  const remainingLabel = formatOfflineLeaseRemaining(leaseExpiresAt);
  const urgent = level === 'urgent' || level === 'expired';

  return (
    <div
      className={`z-50 flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs font-semibold ${
        urgent
          ? 'border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]'
          : level === 'soon'
            ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]'
            : 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]'
      }`}
    >
      {urgent ? (
        <Warning size={16} weight="fill" className="shrink-0" />
      ) : (
        <CloudArrowUp size={16} weight="fill" className="shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        Offline-ready pick — scans save on this device.
        {remainingLabel ? ` ${remainingLabel}.` : ''}
        {level === 'expired'
          ? ' Sync soon or billing may need to review.'
          : ' Sync when you finish.'}
      </span>
      {onExtendLease && level !== 'ok' && typeof navigator !== 'undefined' && navigator.onLine && (
        <button
          type="button"
          onClick={onExtendLease}
          disabled={extending}
          className="shrink-0 rounded-lg bg-[var(--bg-primary)] px-2.5 py-1 text-[11px] font-bold text-[var(--content-accent)] disabled:opacity-50"
        >
          {extending ? 'Extending…' : 'Extend'}
        </button>
      )}
    </div>
  );
}
