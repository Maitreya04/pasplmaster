import { Outlet } from 'react-router-dom';
import { Queue, ListChecks } from '@phosphor-icons/react';
import { BottomNav } from '../../components/shared';

const NAV_ITEMS = [
  { icon: Queue, label: 'Queue', path: '/picking' },
  { icon: ListChecks, label: 'Active Pick', path: '/picking/pick' },
];

export default function PickingLayout() {
  return (
    <div className="theme-dark role-picking min-h-screen bg-[var(--bg-primary)]">
      <div className="pb-20">
        <Outlet />
      </div>
      <BottomNav items={NAV_ITEMS} />
    </div>
  );
}
