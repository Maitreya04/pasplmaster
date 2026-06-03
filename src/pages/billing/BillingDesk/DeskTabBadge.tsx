import type { DeskOrderTab } from '../../../hooks/useBillingDeskOrders';

const TONE_CLASS: Record<DeskOrderTab, string> = {
  assign: 'desk-tab-badge--accent',
  picking: 'desk-tab-badge--role',
  resolve: 'desk-tab-badge--warning',
  completed: 'desk-tab-badge--positive',
};

interface DeskTabBadgeProps {
  count: number;
  tab: DeskOrderTab;
}

export function DeskTabBadge({ count, tab }: DeskTabBadgeProps): React.JSX.Element {
  const display = count > 99 ? '99+' : String(count);
  return (
    <span className={`desk-tab-badge ${TONE_CLASS[tab]}`} aria-hidden>
      {display}
    </span>
  );
}
