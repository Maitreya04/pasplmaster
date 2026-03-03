import type { Icon } from '@phosphor-icons/react';
import { Link, useLocation } from 'react-router-dom';

export interface BottomNavItem {
  icon: Icon;
  label: string;
  path: string;
}

interface BottomNavProps {
  items: BottomNavItem[];
}

export function BottomNav({ items }: BottomNavProps) {
  const location = useLocation();

  return (
    <nav
      className="
        fixed bottom-0 left-0 right-0 z-50
        h-16 pb-[env(safe-area-inset-bottom)]
        bg-[var(--bg-secondary)]
        border-t border-[var(--border-opaque)]
        flex items-center justify-around
      "
    >
      {items.map((item) => {
        const currentFull = location.pathname + location.search;
        const isActive = item.path.includes('?')
          ? currentFull === item.path
          : location.pathname === item.path;
        const IconCmp = item.icon;

        return (
          <Link
            key={item.path}
            to={item.path}
            className={`
              flex flex-col items-center justify-center gap-0.5
              min-h-[48px] min-w-[48px] px-3 py-1
              text-xs font-medium transition-colors duration-150
              no-underline
              ${isActive ? 'text-[var(--content-primary)]' : 'text-[var(--content-tertiary)]'}
            `}
          >
            <IconCmp size={20} weight="bold" />
            <span>{item.label}</span>
            {isActive && (
              <span className="w-1 h-1 rounded-full bg-[var(--role-primary)] mt-0.5" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

