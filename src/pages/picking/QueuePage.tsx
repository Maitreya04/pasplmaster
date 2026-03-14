import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  Lightning,
  ArrowRight,
  Clock,
  SpinnerGap,
  Warning,
} from '@phosphor-icons/react';
import { supabase } from '../../lib/supabase/client';
import { useOrders } from '../../hooks/useOrders';
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
import type { Order } from '../../types';

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

function sortOrders(orders: Order[]): Order[] {
  return [...orders].sort((a, b) => {
    if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
    if (a.priority !== 'urgent' && b.priority === 'urgent') return 1;
    const aTime = a.approved_at ? new Date(a.approved_at).getTime() : 0;
    const bTime = b.approved_at ? new Date(b.approved_at).getTime() : 0;
    return bTime - aTime;
  });
}

export default function QueuePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userName } = useAuth();

  const { data: approvedOrders, isLoading: loadingApproved } = useOrders({
    status: 'approved',
  });
  const { data: pickingOrders, isLoading: loadingPicking } = useOrders({
    status: 'picking',
  });

  const myActivePick = useMemo(
    () => pickingOrders?.find((o) => o.picker_name === userName) ?? null,
    [pickingOrders, userName],
  );

  const availableOrders = useMemo(
    () => sortOrders(approvedOrders ?? []),
    [approvedOrders],
  );

  const claimMutation = useMutation({
    mutationFn: async (orderId: number) => {
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'picking',
          picker_name: userName,
          picked_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .eq('status', 'approved');
      if (error) throw error;
    },
    onSuccess: (_data, orderId) => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      navigate(`/picking/pick/${orderId}`);
    },
    onError: () => {
      toast.error('Failed to claim order — it may have been taken by another picker');
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const isLoading = loadingApproved || loadingPicking;

  return (
    <div className="min-h-screen">
      <PageHeader title="Pick Queue" />

      <div className="p-4 space-y-6">
        {/* My Active Pick — prominent amber banner */}
        {myActivePick && (
          <section>
            <div
              onClick={() => navigate(`/picking/pick/${myActivePick.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/picking/pick/${myActivePick.id}`);
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
                      {myActivePick.order_number}
                    </span>
                    {myActivePick.priority === 'urgent' && (
                      <StatusBadge status="urgent" />
                    )}
                  </div>
                  <p className="text-sm text-[var(--content-secondary)] truncate">
                    {myActivePick.customer_name}
                    <span className="text-[var(--content-tertiary)]">
                      {' '}· {myActivePick.item_count} items
                    </span>
                  </p>
                </div>
              </div>
              <BigButton
                variant="primary"
                className="bg-[var(--bg-warning)] text-[var(--content-primary)]"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/picking/pick/${myActivePick.id}`);
                }}
              >
                Continue Picking
                <ArrowRight size={20} weight="bold" />
              </BigButton>
            </div>
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
      </div>
    </div>
  );
}

function OrderCard({
  order,
  onClaim,
  claiming,
}: {
  order: Order;
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
            min-h-[44px]
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
