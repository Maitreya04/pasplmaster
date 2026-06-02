import { useEffect, useMemo, useState } from 'react';
import { Tray } from '@phosphor-icons/react';
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
import { DeskTooltip } from './DeskTooltip';
import { DESK_TAB_TOOLTIPS } from './deskStatusHelp';
import { filterDeskOrdersByPicker } from './deskPickerMatch';
import { deskType } from './deskTypography';

const TAB_STORAGE_KEY = 'billing-desk-tab-v2';

const PROGRESS_STATUSES = new Set<DeskOrderRow['deskStatus']>([
  'picking',
  'checking',
  'no_ack',
  'unassigned',
]);

function isDeskOrderTab(value: string | null): value is DeskOrderTab {
  return (
    value === 'resolve' ||
    value === 'assign' ||
    value === 'picking' ||
    value === 'review' ||
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

function defaultTabForCounts(resolveCount: number, assignCount: number): DeskOrderTab {
  if (resolveCount > 0) return 'resolve';
  if (assignCount > 0) return 'assign';
  return 'picking';
}

interface DeskOrdersPanelProps {
  allOrders: DeskOrderRow[];
  listOrders: DeskOrderRow[];
  resolveCount: number;
  assignCount: number;
  reviewCount: number;
  completedCount: number;
  isLoading: boolean;
  onSelectOrder: (order: DeskOrderRow, flaggedMode: boolean) => void;
}

export function DeskOrdersPanel({
  allOrders,
  listOrders,
  resolveCount,
  assignCount,
  reviewCount,
  completedCount,
  isLoading,
  onSelectOrder,
}: DeskOrdersPanelProps): React.JSX.Element {
  const [tab, setTab] = useState<DeskOrderTab>(() =>
    defaultTabForCounts(resolveCount, assignCount),
  );
  const [pickerFilterId, setPickerFilterId] = useState<number | null>(null);
  const [assignTarget, setAssignTarget] = useState<DeskOrderRow | null>(null);
  const { pickers, colors: pickerColors } = usePickerLoad();
  const [prevResolveCount, setPrevResolveCount] = useState(resolveCount);

  if (resolveCount !== prevResolveCount) {
    const wasZero = prevResolveCount === 0;
    setPrevResolveCount(resolveCount);
    if (wasZero && resolveCount > 0) {
      setTab('resolve');
    } else if (resolveCount === 0) {
      const stored = readStoredTab();
      if (stored && stored !== 'resolve') {
        setTab(stored);
      }
    }
  }

  useEffect(() => {
    if (tab === 'resolve' && resolveCount > 0) return;
    try {
      sessionStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      /* ignore */
    }
  }, [tab, resolveCount]);

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
    { id: 'resolve', label: 'Resolve', badge: resolveCount > 0 ? resolveCount : undefined },
    { id: 'assign', label: 'Assign', badge: assignCount > 0 ? assignCount : undefined },
    { id: 'picking', label: 'Picking' },
    { id: 'review', label: 'Review', badge: reviewCount > 0 ? reviewCount : undefined },
    {
      id: 'completed',
      label: 'Completed',
      badge: completedCount > 0 ? completedCount : undefined,
    },
  ];

  const emptyDescription = pickerFilter
    ? `${pickerFilter.firstName} has no orders in this view right now.`
    : tab === 'resolve'
      ? 'Post-pick flags and billing issues appear here.'
      : tab === 'assign'
        ? 'Approved orders waiting for a picker or a nudge show here.'
        : tab === 'picking'
          ? 'Active warehouse picks show here once assigned.'
          : tab === 'review'
            ? 'Finished picks move here for bill verification.'
            : 'Verified picks ready to dispatch show here.';

  const showStaleActions = tab === 'assign' || tab === 'picking';
  const showVerifyAction = tab === 'review' || tab === 'completed';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--bg-secondary)]">
      <header className="shrink-0 px-3.5 py-2.5 border-b border-[var(--border-faint)] bg-[var(--bg-secondary)]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className={deskType.panelTitle}>Orders</span>
            {resolveCount > 0 && tab !== 'resolve' && (
              <p className={`${deskType.panelSub} mt-0.5 text-[var(--content-warning-on-light)]`}>
                {resolveCount} flag{resolveCount === 1 ? '' : 's'} on Resolve tab
              </p>
            )}
          </div>
          <div className="flex items-center gap-0.5 shrink-0 p-0.5 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-faint)] overflow-x-auto max-w-[min(100%,22rem)]">
            {tabs.map((t) => {
              const active = tab === t.id;
              const badgeTone =
                t.id === 'resolve'
                  ? 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]'
                  : t.id === 'assign'
                    ? 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                    : t.id === 'review' || t.id === 'completed'
                      ? 'bg-[var(--bg-tertiary)] text-[var(--content-secondary)]'
                      : 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]';
              return (
                <DeskTooltip key={t.id} label={DESK_TAB_TOOLTIPS[t.id]} side="bottom">
                  <button
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`${deskType.tab} px-2 py-1 rounded-md transition-colors inline-flex items-center gap-1 shrink-0 ${
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
        pickers={pickers}
        pickerColors={pickerColors}
        allOrders={allOrders}
        selectedPickerId={pickerFilterId}
        onSelectPicker={setPickerFilterId}
      />

      <div className="flex-1 basis-0 min-h-0 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable] pb-12">
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
                    : tab === 'resolve'
                      ? 'Nothing to resolve'
                      : tab === 'completed'
                        ? 'No completed picks yet'
                        : 'No orders in this view'
                }
                description={emptyDescription}
              />
            </div>
          ) : tab === 'resolve' ? (
            filtered.map((order) => (
              <DeskFlagOrderCard
                key={order.id}
                order={order}
                onReview={(o) => onSelectOrder(o, true)}
              />
            ))
          ) : (
            filtered.map((order) => (
              <div key={order.id} className="flex flex-col gap-1.5">
                {tab === 'picking' && orderHasDeskPickerFlags(order) && (
                  <DeskFlagOrderCard
                    order={order}
                    onReview={(o) => onSelectOrder(o, true)}
                  />
                )}
                <DeskOrderRowCard
                  order={order}
                  pickers={pickers}
                  pickerColors={pickerColors}
                  pickProgress={pickProgressMap?.get(order.id)}
                  progressLoading={progressLoading}
                  isAssignExpanded={assignTarget?.id === order.id}
                  onAssignToggle={() => {
                    setAssignTarget((prev) => (prev?.id === order.id ? null : order));
                  }}
                  onAssignClose={() => setAssignTarget(null)}
                  showStaleActions={showStaleActions}
                  showVerifyAction={showVerifyAction}
                  onEdit={() =>
                    onSelectOrder(order, orderHasDeskPickerFlags(order))
                  }
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
