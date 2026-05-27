import { useMemo, useState } from 'react';
import { Tray } from '@phosphor-icons/react';
import { EmptyState, Skeleton } from '../../../components/shared';
import { useAutoPickReminders } from '../../../hooks/useAutoPickReminders';
import { useDeskPickProgress } from '../../../hooks/useDeskPickProgress';
import { usePickerLoad } from '../../../hooks/usePickerLoad';
import {
  filterDeskOrdersByTab,
  orderNeedsDeskFlagAction,
  type DeskOrderRow,
  type DeskOrderTab,
} from '../../../hooks/useBillingDeskOrders';
import { DeskFlagsStrip } from './DeskFlagsStrip';
import { DeskOrderRowCard } from './DeskOrderRow';
import { DeskPickerToolbar } from './DeskPickerToolbar';
import { DeskTooltip } from './DeskTooltip';
import { DESK_TAB_TOOLTIPS } from './deskStatusHelp';
import { filterDeskOrdersByPicker } from './deskPickerMatch';
import { deskType } from './deskTypography';

interface DeskOrdersPanelProps {
  allOrders: DeskOrderRow[];
  listOrders: DeskOrderRow[];
  flaggedOrders: DeskOrderRow[];
  staleCount: number;
  completedCount: number;
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
  allOrders,
  listOrders,
  flaggedOrders,
  staleCount,
  completedCount,
  isLoading,
  onSelectOrder,
}: DeskOrdersPanelProps): React.JSX.Element {
  const [tab, setTab] = useState<DeskOrderTab>('picking');
  const [pickerFilterId, setPickerFilterId] = useState<number | null>(null);
  const [assignTarget, setAssignTarget] = useState<DeskOrderRow | null>(null);
  const { pickers, colors: pickerColors } = usePickerLoad();

  const pickerFilter = useMemo(
    () => pickers.find((p) => p.userId === pickerFilterId) ?? null,
    [pickerFilterId, pickers],
  );

  const filtered = useMemo(() => {
    const byTab = filterDeskOrdersByTab(listOrders, tab);
    return filterDeskOrdersByPicker(byTab, pickerFilter);
  }, [listOrders, tab, pickerFilter]);

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
    { id: 'picking', label: 'Picking' },
    { id: 'stale', label: 'Stale', badge: staleCount > 0 ? staleCount : undefined },
    { id: 'completed', label: 'Completed', badge: completedCount > 0 ? completedCount : undefined },
    { id: 'all', label: 'All' },
  ];

  const emptyDescription = pickerFilter
    ? `${pickerFilter.firstName} has no orders in this view right now.`
    : tab === 'stale'
      ? 'Re-assign, notify, or complete picks that are stuck.'
      : tab === 'picking'
      ? 'Approved orders waiting for a picker or an in-progress pick show here.'
      : tab === 'completed'
        ? 'Finished picks move here once the picker completes every line.'
        : 'Billed orders appear here once they leave the live queue.';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-secondary)]">
      <header className="shrink-0 px-3.5 py-2.5 border-b border-[var(--border-faint)] bg-[var(--bg-secondary)]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className={deskType.panelTitle}>Orders</span>
            {flaggedOrders.length > 0 && (
              <p className={`${deskType.panelSub} mt-0.5 text-[var(--content-warning-on-light)]`}>
                {flaggedOrders.length} flag{flaggedOrders.length === 1 ? '' : 's'} need action
              </p>
            )}
          </div>
          <div className="flex items-center gap-0.5 shrink-0 p-0.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-faint)]">
            {tabs.map((t) => {
              const active = tab === t.id;
              const badgeTone =
                t.id === 'stale'
                  ? 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]'
                  : t.id === 'completed'
                    ? 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)]'
                    : 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]';
              return (
                <DeskTooltip key={t.id} label={DESK_TAB_TOOLTIPS[t.id]} side="bottom">
                  <button
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`${deskType.tab} px-2 py-1 rounded-md transition-colors inline-flex items-center gap-1 ${
                      active
                        ? 'bg-[var(--bg-secondary)] text-[var(--content-primary)] font-semibold shadow-sm'
                        : 'text-[var(--content-quaternary)] hover:text-[var(--content-secondary)]'
                    }`}
                  >
                    {t.label}
                    {t.badge != null && t.badge > 0 && (
                      <span className={`${deskType.tabBadge} px-1.5 py-0.5 rounded ${badgeTone}`}>
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

      <DeskPickerToolbar
        compact={flaggedOrders.length > 0}
        pickers={pickers}
        pickerColors={pickerColors}
        allOrders={allOrders}
        selectedPickerId={pickerFilterId}
        onSelectPicker={setPickerFilterId}
      />

      <div className="flex-1 basis-0 min-h-0 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable] pb-12">
        <DeskFlagsStrip
          orders={flaggedOrders}
          onReview={(order) => onSelectOrder(order, true)}
        />

        <div className="px-3.5 py-2.5 flex flex-col gap-1.5">
          {isLoading ? (
            <Skeleton variant="card" count={4} />
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[10rem] items-center justify-center">
              <EmptyState
                icon={Tray}
                title={
                  pickerFilter
                    ? `No orders for ${pickerFilter.firstName}`
                    : tab === 'completed'
                      ? 'No completed picks yet'
                      : 'No orders in this view'
                }
                description={emptyDescription}
              />
            </div>
          ) : (
            filtered.map((order) => (
              <DeskOrderRowCard
                key={order.id}
                order={order}
                pickers={pickers}
                pickerColors={pickerColors}
                pickProgress={pickProgressMap?.get(order.id)}
                progressLoading={progressLoading}
                isAssignExpanded={assignTarget?.id === order.id}
                onAssignToggle={() => {
                  setAssignTarget((prev) => (prev?.id === order.id ? null : order));
                }}
                showStaleActions={tab === 'stale'}
                showVerifyAction={tab === 'completed' || order.deskStatus === 'checking'}
                onEdit={() =>
                  onSelectOrder(order, orderNeedsDeskFlagAction(order))
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
