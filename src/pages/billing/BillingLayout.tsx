import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { SquaresFour, ClipboardText, ClockCounterClockwise } from '@phosphor-icons/react';
import { BottomNav } from '../../components/shared';
import { DevRoleSwitcher } from '../../components/dev/DevRoleSwitcher';

const NAV_ITEMS = [
  { icon: SquaresFour, label: 'Dashboard', path: '/billing' },
  { icon: ClipboardText, label: 'Needs Review', path: '/billing/needs-review' },
  { icon: ClockCounterClockwise, label: 'History', path: '/billing/history' },
];

export default function BillingLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="theme-light role-billing min-h-screen bg-[var(--bg-primary)] relative">
      <div className="flex">
        {/* Sidebar — visible on lg+ */}
        <aside className="hidden lg:flex flex-col w-56 min-h-screen border-r border-[var(--border-opaque)] bg-[var(--bg-secondary)] py-6 px-3 shrink-0">
          <p className="px-3 text-xs font-semibold text-[var(--content-quaternary)] uppercase tracking-wider mb-4">
            Billing
          </p>
          {NAV_ITEMS.map(({ icon: IconCmp, label, path }) => {
            const active = location.pathname === path;
            return (
              <button
                key={path}
                onClick={() => navigate(path)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors duration-150 mb-1 w-full text-left ${
                  active
                    ? 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                    : 'text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                <IconCmp size={20} weight={active ? 'fill' : 'regular'} />
                {label}
              </button>
            );
          })}
        </aside>

        {/* Content */}
        <main className="flex-1 pb-20 lg:pb-0">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav — mobile only */}
      <div className="lg:hidden">
        <BottomNav items={NAV_ITEMS} />
      </div>
      <DevRoleSwitcher />
    </div>
  );
}
