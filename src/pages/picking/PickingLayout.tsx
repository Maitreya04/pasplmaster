import { Outlet, useLocation } from 'react-router-dom';
import { Queue, ListChecks, Barcode } from '@phosphor-icons/react';
import { BottomNav } from '../../components/shared';
import type { BottomNavItem } from '../../components/shared/BottomNav';
import { DevRoleSwitcher } from '../../components/dev/DevRoleSwitcher';

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
  const location = useLocation();
  const isPickPage =
    location.pathname.startsWith('/picking/pick/') ||
    location.pathname.startsWith('/picking/preview/');

  return (
    <div className="role-picking min-h-screen bg-[var(--bg-primary)] relative">
      <div className={isPickPage ? '' : 'pb-24'}>
        <Outlet />
      </div>
      {!isPickPage && <BottomNav items={NAV_ITEMS} />}
      <DevRoleSwitcher />
    </div>
  );
}
