import { Link, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Queue, UsersThree, Barcode, CloudArrowUp, Warning } from '@phosphor-icons/react';
import { BottomNav } from '../../components/shared';
import type { BottomNavItem } from '../../components/shared/BottomNav';
import { DevRoleSwitcher } from '../../components/dev/DevRoleSwitcher';
import { useCameraPermissionWarmup } from '../../context/CameraContext';
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

  const { permissionState, requestWarmup } = useCameraPermissionWarmup();
  useOfflinePickSync();

  useEffect(() => {
    warmPickQueueRoute(userId);
  }, [userId]);

  return (
    <div className="role-picking min-h-screen bg-[var(--bg-primary)] relative">
      {permissionState === 'prompt' && (
        <div className="px-3 pt-3 pb-1">
          <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2.5 flex flex-wrap items-center gap-2 justify-between">
            <p className="text-xs text-emerald-100 min-w-0 flex-1">
              Enable the camera once for faster barcode scans while picking.
            </p>
            <button
              type="button"
              onClick={() => void requestWarmup()}
              className="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-950 active:scale-[0.98]"
            >
              Enable camera
            </button>
          </div>
        </div>
      )}
      {permissionState === 'denied' && (
        <div className="px-3 pt-3 pb-1">
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
            Camera access is blocked. Allow the camera in browser settings to use the live scanner.
          </div>
        </div>
      )}
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
