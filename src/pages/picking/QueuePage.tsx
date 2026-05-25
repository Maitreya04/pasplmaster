import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Package,
  ArrowRight,
  Bell,
  GearSix,
  Barcode,
  UsersThree,
} from '@phosphor-icons/react';
import { useClaimableOrders } from '../../hooks/useClaimableOrders';
import { usePickerPushNotifications } from '../../hooks/usePickerPushNotifications';
import { usePickerDailyStats } from '../../hooks/usePickerDailyStats';
import { NotificationBell } from '../../components/notifications/NotificationBell';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  PageHeader,
  Card,
  EmptyState,
  Skeleton,
  QueueSectionHeader,
  InitialsAvatar,
} from '../../components/shared';
import { AvailableOrderRow } from '../../components/picking/AvailableOrderRow';
import { AssignedOrderRow } from '../../components/picking/AssignedOrderRow';
import {
  ActivePickRow,
  useActivePickBoardOrders,
} from '../../components/picking/ActivePickRow';
import { IncompletePickBanner } from '../../components/picking/IncompletePickBanner';
import { PickerDailyStatsStrip } from '../../components/picking/PickerDailyStatsStrip';
import { sortAvailablePickQueueOrders } from '../../lib/pickQueueTransport';
import {
  isInProgressPick,
  isMyAssignedPending,
  isMyAssignedWorkCleared,
} from '../../lib/picking/pickLifecycle';

function hasPickableLines(order: { pick_line_count?: number; item_count: number }): boolean {
  if (order.pick_line_count != null) return order.pick_line_count > 0;
  return order.item_count > 0;
}

const TEAM_PICKS_PREVIEW = 4;

