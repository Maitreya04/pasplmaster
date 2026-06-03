import { useEffect, useMemo, useState } from 'react';
import { Tray, X } from '@phosphor-icons/react';
import { EmptyState, Skeleton } from '../../../components/shared';
import { useAutoPickReminders } from '../../../hooks/useAutoPickReminders';
import { useDeskPickProgress } from '../../../hooks/useDeskPickProgress';
import { usePickerLoad } from '../../../hooks/usePickerLoad';
import {
  filterDeskOrdersByTab,
  orderHasDeskPickerFlags,
  type DeskOrderRow,
  type DeskOrderTab,
} from '../../../hooks/useBillingDeskOrders';
import { DeskFlagOrderCard } from './DeskFlagOrderCard';
import { DeskOrderRowCard } from './DeskOrderRow';
import { DeskPickerToolbar } from './DeskPickerToolbar';
import { DeskTabBadge } from './DeskTabBadge';
import { DeskTooltip } from './DeskTooltip';
import { DESK_TAB_TOOLTIPS } from './deskStatusHelp';
import { filterDeskOrdersByPicker } from './deskPickerMatch';
import { deskType } from './deskTypography';

const TAB_STORAGE_KEY = 'billing-desk-tab-v3';

const TAB_LABELS: Record<DeskOrderTab, { label: string; compact: string }> = {
  assign: { label: 'Assign', compact: 'Assign' },
  picking: { label: 'Picking', compact: 'Picking' },
  resolve: { label: 'Resolve', compact: 'Resolve' },
  completed: { label: 'Done', compact: 'Done' },
};

const PROGRESS_STATUSES = new Set<DeskOrderRow['deskStatus']>([
  'picking',
  'checking',
  'no_ack',
  'unassigned',
]);

function isDeskOrderTab(value: string | null): value is DeskOrderTab {
  return (
    value === 'assign' ||
    value === 'picking' ||
    value === 'resolve' ||
    value === 'completed'
  );
}

function readStoredTab(): DeskOrderTab | null {
  try {
    const raw = sessionStorage.getItem(TAB_STORAGE_KEY);
    return isDeskOrderTab(raw) ? raw : null;
  } catch {
    return null;
  }
}

function defaultTabForCounts(
  assignCount: number,
  pickingCount: number,
  resolveCount: number,
): DeskOrderTab {
  if (assignCount > 0) return 'assign';
  if (pickingCount > 0) return 'picking';
  if (resolveCount > 0) return 'resolve';
  return 'completed';
}

function countForTab(
  tab: DeskOrderTab,
  counts: {
    assignCount: number;
    pickingCount: number;
    resolveCount: number;
    completedCount: number;
  },
): number {
  if (tab === 'assign') return counts.assignCount;
  if (tab === 'picking') return counts.pickingCount;
  if (tab === 'resolve') return counts.resolveCount;
  return counts.completedCount;
}

interface DeskOrdersPanelProps {
  allOrders: DeskOrderRow[];
  listOrders: DeskOrderRow[];
  resolveCount: number;
  assignCount: number;
  pickingCount: number;
  completedCount: number;
  isLoading: boolean;
  selectedOrderId?: number | null;
  onSelectOrder: (order: DeskOrderRow, flaggedMode: boolean) => void;
}

