import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  Lightning,
  ArrowRight,
  Clock,
  SpinnerGap,
  Warning,
  User,
  Bell,
} from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase/client';
import { useClaimableOrders } from '../../hooks/useClaimableOrders';
import { usePickerPushNotifications } from '../../hooks/usePickerPushNotifications';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  PageHeader,
  Card,
  BigButton,
  StatusBadge,
  EmptyState,
  Skeleton,
} from '../../components/shared';
import type { OrderWithClaimInfo } from '../../hooks/useClaimableOrders';

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function sortOrders(orders: OrderWithClaimInfo[]): OrderWithClaimInfo[] {
  return [...orders].sort((a, b) => {
    if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
    if (a.priority !== 'urgent' && b.priority === 'urgent') return 1;
    const aTime = a.approved_at ? new Date(a.approved_at).getTime() : 0;
    const bTime = b.approved_at ? new Date(b.approved_at).getTime() : 0;
    return bTime - aTime;
  });
}

export default function QueuePage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { role, userId, userName } = useAuth();
  const autoClaimAttemptRef = useRef<string | null>(null);
  const claimOrderIdParam = searchParams.get('claimOrderId');
  const autoClaimOrderId = claimOrderIdParam ? Number.parseInt(claimOrderIdParam, 10) : null;

  const {
    available,
    myActive,
    otherActive,
    stale,
    isLoading
  } = useClaimableOrders({
    stage: 'picking',
    workflowStatus: ['approved', 'picking'],
  });
  const pushAlerts = usePickerPushNotifications({ role, userId, userName });

  const availableOrders = useMemo(
    () => sortOrders([...available, ...stale]),
    [available, stale],
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
      const result = data as { success: boolean, reason?: string, claimed_by?: string };
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
    claimMutation.isPending,
    claimMutation.mutate,
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
      toast.info('Picker alerts turned off on this device');
    } else {
      toast.error(result.error || 'Failed to disable picker alerts.');
    }
  };

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Pick Queue"
        action={
          <div className="flex items-center gap-2">
            {pushAlerts.enabled && (
              <button
                type="button"
                onClick={handleDisableAlerts}
                disabled={pushAlerts.loading}
                className="min-h-9 px-3 rounded-full text-xs font-semibold border border-[var(--border-subtle)] text-[var(--content-secondary)] bg-[var(--bg-tertiary)] disabled:opacity-50"
              >
                {pushAlerts.loading ? 'Updating…' : 'Disable alerts'}
              </button>
            )}
            {userName ? (
              <span className="flex items-center gap-1 text-xs text-[var(--content-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 rounded-full">
                <User size={12} weight="bold" />
                {userName}
              </span>
            ) : null}
          </div>
        }
      />

      <div className="p-4 space-y-6">
        {!pushAlerts.enabled && (
          <Card className="border-[var(--border-warning)] bg-[var(--bg-warning-subtle)]">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Bell size={18} weight="fill" className="text-[var(--content-warning)]" />
                  <p className="font-semibold text-[var(--content-primary)]">
                    Picker alerts
                  </p>
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
                  <p className="mt-2 text-xs text-[var(--content-negative)]">
                    {pushAlerts.error}
                  </p>
                )}
              </div>
              {pushAlerts.supported && (
                <button
                  type="button"
                  onClick={handleEnableAlerts}
                  disabled={pushAlerts.loading || !userName}
                  className="min-h-11 px-4 rounded-xl text-sm font-semibold bg-[var(--bg-warning)] text-[var(--content-primary)] disabled:opacity-50"
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

        {/* My Active Picks — prominent amber banners */}
        {myActive.length > 0 && (
          <section className="space-y-3">
            {myActive.map((pick) => (
              <div
                key={pick.id}
                onClick={() => navigate(`/picking/pick/${pick.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(`/picking/pick/${pick.id}`);
                  }
                }}
                className="
                  rounded-2xl p-5
                  bg-[var(--bg-warning-subtle)] border-2 border-[var(--border-warning)]
                  cursor-pointer active:scale-[0.98] transition-transform duration-150
                "
              >
                <div className="flex items-center gap-2 mb-2">
                  <Warning size={18} weight="fill" className="text-[var(--content-warning)]" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--content-warning)]">
                    In Progress
                  </span>
                </div>
                <div className="flex items-center justify-between mb-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono font-bold text-lg text-[var(--content-primary)]">
                        {pick.order_number}
                      </span>
                      {pick.priority === 'urgent' && (
                        <StatusBadge status="urgent" />
                      )}
                    </div>
                    <p className="text-sm text-[var(--content-secondary)] truncate">
                      {pick.customer_name}
                      <span className="text-[var(--content-tertiary)]">
                        {' '}· {pick.item_count} items
                      </span>
                    </p>
                  </div>
                </div>
                <BigButton
                  variant="primary"
                  className="bg-[var(--bg-warning)] text-[var(--content-primary)]"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/picking/pick/${pick.id}`);
                  }}
                >
                  Continue Picking
                  <ArrowRight size={20} weight="bold" />
                </BigButton>
              </div>
            ))}
          </section>
        )}

        {/* Available Orders */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--content-tertiary)] uppercase tracking-wider mb-3">
            Available Orders
            {availableOrders.length > 0 && (
              <span className="ml-2 text-[var(--content-secondary)]">
                ({availableOrders.length})
              </span>
            )}
          </h2>

          {isLoading ? (
            <div className="space-y-3">
              <Skeleton variant="card" count={4} />
            </div>
          ) : availableOrders.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No orders ready"
              description="Approved orders will appear here for picking"
            />
          ) : (
            <div className="space-y-3">
              {availableOrders.map((order) => (
                <OrderCard
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

        {/* Other Picking Orders — being picked by other pickers */}
        {otherActive.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-[var(--content-tertiary)] uppercase tracking-wider mb-3">
              Being Picked by Others
              <span className="ml-2 text-[var(--content-secondary)]">
                ({otherActive.length})
              </span>
            </h2>
            <div className="space-y-2">
              {otherActive.map((order) => (
                <Card key={order.id} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono font-semibold text-sm text-[var(--content-primary)]">
                        {order.order_number}
                      </span>
                      {order.priority === 'urgent' && <StatusBadge status="urgent" />}
                      <StatusBadge status="picking" />
                    </div>
                    <p className="text-sm text-[var(--content-secondary)] truncate">
                      {order.customer_name}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-[var(--content-tertiary)]">
                      {order.claim_info?.claimed_by_name || order.picker_name}
                    </p>
                    <p className="text-xs text-[var(--content-quaternary)]">
                      {order.item_count} items
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function OrderCard({
  order,
  onClaim,
  claiming,
}: {
  order: OrderWithClaimInfo;
  onClaim: () => void;
  claiming: boolean;
}) {
  const isUrgent = order.priority === 'urgent';

  return (
    <Card
      className={`space-y-3 ${
        isUrgent
          ? 'border-l-4 border-[var(--bg-negative)] bg-[var(--bg-negative-subtle)]'
          : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono font-semibold text-[var(--content-primary)]">
              {order.order_number}
            </span>
            {isUrgent && <StatusBadge status="urgent" />}
            {order.claim_info?.is_stale && (
              <span className="text-[10px] uppercase font-bold text-[var(--content-warning)] bg-[var(--bg-warning-subtle)] px-2 py-0.5 rounded border border-[var(--border-warning)]">
                Stale (Takeover)
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--content-secondary)] truncate">
            {order.customer_name}
            {order.customer_city && (
              <span className="text-[var(--content-tertiary)]">
                {' '}
                · {order.customer_city}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--content-tertiary)] shrink-0 ml-3">
          <Clock size={14} />
          <span>{timeAgo(order.approved_at ?? order.created_at)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-[var(--content-tertiary)]">
          <span className="flex items-center gap-1">
            <Package size={14} />
            {order.item_count} items
          </span>
          {order.transport_name && (
            <span className="truncate max-w-[140px]">
              {order.transport_name}
            </span>
          )}
        </div>

        <button
          onClick={onClaim}
          disabled={claiming}
          className={`
            flex items-center gap-2 px-4 py-3 rounded-xl
            text-sm font-semibold
            hover:opacity-90 active:scale-95
            transition-all duration-150
            disabled:opacity-50 disabled:cursor-not-allowed
            min-h-11
            ${
              isUrgent
                ? 'bg-[var(--bg-negative)] text-[var(--content-on-color)]'
                : 'bg-[var(--bg-warning)] text-[var(--content-primary)]'
            }
          `}
        >
          {claiming ? (
            <SpinnerGap size={16} className="animate-spin" />
          ) : (
            <Lightning size={16} weight="fill" />
          )}
          Start
        </button>
      </div>
    </Card>
  );
}
