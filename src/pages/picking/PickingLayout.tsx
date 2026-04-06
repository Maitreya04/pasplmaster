import { Outlet, useLocation } from 'react-router-dom';
import { Queue, ListChecks } from '@phosphor-icons/react';
import { BottomNav } from '../../components/shared';
import type { BottomNavItem } from '../../components/shared/BottomNav';
import { DevRoleSwitcher } from '../../components/dev/DevRoleSwitcher';

const preloadQueue = () => import('./QueuePage');

const NAV_ITEMS: BottomNavItem[] = [
  { icon: Queue, label: 'Queue', path: '/picking', preload: preloadQueue },
  { icon: ListChecks, label: 'Active Pick', path: '/picking', preload: preloadQueue },
];

export default function PickingLayout(): React.JSX.Element | null {
  const location = useLocation();
  const isPickPage = location.pathname.startsWith('/picking/pick/');

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
