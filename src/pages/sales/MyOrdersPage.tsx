import { useState } from 'react';
import { Package, HourglassHigh } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';
import { useOrders } from '../../hooks/useOrders';
import { useOrderDetail } from '../../hooks/useOrderDetail';
import { usePendingItems } from '../../hooks/usePendingItems';
import { Card, BottomSheet, StatusBadge, EmptyState, Skeleton } from '../../components/shared';
import type { Order, OrderItem, OrderWithItems } from '../../types';

import { formatCurrency, formatTimeAgo } from '../../utils/formatters';

function OrderCard({
  order,
  onTap,
}: {
  order: OrderWithItems | Order;
  onTap: () => void;
}) {
  return (
    <Card pressable onClick={onTap}>
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <span className="font-mono text-[var(--content-tertiary)] text-sm">
            {order.order_number}
            {order.status !== 'flagged' && 'items' in order && order.items && (order.items as OrderItem[]).some((i: OrderItem) => i.state === 'flagged') && (
              <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] px-1.5 py-0.5 rounded">
                Has Rejections
              </span>
            )}
          </span>
          <StatusBadge status={order.status} />
        </div>
        <p className="font-bold text-[var(--content-primary)]">{order.customer_name}</p>
        <div className="flex items-center justify-between text-sm">
          <span className="font-mono text-[var(--content-secondary)]">
            {order.item_count} items · {formatCurrency(order.total_value)}
          </span>
          <span className="text-[var(--content-tertiary)]">{formatTimeAgo(order.created_at)}</span>
        </div>
      </div>
    </Card>
  );
}

function OrderDetailSheet({
  orderId,
  isOpen,
  onClose,
}: {
  orderId: number | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { data: order, isLoading } = useOrderDetail(orderId);
  const {
    data: pending,
    isLoading: pendingLoading,
  } = usePendingItems({
    orderId,
    status: 'pending',
    enabled: orderId !== null,
  });

  if (!isOpen) return null;

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={order?.order_number ?? 'Order'}>
      {isLoading ? (
        <Skeleton variant="text" lines={6} />
      ) : order ? (
        <div className="space-y-4">
          <div className="text-sm text-[var(--content-secondary)]">
            {order.customer_name}
            {order.customer_city && ` · ${order.customer_city}`}
          </div>
          <ul className="space-y-3">
            {order.items?.map((item: OrderItem) => {
              const price = item.price_quoted ?? item.price_system ?? 0;
              const qty = item.qty_approved ?? item.qty_requested;
              const lineTotal = price * qty;
              const isFlagged = item.state === 'flagged';
              return (
                <li
                  key={item.id}
                  className={`flex justify-between items-start gap-4 py-2 border-b border-[var(--border-subtle)] last:border-0 ${isFlagged ? 'opacity-70' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className={`font-medium ${isFlagged ? 'text-[var(--content-negative)]' : 'text-[var(--content-primary)]'}`}>
                      {item.item_name}
                    </p>
                    {isFlagged && (
                      <div className="mt-1 mb-1 space-y-0.5">
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]">
                          Rejected: {item.flag_reason || 'See notes'}
                        </span>
                        {item.flag_notes && (
                          <p className="text-xs text-[var(--content-secondary)] mt-0.5">
                            Note: {item.flag_notes}
                          </p>
                        )}
                        {typeof item.flag_box_price === 'number' && (
                          <p className="text-xs text-[var(--content-secondary)] mt-0.5">
                            Printed box price: {formatCurrency(item.flag_box_price)}
                          </p>
                        )}
                      </div>
                    )}
                    <p className={`font-mono text-sm text-[var(--content-secondary)] ${isFlagged ? 'line-through decoration-[var(--border-negative)]' : ''}`}>
                      {qty} × {formatCurrency(price)} = {formatCurrency(lineTotal)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono font-semibold text-[var(--content-primary)]">
                Total:
              </span>
              <div className="text-right">
                {order.items?.some((i: OrderItem) => i.state === 'flagged') ? (
                  <>
                    <span className="font-mono text-sm text-[var(--content-tertiary)] line-through mr-2">
                      {formatCurrency(order.total_value)}
                    </span>
                    <span className="font-mono font-bold text-[var(--content-primary)]">
                      {formatCurrency(
                        order.items.reduce((acc: number, item: OrderItem) => {
                          if (item.state === 'flagged') return acc;
                          const price = item.price_quoted ?? item.price_system ?? 0;
                          const qty = item.qty_approved ?? item.qty_requested;
                          return acc + (price * qty);
                        }, 0)
                      )}
                    </span>
                  </>
                ) : (
                  <span className="font-mono font-bold text-[var(--content-primary)]">
                    {formatCurrency(order.total_value)}
                  </span>
                )}
              </div>
            </div>

            {pending && pending.length > 0 && (
              <div className="mt-1 rounded-lg bg-[var(--bg-secondary)] px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <HourglassHigh size={14} className="text-[var(--content-warning)]" />
                  <span className="text-xs font-semibold text-[var(--content-warning)] uppercase tracking-wide">
                    Pending (no stock)
                  </span>
                  {pendingLoading && (
                    <span className="text-[10px] text-[var(--content-tertiary)]">
                      updating…
                    </span>
                  )}
                </div>
                <ul className="space-y-1.5">
                  {pending.map((pi) => (
                    <li key={pi.id} className="flex items-baseline justify-between gap-3">
                      <span className="text-xs text-[var(--content-secondary)] truncate">
                        {pi.item_name}
                      </span>
                      <span className="text-xs font-mono font-semibold text-[var(--content-primary)]">
                        × {pi.qty_pending}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </BottomSheet>
  );
}

export default function MyOrdersPage() {
  const { userName } = useAuth();
  const { data: orders, isLoading, error } = useOrders({
    salespersonName: userName ?? undefined,
  });
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  return (
    <div className="p-4 min-h-screen bg-[var(--bg-primary)]">
      <h1 className="text-2xl font-bold text-[var(--content-primary)]">My Orders</h1>
      <p className="text-sm text-[var(--content-secondary)] mt-1">
        {userName ? `Orders by ${userName}` : 'Your submitted orders'}
      </p>

      {isLoading ? (
        <div className="mt-6 space-y-3">
          <Skeleton variant="card" count={4} />
        </div>
      ) : error ? (
        <p className="mt-6 text-[var(--content-negative)]">Failed to load orders</p>
      ) : !orders?.length ? (
        <EmptyState
          icon={Package}
          title="No orders yet"
          description="Orders you submit will appear here"
        />
      ) : (
        <div className="mt-6 space-y-3">
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onTap={() => setSelectedOrderId(order.id)}
            />
          ))}
        </div>
      )}

      <OrderDetailSheet
        orderId={selectedOrderId}
        isOpen={selectedOrderId !== null}
        onClose={() => setSelectedOrderId(null)}
      />
    </div>
  );
}
