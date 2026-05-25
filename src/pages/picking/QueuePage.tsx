import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Package,
  ArrowRight,
  Bell,
  GearSix,
  Barcode,
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
import { IncompletePickBanner } from '../../components/picking/IncompletePickBanner';
import { PickerDailyStatsStrip } from '../../components/picking/PickerDailyStatsStrip';
import { sortAvailablePickQueueOrders } from '../../lib/pickQueueTransport';
import {
  isInProgressPick,
  isMyAssignedPending,
} from '../../lib/picking/pickLifecycle';

function hasPickableLines(order: { pick_line_count?: number; item_count: number }): boolean {
  if (order.pick_line_count != null) return order.pick_line_count > 0;
  return order.item_count > 0;
}

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

  const assignedToMe = useMemo(
    () =>
      myActive.filter(
        (order) => isMyAssignedPending(order, userName) && hasPickableLines(order),
      ),
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

  const availableOrders = useMemo(
    () => sortAvailablePickQueueOrders([...available, ...stale].filter(hasPickableLines)),
    [available, stale],
  );

  const hasOpenWork = inProgressPicks.length > 0 || assignedToMe.length > 0;

  const openPreview = (orderId: number, source: 'assigned' | 'pool') => {
    navigate(`/picking/preview/${orderId}?source=${source}`);
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

  const queueIsEmpty =
    !isLoading &&
    assignedToMe.length === 0 &&
    !resumePick &&
    availableOrders.length === 0;

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
            {assignedToMe.length > 0 && (
              <section>
                <QueueSectionHeader label="Assigned to me" count={assignedToMe.length} />
                <div className="space-y-2">
                  {assignedToMe.map((order) => (
                    <AssignedOrderRow
                      key={order.id}
                      order={order}
                      onOpen={() => openPreview(order.id, 'assigned')}
                    />
                  ))}
                </div>
              </section>
            )}

            <section>
              <QueueSectionHeader
                label="Available — unassigned"
                count={availableOrders.length}
                className="opacity-80"
              />
              <p className="mb-2 text-xs text-[var(--content-tertiary)]">
                Only claim if billing has not assigned anyone yet.
              </p>

              {resumePick ? (
                <p className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--content-secondary)]">
                  Finish your open pick above before starting a new order.
                </p>
              ) : hasOpenWork && assignedToMe.length > 0 ? (
                <p className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--content-secondary)]">
                  Start your assigned orders first. Use Available only as a fallback.
                </p>
              ) : availableOrders.length === 0 ? (
                queueIsEmpty ? (
                  <EmptyState
                    icon={Package}
                    title="No orders ready"
                    description="Approved orders will appear here for picking"
                  />
                ) : null
              ) : (
                <div className="space-y-2 opacity-90">
                  {availableOrders.map((order) => (
                    <AvailableOrderRow
                      key={order.id}
                      order={order}
                      onOpen={() => openPreview(order.id, 'pool')}
                      disabled={inProgressPicks.length > 0}
                    />
                  ))}
                </div>
              )}
            </section>
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
