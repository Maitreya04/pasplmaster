import { Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Queue, UsersThree, Barcode } from '@phosphor-icons/react';
import { BottomNav } from '../../components/shared';
import type { BottomNavItem } from '../../components/shared/BottomNav';
import { DevRoleSwitcher } from '../../components/dev/DevRoleSwitcher';
import { useCameraPermissionWarmup } from '../../context/CameraContext';
import { useAuth } from '../../context/AuthContext';
import { warmPickQueueRoute } from '../../lib/picking/warmPickQueue';

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
    label: 'Active',
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

  const { permissionState, requestWarmup } = useCameraPermissionWarmup();

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

      <div className={isPickPage ? '' : 'pb-24'}>
        <Outlet />
      </div>
      {!isPickPage && <BottomNav items={NAV_ITEMS} />}
      <DevRoleSwitcher />
    </div>
  );
}