export default function QueuePage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const { role, userId, userName } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const focusOrderIdParam = searchParams.get('focusOrderId');
  const focusOrderId = focusOrderIdParam ? Number.parseInt(focusOrderIdParam, 10) : null;
  const claimOrderIdParam = searchParams.get('claimOrderId');
  const legacyClaimOrderId = claimOrderIdParam ? Number.parseInt(claimOrderIdParam, 10) : null;

  // Old push notifications used ?claimOrderId= — send to preview instead of auto-claiming.
  useEffect(() => {
    if (!claimOrderIdParam) return;
    if (!Number.isInteger(legacyClaimOrderId) || (legacyClaimOrderId ?? 0) <= 0) {
      navigate('/picking', { replace: true });
      return;
    }
    navigate(`/picking/preview/${legacyClaimOrderId}?source=pool`, { replace: true });
  }, [claimOrderIdParam, legacyClaimOrderId, navigate]);

  const {
    available,
    myActive,
    otherActive,
    stale,
    isLoading,
  } = useClaimableOrders({
    stage: 'picking',
    workflowStatus: ['approved', 'picking'],
  });

  const dailyStats = usePickerDailyStats();
  const pushAlerts = usePickerPushNotifications({ role, userId, userName });

  const inProgressPicks = useMemo(
    () => myActive.filter(isInProgressPick),
    [myActive],
  );

  const myOrders = useMemo(
    () =>
      [...myActive]
        .filter(hasPickableLines)
        .sort((a, b) => {
          const aStarted = isInProgressPick(a) ? 0 : 1;
          const bStarted = isInProgressPick(b) ? 0 : 1;
          if (aStarted !== bStarted) return aStarted - bStarted;
          const aStale = a.claim_info?.is_stale ? 1 : 0;
          const bStale = b.claim_info?.is_stale ? 1 : 0;
          if (aStale !== bStale) return aStale - bStale;
          return (
            new Date(b.approved_at ?? b.created_at).getTime() -
            new Date(a.approved_at ?? a.created_at).getTime()
          );
        }),
    [myActive],
  );

  const assignedPending = useMemo(
    () => myOrders.filter((order) => isMyAssignedPending(order, userName)),
    [myOrders, userName],
  );

  const assignedWorkCleared = useMemo(
    () => isMyAssignedWorkCleared(myActive, userName),
    [myActive, userName],
  );

  const resumePick = useMemo(() => {
    if (inProgressPicks.length === 0) return null;
    if (focusOrderId != null && Number.isInteger(focusOrderId)) {
      const focused = inProgressPicks.find((order) => order.id === focusOrderId);
      if (focused) return focused;
    }
    return [...inProgressPicks].sort((a, b) => {
      const aTime = new Date(a.claim_info?.claimed_at ?? a.approved_at ?? a.created_at).getTime();
      const bTime = new Date(b.claim_info?.claimed_at ?? b.approved_at ?? b.created_at).getTime();
      return bTime - aTime;
    })[0];
  }, [focusOrderId, inProgressPicks]);

  const unassignedOrders = useMemo(
    () => sortAvailablePickQueueOrders(available.filter(hasPickableLines)),
    [available],
  );

  const stalePoolOrders = useMemo(
    () => sortAvailablePickQueueOrders(stale.filter(hasPickableLines)),
    [stale],
  );

  const teamPicks = useActivePickBoardOrders(myActive, otherActive);
  const teamPicksOthers = useMemo(
    () => teamPicks.filter((order) => !order.is_mine),
    [teamPicks],
  );

  const openPreview = (orderId: number, source: 'assigned' | 'pool') => {
    navigate(`/picking/preview/${orderId}?source=${source}`);
  };

  const openMyOrder = (order: (typeof myOrders)[0]) => {
    if (isInProgressPick(order)) {
      navigate(`/picking/pick/${order.id}`);
      return;
    }
    openPreview(order.id, 'assigned');
  };

  const handleEnableAlerts = async () => {
    const result = await pushAlerts.enable();
    if (result.ok) {
      toast.success('Picker alerts enabled on this device');
    } else {
      toast.error(result.error || 'Failed to enable picker alerts.');
    }
  };

  const handleDisableAlerts = async () => {
    const result = await pushAlerts.disable();
    if (result.ok) {
      setSettingsOpen(false);
      toast.info('Picker alerts turned off on this device');
    } else {
      toast.error(result.error || 'Failed to disable picker alerts.');
    }
  };

  const poolVisible = assignedWorkCleared;
  const poolHasOrders = unassignedOrders.length > 0 || stalePoolOrders.length > 0;

  const queueIsEmpty =
    !isLoading &&
    myOrders.length === 0 &&
    !resumePick &&
    teamPicks.length === 0 &&
    (!poolVisible || !poolHasOrders);

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Picking queue"
        action={
          <div className="flex items-center gap-1">
            <InitialsAvatar name={userName} size="sm" className="mr-0.5" />
            <NotificationBell userId={userId} role={role} />
            <div className="relative">
              <button
                type="button"
                onClick={() => setSettingsOpen((open) => !open)}
                className="min-h-10 min-w-10 flex items-center justify-center rounded-full text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors duration-150"
                aria-label="Open queue settings"
                aria-expanded={settingsOpen}
              >
                <GearSix size={20} weight="bold" />
              </button>
              {settingsOpen && (
                <div className="absolute right-0 top-full mt-2 w-44 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] shadow-lg p-2">
                  {pushAlerts.enabled ? (
                    <button
                      type="button"
                      onClick={handleDisableAlerts}
                      disabled={pushAlerts.loading}
                      className="w-full min-h-11 px-3 rounded-xl text-left text-sm font-medium text-[var(--content-primary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                    >
                      {pushAlerts.loading ? 'Updating…' : 'Disable alerts'}
                    </button>
                  ) : (
                    <p className="px-3 py-2 text-xs text-[var(--content-tertiary)]">
                      No queue settings yet
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        }
      />

      <PickerDailyStatsStrip stats={dailyStats.data} isLoading={dailyStats.isLoading} />

      {resumePick && (
        <IncompletePickBanner
          order={resumePick}
          onOpen={() => navigate(`/picking/pick/${resumePick.id}`)}
        />
      )}

      <div className="space-y-4 p-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton variant="card" count={3} />
          </div>
        ) : (
          <>
            <section>
              <QueueSectionHeader
                label="Your assignments"
                count={myOrders.length}
                showWhenEmpty
                description={
                  myOrders.length === 0
                    ? 'Billing-assigned orders appear here — including stale picks until you finish or billing reassigns'
                    : assignedPending.length > 0 && inProgressPicks.length > 0
                      ? `${assignedPending.length} waiting to start · ${inProgressPicks.length} in progress`
                      : assignedPending.length > 0
                        ? 'Review the list, then tap Start when ready'
                        : inProgressPicks.some((o) => o.claim_info?.is_stale)
                          ? 'Stale picks stay here — tap to resume or ask billing'
                          : 'Continue your active picks'
                }
              />
              {myOrders.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--content-secondary)]">
                  No orders assigned to you right now.
                </p>
              ) : (
                <div className="space-y-2">
                  {myOrders.map((order) =>
                    isInProgressPick(order) ? (
                      <ActivePickRow
                        key={order.id}
                        order={order}
                        isMine
                        onOpen={() => openMyOrder(order)}
                      />
                    ) : (
                      <AssignedOrderRow
                        key={order.id}
                        order={order}
                        onOpen={() => openMyOrder(order)}
                      />
                    ),
                  )}
                </div>
              )}
            </section>

            <section>
              <div className="flex items-start justify-between gap-3">
                <QueueSectionHeader
                  label="Active picks — team"
                  count={teamPicks.length}
                  showWhenEmpty
                  description="Who is picking which order right now"
                  className="flex-1 min-w-0"
                />
                {teamPicks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => navigate('/picking/active')}
                    className="shrink-0 mt-1 min-h-9 rounded-xl px-3 text-xs font-semibold text-[var(--content-accent)] hover:bg-[var(--bg-accent-subtle)]"
                  >
                    View all
                  </button>
                )}
              </div>

              {teamPicks.length === 0 ? (
                <p className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--content-secondary)]">
                  No one is picking an order yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {teamPicks.slice(0, TEAM_PICKS_PREVIEW).map((order) => (
                    <ActivePickRow
                      key={order.id}
                      order={order}
                      isMine={order.is_mine}
                      onOpen={
                        order.is_mine && (isInProgressPick(order) || isMyAssignedPending(order, userName))
                          ? () => openMyOrder(order)
                          : undefined
                      }
                    />
                  ))}
                  {teamPicks.length > TEAM_PICKS_PREVIEW && (
                    <button
                      type="button"
                      onClick={() => navigate('/picking/active')}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] py-3 text-sm font-semibold text-[var(--content-accent)]"
                    >
                      <UsersThree size={18} weight="duotone" />
                      {teamPicks.length - TEAM_PICKS_PREVIEW} more on Active tab
                    </button>
                  )}
                  {teamPicksOthers.length > 0 && teamPicks.length <= TEAM_PICKS_PREVIEW && (
                    <p className="text-xs text-[var(--content-tertiary)] px-1">
                      {teamPicksOthers.length} order
                      {teamPicksOthers.length === 1 ? '' : 's'} picked by teammates — read-only here.
                    </p>
                  )}
                </div>
              )}
            </section>

            {poolVisible ? (
              <section>
                <QueueSectionHeader
                  label="Unassigned pool"
                  count={unassignedOrders.length + stalePoolOrders.length}
                  description="Claim only when billing has not assigned anyone"
                />

                {!poolHasOrders ? (
                  queueIsEmpty ? (
                    <EmptyState
                      icon={Package}
                      title="All clear"
                      description="No assigned work and nothing waiting in the pool"
                    />
                  ) : (
                    <p className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--content-secondary)]">
                      Pool is empty — new approved orders will show up here.
                    </p>
                  )
                ) : (
                  <div className="space-y-2">
                    {unassignedOrders.map((order) => (
                      <AvailableOrderRow
                        key={order.id}
                        order={order}
                        onOpen={() => openPreview(order.id, 'pool')}
                        disabled={inProgressPicks.length > 0}
                      />
                    ))}
                    {stalePoolOrders.length > 0 && (
                      <>
                        <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-[var(--content-tertiary)]">
                          Abandoned picks (stale)
                        </p>
                        {stalePoolOrders.map((order) => (
                          <AvailableOrderRow
                            key={order.id}
                            order={order}
                            onOpen={() => openPreview(order.id, 'pool')}
                            disabled={inProgressPicks.length > 0}
                          />
                        ))}
                      </>
                    )}
                  </div>
                )}
              </section>
            ) : (
              <section>
                <QueueSectionHeader
                  label="Unassigned pool"
                  count={unassignedOrders.length + stalePoolOrders.length}
                  showWhenEmpty
                  className="opacity-70"
                />
                <p className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--content-secondary)]">
                  {resumePick
                    ? 'Finish your open pick in Your assignments before claiming from the pool.'
                    : myOrders.length > 0
                      ? `Finish your ${myOrders.length} assigned order${myOrders.length === 1 ? '' : 's'} first — then ${unassignedOrders.length + stalePoolOrders.length} unassigned will appear here.`
                      : 'Start or complete your assigned orders first.'}
                </p>
              </section>
            )}
          </>
        )}

        <button
          type="button"
          onClick={() => navigate('/picking/barcode-mapping')}
          className="flex w-full items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 text-left transition-colors hover:bg-[var(--bg-tertiary)] active:scale-[0.99]"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-accent-subtle)]">
            <Barcode size={22} weight="duotone" className="text-[var(--content-accent)]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-[var(--content-primary)]">Map manufacturer barcodes</p>
            <p className="mt-0.5 text-sm text-[var(--content-secondary)]">
              Link bin QR and part barcodes to Busy SKUs — also in the bottom bar as Map SKU.
            </p>
          </div>
          <ArrowRight size={20} weight="bold" className="shrink-0 text-[var(--content-tertiary)]" />
        </button>

        {!pushAlerts.enabled && (
          <Card className="border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  <Bell size={18} weight="fill" className="text-[var(--content-warning)]" />
                  <p className="font-semibold text-[var(--content-primary)]">Picker alerts</p>
                </div>
                <p className="text-sm text-[var(--content-secondary)]">
                  {pushAlerts.supported
                    ? !pushAlerts.standalone
                      ? 'Open the installed Home Screen app to enable picker alerts on iPhone or iPad.'
                      : pushAlerts.permission === 'denied'
                        ? 'Browser notifications are blocked on this device. Re-enable them in browser settings to receive picker alerts.'
                        : 'Turn on alerts on this device to receive new ready-to-pick orders.'
                    : 'This browser does not support push notifications. Queue updates will still appear live in the app.'}
                </p>
                {pushAlerts.error && (
                  <p className="mt-2 text-xs text-[var(--content-negative)]">{pushAlerts.error}</p>
                )}
              </div>
              {pushAlerts.supported && (
                <button
                  type="button"
                  onClick={handleEnableAlerts}
                  disabled={pushAlerts.loading || !userName}
                  className="min-h-11 rounded-xl bg-[var(--bg-warning)] px-4 text-sm font-semibold text-[var(--content-primary)] disabled:opacity-50"
                >
                  <span className="inline-flex items-center gap-2">
                    <Bell size={16} weight="fill" />
                    {pushAlerts.loading ? 'Enabling…' : 'Enable Alerts'}
                  </span>
                </button>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
