import { useMemo, useState } from 'react';
import { Tray } from '@phosphor-icons/react';
import { EmptyState, Skeleton } from '../../../components/shared';
import { useAutoPickReminders } from '../../../hooks/useAutoPickReminders';
import { useDeskPickProgress } from '../../../hooks/useDeskPickProgress';
import { usePickerLoad } from '../../../hooks/usePickerLoad';
import {
  filterDeskOrdersByTab,
  type DeskOrderRow,
  type DeskOrderTab,
} from '../../../hooks/useBillingDeskOrders';
import { DeskFlagsSeparatorNote, DeskFlagsStrip } from './DeskFlagsStrip';
import { DeskOrderRowCard } from './DeskOrderRow';
import { DeskTooltip } from './DeskTooltip';
import { DESK_TAB_TOOLTIPS } from './deskStatusHelp';

interface DeskOrdersPanelProps {
  listOrders: DeskOrderRow[];
  flaggedOrders: DeskOrderRow[];
  staleCount: number;
  isLoading: boolean;
  onSelectOrder: (order: DeskOrderRow, flaggedMode: boolean) => void;
}

const PROGRESS_STATUSES = new Set<DeskOrderRow['deskStatus']>([
  'picking',
  'checking',
  'no_ack',
  'unassigned',
]);

export function DeskOrdersPanel({
  listOrders,
  flaggedOrders,
  staleCount,
  isLoading,
  onSelectOrder,
}: DeskOrdersPanelProps): React.JSX.Element {
  const [tab, setTab] = useState<DeskOrderTab>('all');
  const { pickers, colors: pickerColors } = usePickerLoad();

  const filtered = useMemo(
    () => filterDeskOrdersByTab(listOrders, tab),
    [listOrders, tab],
  );

  const progressOrderIds = useMemo(
    () =>
      filtered
        .filter((o) => PROGRESS_STATUSES.has(o.deskStatus))
        .map((o) => o.id),
    [filtered],
  );

  const { data: pickProgressMap, isLoading: progressLoading } =
    useDeskPickProgress(progressOrderIds);

  const pickingOrders = useMemo(
    () => listOrders.filter((o) => o.workflow_status === 'picking'),
    [listOrders],
  );

  useAutoPickReminders(pickingOrders, pickProgressMap, pickers);

  const tabs: { id: DeskOrderTab; label: string; badge?: number }[] = [
    { id: 'all', label: 'All' },
    { id: 'picking', label: 'Picking' },
    { id: 'stale', label: 'Stale', badge: staleCount > 0 ? staleCount : undefined },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--bg-secondary)]">
      <header className="shrink-0 px-3 py-2.5 border-b border-[var(--border-faint)]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="text-[13px] font-medium text-[var(--content-primary)]">Orders</span>
            <p className="text-[10px] text-[var(--content-quaternary)] mt-0.5 truncate">
              Monitor picks · assign · edit bills
            </p>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <DeskTooltip key={t.id} label={DESK_TAB_TOOLTIPS[t.id]} side="bottom">
                  <button
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`text-[11px] px-2 py-1 rounded-full transition-colors inline-flex items-center gap-1 ${
                      active
                        ? 'bg-[var(--bg-tertiary)] text-[var(--content-primary)] font-medium'
                        : 'text-[var(--content-quaternary)] hover:text-[var(--content-secondary)]'
                    }`}
                  >
                    {t.label}
                    {t.badge != null && t.badge > 0 && (
                      <span className="text-[9px] font-semibold px-1 rounded-full bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]">
                        {t.badge}
                      </span>
                    )}
                  </button>
                </DeskTooltip>
              );
            })}
          </div>
        </div>
      </header>

      <DeskFlagsStrip
        orders={flaggedOrders}
        onSelect={(order) => onSelectOrder(order, true)}
      />

      <DeskFlagsSeparatorNote count={flaggedOrders.length} />

      <div className="flex-1 min-h-0 overflow-y-auto px-3.5 py-2.5 flex flex-col gap-1.5">
        {isLoading ? (
          <Skeleton variant="card" count={4} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Tray}
            title="No orders in this view"
            description="Billed orders appear here once they leave the live queue."
          />
        ) : (
          filtered.map((order) => (
            <DeskOrderRowCard
              key={order.id}
              order={order}
              pickers={pickers}
              pickerColors={pickerColors}
              pickProgress={pickProgressMap?.get(order.id)}
              progressLoading={progressLoading}
              onEdit={() => onSelectOrder(order, false)}
            />
          ))
        )}
      </div>
    </div>
  );
}
