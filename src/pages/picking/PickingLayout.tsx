import { Outlet, useLocation } from 'react-router-dom';
import { Queue, ListChecks, Barcode } from '@phosphor-icons/react';
import { BottomNav } from '../../components/shared';
import type { BottomNavItem } from '../../components/shared/BottomNav';
import { DevRoleSwitcher } from '../../components/dev/DevRoleSwitcher';
import { useCameraPermissionWarmup } from '../../context/CameraContext';

const preloadQueue = () => import('./QueuePage');
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
    icon: ListChecks,
    label: 'Active Pick',
    path: '/picking',
    navKey: 'picking-active',
    match: (pathname) =>
      pathname.startsWith('/picking/pick/') || pathname.startsWith('/picking/preview/'),
    preload: preloadQueue,
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
  const isPickPage =
    location.pathname.startsWith('/picking/pick/') ||
    location.pathname.startsWith('/picking/preview/');

  const { permissionState, requestWarmup } = useCameraPermissionWarmup();

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
