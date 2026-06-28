import { Link, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Queue, UsersThree, Barcode, CloudArrowUp, Warning } from '@phosphor-icons/react';
import { BottomNav } from '../../components/shared';
import type { BottomNavItem } from '../../components/shared/BottomNav';
import { OfflineStatusBanner } from '../../components/shared/OfflineStatusBanner';
import { DevRoleSwitcher } from '../../components/dev/DevRoleSwitcher';
import { useAuth } from '../../context/AuthContext';
import { warmPickQueueRoute } from '../../lib/picking/warmPickQueue';
import { useOfflinePickStats, useOfflinePickSync } from '../../hooks/useOfflinePicks';

const preloadQueue = () => import('./QueuePage');
const preloadActivePicks = () => import('./ActivePicksPage');
const preloadBarcodeMapping = () => import('../admin/BarcodeMappingPage');

const NAV_ITEMS: BottomNavItem[] = [
  {
    icon: Queue,
    label: 'Queue',
    path: '/picking',
    navKey: 'picking-queue',
    match: (pathname) => pathname === '/picking',
    preload: preloadQueue,
  },
  {
    icon: UsersThree,
    label: 'Team',
    path: '/picking/active',
    navKey: 'picking-active',
    match: (pathname) => pathname === '/picking/active',
    preload: preloadActivePicks,
  },
  {
    icon: Barcode,
    label: 'Map SKU',
    path: '/picking/barcode-mapping',
    navKey: 'picking-barcode',
    preload: preloadBarcodeMapping,
  },
];

export default function PickingLayout(): React.JSX.Element | null {
  return <PickingLayoutInner />;
}

function PickingLayoutInner(): React.JSX.Element | null {
  const location = useLocation();
  const isPickPage = location.pathname.startsWith('/picking/pick/');
  const { userId } = useAuth();
  const offlineStats = useOfflinePickStats();

  useOfflinePickSync();

  useEffect(() => {
    warmPickQueueRoute(userId);
  }, [userId]);

  return (
    <div className="role-picking min-h-screen bg-[var(--bg-primary)] relative">
      <OfflineStatusBanner
        pendingCount={offlineStats.waiting + offlineStats.conflict + offlineStats.failed}
        syncing={offlineStats.syncing > 0}
      />
      {!isPickPage && (offlineStats.waiting > 0 || offlineStats.conflict > 0 || offlineStats.failed > 0) && (
        <div className="px-3 pt-3 pb-1">
          <Link
            to={offlineStats.conflict > 0 || offlineStats.failed > 0 ? '/billing/offline-picks' : '/picking'}
            className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
              offlineStats.conflict > 0 || offlineStats.failed > 0
                ? 'border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]'
                : 'border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
            }`}
          >
            {offlineStats.conflict > 0 || offlineStats.failed > 0 ? (
              <Warning size={17} weight="fill" className="shrink-0" />
            ) : (
              <CloudArrowUp size={17} weight="fill" className="shrink-0" />
            )}
            <span className="min-w-0 flex-1">
              {offlineStats.conflict > 0
                ? `${offlineStats.conflict} offline pick needs review`
                : offlineStats.failed > 0
                  ? `${offlineStats.failed} offline pick sync failed`
                  : offlineStats.syncing > 0
                    ? 'Syncing offline pick'
                    : `${offlineStats.waiting} offline pick waiting to sync`}
            </span>
          </Link>
        </div>
      )}

      <div className={isPickPage ? '' : 'pb-24'}>
        <Outlet />
      </div>
      {!isPickPage && <BottomNav items={NAV_ITEMS} />}
      <DevRoleSwitcher />
    </div>
  );
}
