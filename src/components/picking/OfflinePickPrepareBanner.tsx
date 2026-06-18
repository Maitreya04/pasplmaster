import { CloudArrowUp, WifiSlash } from '@phosphor-icons/react';

interface OfflinePickPrepareBannerProps {
  online: boolean;
}

export function OfflinePickPrepareBanner({
  online,
}: OfflinePickPrepareBannerProps): React.JSX.Element {
  return (
    <div className="z-50 flex shrink-0 items-center gap-2 border-b border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-3 py-2 text-xs font-semibold text-[var(--content-warning-on-light)]">
      {online ? (
        <CloudArrowUp size={16} weight="fill" className="shrink-0" />
      ) : (
        <WifiSlash size={16} weight="fill" className="shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        {online
          ? 'Connecting this pick to the server — keep scanning, scans save on this device.'
          : 'Offline pick in progress — scans save on this device and will sync when you reconnect.'}
      </span>
    </div>
  );
}
