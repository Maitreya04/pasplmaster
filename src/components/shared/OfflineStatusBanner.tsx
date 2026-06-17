import { useEffect, useState } from 'react';
import { CloudArrowUp, WifiSlash } from '@phosphor-icons/react';

interface OfflineStatusBannerProps {
  pendingCount?: number;
  syncing?: boolean;
  label?: string;
}

export function OfflineStatusBanner({
  pendingCount = 0,
  syncing = false,
  label,
}: OfflineStatusBannerProps): React.JSX.Element | null {
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );

  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (!offline && pendingCount <= 0 && !syncing) return null;

  const message =
    label ??
    (offline
      ? syncing
        ? 'Offline — syncing when possible'
        : pendingCount > 0
          ? `Offline — ${pendingCount} waiting to sync`
          : 'Offline — using saved data'
      : syncing
        ? 'Syncing saved changes'
        : `${pendingCount} waiting to sync`);

  return (
    <div
      className={`flex items-center gap-2 border-b px-3 py-2 text-xs font-semibold ${
        offline
          ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]'
          : 'border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
      }`}
    >
      {offline ? (
        <WifiSlash size={16} weight="bold" className="shrink-0" />
      ) : (
        <CloudArrowUp size={16} weight="fill" className="shrink-0" />
      )}
      <span className="min-w-0 flex-1">{message}</span>
    </div>
  );
}
