import type { Icon } from '@phosphor-icons/react';
import { Link, useLocation } from 'react-router-dom';
import { appHaptics } from '../../lib/haptics';

export interface BottomNavItem {
  icon: Icon;
  label: string;
  path: string;
  match?: (pathname: string, search: string) => boolean;
}

interface BottomNavProps {
  items: BottomNavItem[];
}

export function BottomNav({ items }: BottomNavProps): React.JSX.Element | null {
  const location = useLocation();
  const currentFull = location.pathname + location.search;

  return (
    <nav
      className="
        fixed left-3 right-3 z-50
        flex items-stretch
        rounded-[26px] border border-[color:color-mix(in_srgb,var(--border-opaque)_58%,white)]
        bg-[color:color-mix(in_srgb,var(--bg-secondary)_88%,white)]
        px-2 py-1 shadow-[0_8px_24px_rgba(15,23,42,0.06),0_1px_4px_rgba(15,23,42,0.05)]
        backdrop-blur-[18px] supports-[backdrop-filter]:bg-[color:color-mix(in_srgb,var(--bg-secondary)_80%,transparent)]
      "
      style={{
        bottom: 'max(env(safe-area-inset-bottom, 0px), 8px)',
        minHeight: '58px',
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 6px)',
      }}
    >
      {items.map((item) => {
        const isActive = item.match
          ? item.match(location.pathname, location.search)
          : item.path.includes('?')
            ? currentFull === item.path
            : location.pathname === item.path;
        const IconCmp = item.icon;

        return (
          <Link
            key={item.path}
            to={item.path}
            onClick={() => {
              if (!isActive) appHaptics.selection();
            }}
            className={`
              flex min-h-[48px] min-w-0 flex-1 items-center justify-center rounded-[18px]
              px-2 py-2 no-underline transition-transform duration-150 ease-out active:scale-[0.985]
              ${isActive ? 'text-[var(--role-primary)]' : 'text-[var(--content-tertiary)]'}
            `}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="flex min-w-0 flex-col items-center justify-center gap-1">
              <IconCmp
                size={21}
                weight={isActive ? 'fill' : 'regular'}
                className="transition-colors duration-150 ease-out"
              />
              <span
                className={`
                  truncate text-[10.5px] leading-[1.05] tracking-[-0.01em] transition-colors duration-150 ease-out
                  ${isActive ? 'font-semibold' : 'font-medium'}
                `}
              >
                {item.label}
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
