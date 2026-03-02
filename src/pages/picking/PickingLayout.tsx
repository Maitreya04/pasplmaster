import { Outlet, useLocation } from 'react-router-dom';
import { Queue, ListChecks } from '@phosphor-icons/react';
import { BottomNav } from '../../components/shared';
import { DevRoleSwitcher } from '../../components/dev/DevRoleSwitcher';

const NAV_ITEMS = [
  { icon: Queue, label: 'Queue', path: '/picking' },
  { icon: ListChecks, label: 'Active Pick', path: '/picking' },
];

export default function PickingLayout() {
  const location = useLocation();
  const isPickPage = location.pathname.startsWith('/picking/pick/');

  return (
    <div className="theme-dark role-picking min-h-screen bg-[var(--bg-primary)] relative">
      <div className={isPickPage ? '' : 'pb-20'}>
        <Outlet />
      </div>
      {!isPickPage && <BottomNav items={NAV_ITEMS} />}
      <DevRoleSwitcher />
    </div>
  );
}
