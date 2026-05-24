import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  ArrowRight,
  Warning,
  Bell,
  GearSix,
  Barcode,
} from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase/client';
import { useClaimableOrders } from '../../hooks/useClaimableOrders';
import { usePickerPushNotifications } from '../../hooks/usePickerPushNotifications';
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
import { BeingPickedCarousel } from '../../components/picking/BeingPickedCarousel';
import { AvailableOrderRow } from '../../components/picking/AvailableOrderRow';
import {
  sortAvailablePickQueueOrders,
  sortBeingPickedOrders,
} from '../../lib/pickQueueTransport';

function hasPickableLines(order: { pick_line_count?: number; item_count: number }): boolean {
  if (order.pick_line_count != null) return order.pick_line_count > 0;
  return order.item_count > 0;
}

export default function QueuePage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { role, userId, userName } = useAuth();
  const autoClaimAttemptRef = useRef<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const claimOrderIdParam = searchParams.get('claimOrderId');
  const autoClaimOrderId = claimOrderIdParam ? Number.parseInt(claimOrderIdParam, 10) : null;

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
  const pushAlerts = usePickerPushNotifications({ role, userId, userName });

  const availableOrders = useMemo(
    () => sortAvailablePickQueueOrders([...available, ...stale].filter(hasPickableLines)),
    [available, stale],
  );

  const resumePick = useMemo(() => {
    if (myActive.length === 0) return null;
    return [...myActive].sort((a, b) => {
      const aTime = new Date(a.claim_info?.claimed_at ?? a.approved_at ?? a.created_at).getTime();
      const bTime = new Date(b.claim_info?.claimed_at ?? b.approved_at ?? b.created_at).getTime();
      return bTime - aTime;
    })[0];
  }, [myActive]);

  /** Carousel: skip your own pick when the sticky resume banner is showing. */
  const carouselOrders = useMemo(
    () =>
      sortBeingPickedOrders(
        resumePick != null ? otherActive : [...myActive, ...otherActive],
      ),
    [myActive, otherActive, resumePick],
  );

  const myOrderIds = useMemo(
    () => new Set(myActive.map((order) => order.id)),
    [myActive],
  );

  const clearNotificationIntent = useCallback(() => {
    navigate('/picking', { replace: true });
  }, [navigate]);

  const claimMutation = useMutation({
    mutationFn: async (orderId: number) => {
      if (!userId) throw new Error('Not logged in');
      const { data, error } = await supabase.rpc('claim_order', {
        p_order_id: orderId,
        p_stage: 'picking',
        p_user_id: userId,
      });
      if (error) throw error;
      const result = data as { success: boolean; reason?: string; claimed_by?: string };
      if (!result.success) {
        if (result.reason === 'already_claimed') {
          throw new Error(`ALREADY_CLAIMED:${result.claimed_by || 'someone'}`);
        }
        throw new Error(result.reason || 'CLAIM_FAILED');
      }
      return orderId;
    },
    onSuccess: (claimedOrderId) => {
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      navigate(`/picking/pick/${claimedOrderId}`, { replace: true });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : '';
      if (msg.startsWith('ALREADY_CLAIMED:')) {
        const pickerName = msg.replace('ALREADY_CLAIMED:', '');
        toast.error(`This order is already being picked by ${pickerName}. Please choose another.`);
      } else if (msg === 'Missing orderId or userId') {
        toast.error('Select a picker name before claiming orders.');
      } else if (msg === 'Order not found') {
        toast.error('This order is no longer available for picking.');
      } else {
        toast.error('Failed to claim order.');
      }
      queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      if (claimOrderIdParam) {
        clearNotificationIntent();
      }
    },
  });

  useEffect(() => {
    if (!claimOrderIdParam) {
      autoClaimAttemptRef.current = null;
    }
  }, [claimOrderIdParam]);

  useEffect(() => {
    if (!claimOrderIdParam || !userId) return;
    if (!Number.isInteger(autoClaimOrderId) || (autoClaimOrderId ?? 0) <= 0) {
      toast.error('That picker alert is no longer valid.');
      clearNotificationIntent();
      return;
    }
    const claimTargetId = autoClaimOrderId as number;
    if (autoClaimAttemptRef.current === claimOrderIdParam || claimMutation.isPending) return;

    if (myActive.length > 0) {
      const existingClaim = myActive.find((order) => order.id === claimTargetId);
      autoClaimAttemptRef.current = claimOrderIdParam;
      if (existingClaim) {
        navigate(`/picking/pick/${existingClaim.id}`, { replace: true });
      } else {
        toast.info('Finish or release your current pick before claiming another order.');
        clearNotificationIntent();
      }
      return;
    }

    autoClaimAttemptRef.current = claimOrderIdParam;
    claimMutation.mutate(claimTargetId);
  }, [
    autoClaimOrderId,
    claimMutation,
    claimOrderIdParam,
    clearNotificationIntent,
    myActive,
    navigate,
    toast,
    userId,
  ]);

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
    carouselOrders.length === 0 &&
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

      {resumePick && (
        <div className="sticky top-11 z-30 border-b border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-4 py-2">
          <div className="flex items-center gap-2.5">
            <Warning size={16} weight="fill" className="shrink-0 text-[var(--content-warning)]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-[var(--content-primary)] leading-tight">
                {resumePick.customer_name}
              </p>
              <p className="truncate text-[11px] text-[var(--content-secondary)]">
                {resumePick.transport_name ?? 'No transport'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/picking/pick/${resumePick.id}`)}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[var(--bg-warning)] px-2.5 py-1.5 text-xs font-semibold text-[var(--content-primary)] active:scale-[0.98]"
            >
              Continue
              <ArrowRight size={14} weight="bold" />
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4 p-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton variant="card" count={3} />
          </div>
        ) : (
          <>
            <BeingPickedCarousel
              orders={carouselOrders}
              myOrderIds={myOrderIds}
              onResume={(orderId) => navigate(`/picking/pick/${orderId}`)}
            />

            <section>
              <QueueSectionHeader label="Available to pick" count={availableOrders.length} />

              {availableOrders.length === 0 ? (
                queueIsEmpty ? (
                  <EmptyState
                    icon={Package}
                    title="No orders ready"
                    description="Approved orders will appear here for picking"
                  />
                ) : null
              ) : (
                <div className="space-y-2">
                  {availableOrders.map((order) => (
                    <AvailableOrderRow
                      key={order.id}
                      order={order}
                      onClaim={() => claimMutation.mutate(order.id)}
                      claiming={
                        claimMutation.isPending &&
                        claimMutation.variables === order.id
                      }
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
