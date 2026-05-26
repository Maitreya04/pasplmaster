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
import { ActivePickRow } from '../../components/picking/ActivePickRow';
import { AssignedOrderRow } from '../../components/picking/AssignedOrderRow';
import { PickerDailyStatsStrip } from '../../components/picking/PickerDailyStatsStrip';
import { isMyAssignedPending, isMyInProgressPick } from '../../lib/picking/pickLifecycle';

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
  const claimOrderIdParam = searchParams.get('claimOrderId');
  const legacyClaimOrderId = claimOrderIdParam ? Number.parseInt(claimOrderIdParam, 10) : null;

  // Legacy push links — open trip brief for pool claim.
  useEffect(() => {
    if (!claimOrderIdParam) return;
    if (!Number.isInteger(legacyClaimOrderId) || (legacyClaimOrderId ?? 0) <= 0) {
      navigate('/picking', { replace: true });
      return;
    }
    navigate(`/picking/preview/${legacyClaimOrderId}?source=pool`, { replace: true });
  }, [claimOrderIdParam, legacyClaimOrderId, navigate]);

  const { myActive, stale, isLoading } = useClaimableOrders({
    stage: 'picking',
    workflowStatus: ['approved', 'picking'],
  });

  const dailyStats = usePickerDailyStats();
  const pushAlerts = usePickerPushNotifications({ role, userId, userName });

  /** In-progress picks assigned to you — includes stale / lapsed sessions. */
  const resumeOrders = useMemo(() => {
    const seen = new Set<number>();
    const merged: typeof myActive = [];
    for (const order of [...myActive, ...stale]) {
      if (seen.has(order.id)) continue;
      if (!hasPickableLines(order)) continue;
      if (!isMyInProgressPick(order, userName)) continue;
      seen.add(order.id);
      merged.push(order);
    }
    return merged.sort((a, b) => {
      const aStale = !a.claim_info || a.claim_info.is_stale ? 0 : 1;
      const bStale = !b.claim_info || b.claim_info.is_stale ? 0 : 1;
      if (aStale !== bStale) return aStale - bStale;
      if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
      if (a.priority !== 'urgent' && b.priority === 'urgent') return 1;
      return (
        new Date(b.claim_info?.last_heartbeat_at ?? b.approved_at ?? b.created_at).getTime() -
        new Date(a.claim_info?.last_heartbeat_at ?? a.approved_at ?? a.created_at).getTime()
      );
    });
  }, [myActive, stale, userName]);

  const staleResumeCount = useMemo(
    () =>
      resumeOrders.filter((order) => !order.claim_info || order.claim_info.is_stale).length,
    [resumeOrders],
  );

  /** Assigned orders waiting to start (approved, not yet picking). */
  const assignedOrders = useMemo(
    () =>
      [...myActive]
        .filter(hasPickableLines)
        .filter((order) => isMyAssignedPending(order, userName))
        .sort(
          (a, b) =>
            new Date(b.approved_at ?? b.created_at).getTime() -
            new Date(a.approved_at ?? a.created_at).getTime(),
        ),
    [myActive, userName],
  );

  const openAssignedPreview = (orderId: number) => {
    navigate(`/picking/preview/${orderId}?source=assigned`);
  };

  const openResumePick = (orderId: number) => {
    navigate(`/picking/pick/${orderId}`);
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

  const queueWorkCount = assignedOrders.length + resumeOrders.length;
  const queueIsEmpty = !isLoading && queueWorkCount === 0;

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

      <div className="space-y-4 p-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton variant="card" count={3} />
          </div>
        ) : (
          <section className="space-y-4">
            {resumeOrders.length > 0 && (
              <div className="space-y-2">
                <QueueSectionHeader
                  label="Continue picking"
                  count={resumeOrders.length}
                  description={
                    staleResumeCount > 0
                      ? `${staleResumeCount} stale — tap to resume where you left off`
                      : 'Tap to open the pick deck and finish these lines'
                  }
                />
                <div className="space-y-2">
                  {resumeOrders.map((order) => (
                    <ActivePickRow
                      key={order.id}
                      order={order}
                      isMine
                      onOpen={() => openResumePick(order.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <QueueSectionHeader
                label="Your assignments"
                count={assignedOrders.length}
                showWhenEmpty
                description={
                  assignedOrders.length === 0
                    ? resumeOrders.length > 0
                      ? 'New billing assignments appear here when ready to start'
                      : 'Billing-assigned orders appear here when ready to start'
                    : 'Tap an order to review the pick list, then start picking'
                }
              />
              {assignedOrders.length === 0 ? (
                queueIsEmpty ? (
                  <EmptyState
                    icon={Package}
                    title="No assignments"
                    description="New billing assignments show up here. Live picks and the unassigned pool are on Team."
                    action={{
                      label: 'Open Team',
                      onClick: () => navigate('/picking/active'),
                    }}
                  />
                ) : resumeOrders.length > 0 ? null : (
                  <p className="rounded-2xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--content-secondary)]">
                    No new assignments right now. Active picks are on the Team tab.
                  </p>
                )
              ) : (
                <div className="space-y-2">
                  {assignedOrders.map((order) => (
                    <AssignedOrderRow
                      key={order.id}
                      order={order}
                      onOpen={() => openAssignedPreview(order.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
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