export function DeskOrdersPanel({
  allOrders,
  listOrders,
  resolveCount,
  assignCount,
  pickingCount,
  completedCount,
  isLoading,
  selectedOrderId = null,
  onSelectOrder,
}: DeskOrdersPanelProps): React.JSX.Element {
  const [tab, setTab] = useState<DeskOrderTab>(() =>
    readStoredTab() ?? defaultTabForCounts(assignCount, pickingCount, resolveCount),
  );
  const [pickerFilterId, setPickerFilterId] = useState<number | null>(null);
  const [assignTarget, setAssignTarget] = useState<DeskOrderRow | null>(null);
  const { pickers, colors: pickerColors } = usePickerLoad();

  useEffect(() => {
    if (isLoading) return;
    const counts = { assignCount, pickingCount, resolveCount, completedCount };
    if (countForTab(tab, counts) > 0) return;
    const next = defaultTabForCounts(assignCount, pickingCount, resolveCount);
    if (next !== tab && countForTab(next, counts) > 0) {
      setTab(next);
    }
  }, [assignCount, completedCount, isLoading, pickingCount, resolveCount, tab]);

  useEffect(() => {
    try {
      sessionStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      /* ignore */
    }
  }, [tab]);

  const pickerFilter = useMemo(
    () => pickers.find((p) => p.userId === pickerFilterId) ?? null,
    [pickerFilterId, pickers],
  );

  const filtered = useMemo(() => {
    const byTab = filterDeskOrdersByTab(listOrders, tab);
    const byPicker = filterDeskOrdersByPicker(byTab, pickerFilter);
    if (tab !== 'completed') return byPicker;
    return [...byPicker].sort(
      (a, b) =>
        new Date(b.completed_at ?? b.picking_completed_at ?? b.created_at).getTime() -
        new Date(a.completed_at ?? a.picking_completed_at ?? a.created_at).getTime(),
    );
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

  const tabs: { id: DeskOrderTab; label: string; compactLabel: string; badge?: number }[] = [
    {
      id: 'assign',
      label: TAB_LABELS.assign.label,
      compactLabel: TAB_LABELS.assign.compact,
      badge: assignCount > 0 ? assignCount : undefined,
    },
    {
      id: 'picking',
      label: TAB_LABELS.picking.label,
      compactLabel: TAB_LABELS.picking.compact,
      badge: pickingCount > 0 ? pickingCount : undefined,
    },
    {
      id: 'resolve',
      label: TAB_LABELS.resolve.label,
      compactLabel: TAB_LABELS.resolve.compact,
      badge: resolveCount > 0 ? resolveCount : undefined,
    },
    {
      id: 'completed',
      label: TAB_LABELS.completed.label,
      compactLabel: TAB_LABELS.completed.compact,
      badge: completedCount > 0 ? completedCount : undefined,
    },
  ];
  const tabTotalCount = countForTab(tab, {
    assignCount,
    pickingCount,
    resolveCount,
    completedCount,
  });
  const hiddenByPickerFilter = pickerFilter ? Math.max(0, tabTotalCount - filtered.length) : 0;

  const emptyDescription = pickerFilter
    ? hiddenByPickerFilter > 0
      ? `Clear the picker filter to see ${hiddenByPickerFilter} order${hiddenByPickerFilter === 1 ? '' : 's'} in this stage.`
      : `${pickerFilter.firstName} has no orders in this view right now.`
    : tab === 'assign'
      ? 'Approved orders waiting for picker assignment appear here.'
      : tab === 'picking'
        ? 'Assigned orders and live warehouse pick progress appear here.'
        : tab === 'resolve'
          ? 'Finished picks that need billing verification appear here.'
          : 'Finalised bills from today appear here.';

  const emptyTitle = pickerFilter
    ? hiddenByPickerFilter > 0
      ? `${hiddenByPickerFilter} hidden by picker filter`
      : `No orders for ${pickerFilter.firstName}`
    : tab === 'assign'
      ? 'No orders waiting for a picker'
      : tab === 'picking'
        ? 'No active picks'
        : tab === 'resolve'
          ? 'No picks ready to resolve'
          : 'No orders completed today';

  const showStaleActions = tab === 'picking';
  const showVerifyAction = tab === 'resolve';
  const showResolveAlert = resolveCount > 0 && tab !== 'resolve';

  const resetPickerFilter = () => setPickerFilterId(null);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-secondary)]">
      <header className="shrink-0 px-3.5 py-2.5 border-b border-[var(--border-faint)] bg-[var(--bg-secondary)]">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <span className={`${deskType.panelTitle} shrink-0`}>Orders</span>
          {showResolveAlert ? (
            <button
              type="button"
              onClick={() => setTab('resolve')}
              className={`${deskType.panelSub} shrink-0 text-[var(--content-warning-on-light)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--role-primary)] rounded-sm`}
            >
              {resolveCount} to resolve →
            </button>
          ) : null}
        </div>

        <div
          className="mt-2.5 flex w-full min-w-0 gap-0.5 overflow-x-auto overscroll-x-contain rounded-lg border border-[var(--border-faint)] bg-[var(--bg-primary)] p-0.5 [scrollbar-width:none]"
          role="tablist"
          aria-label="Order stages"
        >
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <DeskTooltip
                key={t.id}
                label={DESK_TAB_TOOLTIPS[t.id]}
                side="bottom"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className={`${deskType.tab} desk-tab shrink-0 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--role-primary)] ${
                    active
                      ? 'desk-tab--active bg-[var(--bg-secondary)] text-[var(--content-primary)] font-semibold shadow-sm'
                      : 'text-[var(--content-quaternary)] hover:text-[var(--content-secondary)]'
                  }`}
                >
                  <span>{t.label}</span>
                  {t.badge != null && t.badge > 0 ? (
                    <DeskTabBadge count={t.badge} tab={t.id} />
                  ) : null}
                </button>
              </DeskTooltip>
            );
          })}
        </div>
      </header>

      <DeskPickerToolbar
        pickers={pickers}
        pickerColors={pickerColors}
        allOrders={allOrders}
        selectedPickerId={pickerFilterId}
        onSelectPicker={setPickerFilterId}
      />

      {pickerFilter && (
        <div className="shrink-0 flex items-center justify-between gap-2 px-3.5 py-2 border-b border-[var(--border-faint)] bg-[var(--bg-primary)]">
          <p className={`${deskType.panelSub} truncate text-[var(--content-secondary)]`}>
            Showing {pickerFilter.firstName}
          </p>
          <button
            type="button"
            onClick={resetPickerFilter}
            className={`${deskType.btn} inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-2 py-1 text-[var(--content-secondary)] hover:border-[var(--border-opaque)] hover:text-[var(--content-primary)]`}
          >
            <X size={13} weight="bold" />
            Clear
          </button>
        </div>
      )}

      <div className="flex-1 basis-0 min-h-0 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable] pb-20">
        <div className="px-3.5 py-2.5 flex flex-col gap-1.5">
          {isLoading ? (
            <Skeleton variant="card" count={4} />
          ) : filtered.length === 0 ? (
            <div className="flex min-h-[10rem] items-center justify-center">
              <EmptyState
                icon={Tray}
                title={emptyTitle}
                description={emptyDescription}
              />
            </div>
          ) : (
            filtered.map((order) => {
              const showFlagCard =
                (tab === 'picking' || tab === 'resolve') && orderHasDeskPickerFlags(order);
              return (
                <div key={order.id} className="flex flex-col gap-1.5">
                  {showFlagCard ? (
                    <DeskFlagOrderCard
                      order={order}
                      isSelected={selectedOrderId === order.id}
                      pickProgress={pickProgressMap?.get(order.id)}
                      progressLoading={progressLoading}
                      showPickProgress={tab === 'picking'}
                      onReview={(o) => onSelectOrder(o, true)}
                    />
                  ) : (
                    <DeskOrderRowCard
                      order={order}
                      pickers={pickers}
                      pickerColors={pickerColors}
                      pickProgress={pickProgressMap?.get(order.id)}
                      progressLoading={progressLoading}
                      isSelected={selectedOrderId === order.id}
                      isAssignExpanded={assignTarget?.id === order.id}
                      onAssignToggle={() => {
                        setAssignTarget((prev) => (prev?.id === order.id ? null : order));
                      }}
                      onAssignClose={() => setAssignTarget(null)}
                      showStaleActions={showStaleActions}
                      showVerifyAction={showVerifyAction}
                      showCompletedFreshness={tab === 'completed'}
                      onEdit={() =>
                        onSelectOrder(order, orderHasDeskPickerFlags(order))
                      }
                    />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
