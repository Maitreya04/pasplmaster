import { useState, useRef, useCallback, useEffect } from 'react';
import type { Icon } from '@phosphor-icons/react';
import { Link, useLocation } from 'react-router-dom';
import { appHaptics } from '../../lib/haptics';
import type { IconWeight } from '@phosphor-icons/react';

export interface BottomNavItem {
  icon: Icon;
  label: string;
  path: string;
  /** When multiple tabs share `path`, set this so optimistic highlight targets one tab. */
  navKey?: string;
  match?: (pathname: string, search: string) => boolean;
  activeWeight?: IconWeight;
  inactiveWeight?: IconWeight;
  preload?: () => Promise<unknown>;
  /** Hidden from mobile bottom nav; shown in desktop sidebar only. */
  desktopOnly?: boolean;
}

interface BottomNavProps {
  items: BottomNavItem[];
}

function BottomNavLink({
  item,
  willNavigate,
  isActive,
  iconWeight,
  onNavigateIntent,
}: {
  item: BottomNavItem;
  willNavigate: boolean;
  isActive: boolean;
  iconWeight: IconWeight;
  onNavigateIntent: () => void;
}): React.JSX.Element {
  const IconCmp = item.icon;
  const hapticFromTouch = useRef(false);

  const runIntent = useCallback(() => {
    onNavigateIntent();
    item.preload?.();
    appHaptics.impactMedium();
  }, [item, onNavigateIntent]);

  return (
    <Link
      to={item.path}
      onTouchEnd={() => {
        if (!willNavigate) return;
        hapticFromTouch.current = true;
        runIntent();
        window.setTimeout(() => {
          hapticFromTouch.current = false;
        }, 400);
      }}
      onClick={() => {
        if (!willNavigate) return;
        if (hapticFromTouch.current) return;
        runIntent();
      }}
      onMouseEnter={() => {
        item.preload?.();
      }}
      onFocus={() => {
        item.preload?.();
      }}
      className={`
        flex min-h-[52px] min-w-0 flex-1 items-center justify-center rounded-[16px]
        px-2 py-1.5 no-underline transition-transform duration-150 ease-out active:scale-[0.985]
        ${isActive ? 'text-[var(--role-primary)]' : 'text-[var(--content-tertiary)]'}
      `}
      aria-current={isActive ? 'page' : undefined}
    >
      <span className="flex min-w-0 flex-col items-center justify-center gap-1">
        <IconCmp
          size={21}
          weight={iconWeight}
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
}

function navKeyFor(item: BottomNavItem): string {
  return item.navKey ?? `${item.path}::${item.label}`;
}

export function BottomNav({ items }: BottomNavProps): React.JSX.Element | null {
  const location = useLocation();
  const currentFull = location.pathname + location.search;
  const [optimisticNavKey, setOptimisticNavKey] = useState<string | null>(null);

  useEffect(() => {
    setOptimisticNavKey(null);
  }, [location.pathname, location.search]);

  return (
    <nav
      className="
        fixed bottom-0 left-0 right-0 z-50
        flex items-stretch border-t border-[var(--border-opaque)]
        bg-[color:color-mix(in_srgb,var(--bg-secondary)_94%,var(--bg-primary))]
        px-3 pt-1 shadow-[0_-1px_0_rgba(15,23,42,0.02)]
      "
      style={{
        minHeight: '64px',
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)',
      }}
    >
      {items.map((item) => {
        const matchesLocation = item.match
          ? item.match(location.pathname, location.search)
          : item.path.includes('?')
            ? currentFull === item.path
            : location.pathname === item.path;
        const nk = navKeyFor(item);
        const isActive = optimisticNavKey ? optimisticNavKey === nk : matchesLocation;
        const iconWeight = isActive ? (item.activeWeight ?? 'fill') : (item.inactiveWeight ?? 'regular');

        // Gate haptics on real navigation, not tab highlight. E.g. New Order tab stays active on
        // /sales/cart but Link still goes to /sales/new — we should buzz. onClick is used instead of
        // pointerdown for reliable iOS Safari feedback on <a href>.
        const willNavigate = item.path.includes('?')
          ? currentFull !== item.path
          : location.pathname !== item.path;

        return (
          <BottomNavLink
            key={`${item.path}::${item.label}`}
            item={item}
            willNavigate={willNavigate}
            isActive={isActive}
            iconWeight={iconWeight}
            onNavigateIntent={() => {
              setOptimisticNavKey(nk);
            }}
          />
        );
      })}
    </nav>
  );
}
