import { useCallback, useMemo, useState } from 'react';
import { Package, Warning } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';
import { useOrders } from '../../hooks/useOrders';
import { useOrderDetail } from '../../hooks/useOrderDetail';
import { usePendingItems } from '../../hooks/usePendingItems';
import { useUserNotifications } from '../../hooks/useUserNotifications';
import { Card, BottomSheet, StatusBadge, EmptyState, Skeleton } from '../../components/shared';
import type { Order, OrderItem, OrderWithItems, PendingItem } from '../../types';

import { formatCurrency, formatTimeAgo } from '../../utils/formatters';

/** Billing review marks OOS with this exact reason (see `ReviewPage`). Picker flags use other reasons. */
const BILLING_OOS_FLAG_REASON = 'Out of Stock (Billing)';

function isBillingStockRejection(item: OrderItem): boolean {
  return item.state === 'flagged' && item.flag_reason === BILLING_OOS_FLAG_REASON;
}

function isPickerOrNonBillingFlag(item: OrderItem): boolean {
  return item.state === 'flagged' && !isBillingStockRejection(item);
}

function inferSalesUpdateLabel(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('sent to po') || t.includes('pending') || t.includes('po.')) return 'Partial (PO)';
  if (t.includes('removed from order') || t.includes('dropped')) return 'Dropped';
  if (t.includes('only') && t.includes('available')) return 'Partial';
  return 'Update';
}

type OrderSheetRow =
  | {
      kind: 'line';
      item: OrderItem;
      pendingExtra: PendingItem | null;
      /** Sum of `qty_pending` when multiple pending rows match the same catalog item. */
      pendingQtyTotal: number;
    }
  | { kind: 'pending_only'; pi: PendingItem };

function lineAttentionRank(item: OrderItem, pendingQtyTotal: number): number {
  const billingOos = isBillingStockRejection(item);
  const pickerFlagged = isPickerOrNonBillingFlag(item);
  return stockLineSortKey(item, billingOos, pickerFlagged, pendingQtyTotal);
}

function mergeOrderLinesAndPending(
  items: OrderItem[] | undefined,
  pending: PendingItem[] | undefined,
): OrderSheetRow[] {
  const pend = (pending ?? []).filter((p) => p.status === 'pending');
  const byItemId = new Map<number, PendingItem[]>();
  for (const p of pend) {
    if (p.item_id == null) continue;
    const arr = byItemId.get(p.item_id) ?? [];
    arr.push(p);
    byItemId.set(p.item_id, arr);
  }
  const consumed = new Set<number>();
  const rows: OrderSheetRow[] = [];

  for (const item of items ?? []) {
    const arr = item.item_id ? byItemId.get(item.item_id) : undefined;
    let pendingExtra: PendingItem | null = null;
    let pendingQtyTotal = 0;
    if (arr?.length) {
      pendingExtra = arr[0]!;
      pendingQtyTotal = arr.reduce((s, p) => s + p.qty_pending, 0);
      for (const p of arr) consumed.add(p.id);
    }
    rows.push({ kind: 'line', item, pendingExtra, pendingQtyTotal });
  }
  for (const p of pend) {
    if (!consumed.has(p.id)) {
      rows.push({ kind: 'pending_only', pi: p });
    }
  }

  return rows.sort((a, b) => {
    const ra = a.kind === 'line' ? lineAttentionRank(a.item, a.pendingQtyTotal) : 0;
    const rb = b.kind === 'line' ? lineAttentionRank(b.item, b.pendingQtyTotal) : 0;
    return ra - rb;
  });
}

function formatFlagReason(reason: string | null): string {
  if (!reason?.trim()) return 'See notes';
  return reason.trim().toUpperCase();
}

/** Units that made it onto the bill for this line (0 if billing rejected the line). */
function billedUnits(item: OrderItem, billingOos: boolean, pendingQtyTotal: number): number {
  if (billingOos) return 0;
  if (item.qty_approved !== null && item.qty_approved !== undefined) {
    return item.qty_approved;
  }
  // Legacy / in-flight rows: infer from open pending when approved qty not written yet
  if (pendingQtyTotal > 0) {
    return Math.max(0, item.qty_requested - pendingQtyTotal);
  }
  return item.qty_requested;
}

type StockUiVariant = 'ok' | 'partial' | 'critical' | 'neutral';

/**
 * Sales-facing stock outcome (not picker workflow flags).
 * · Black  — requested qty fully billed, no remaining gap
 * · Amber  — some billed, shortfall remains OR odd pending vs gap
 * · Red    — nothing billed for the request, or billing rejected the line
 */
function stockUiVariant(
  item: OrderItem,
  billingOos: boolean,
  pickerFlagged: boolean,
  pendingQtyTotal: number,
): StockUiVariant {
  if (pickerFlagged) return 'neutral';

  const req = item.qty_requested;
  const billed = billedUnits(item, billingOos, pendingQtyTotal);
  const gap = Math.max(0, req - billed);

  if (billingOos) return 'critical';
  if (gap === 0) {
    if (pendingQtyTotal > 0) return 'partial';
    return 'ok';
  }
  if (billed === 0) return 'critical';
  return 'partial';
}

function titleClassForVariant(v: StockUiVariant): string {
  switch (v) {
    case 'ok':
      return 'text-[15px] font-semibold leading-snug text-[var(--content-primary)]';
    case 'partial':
      return 'text-[15px] font-semibold leading-snug text-[var(--content-warning)]';
    case 'critical':
      return 'text-[15px] font-semibold leading-snug text-[var(--content-negative)]';
    default:
      return 'text-[15px] font-semibold leading-snug text-[var(--content-primary)]';
  }
}

function OrderLineMetrics({
  requested,
  billed,
  gap,
  price,
  lineTotal,
  pendingQtyTotal,
  variant,
  pickerFlagged,
  shipQty,
  shipCap,
  poQty,
}: {
  requested: number;
  billed: number;
  gap: number;
  price: number;
  lineTotal: number;
  pendingQtyTotal: number;
  variant: StockUiVariant;
  pickerFlagged: boolean;
  shipQty?: number;
  shipCap?: number;
  poQty?: number;
}): React.JSX.Element {
  const gapClass = pickerFlagged
    ? 'text-[var(--content-secondary)]'
    : variant === 'critical'
      ? 'text-[var(--content-negative)]'
      : variant === 'partial'
        ? 'text-[var(--content-warning)]'
        : 'text-[var(--content-primary)]';

  return (
    <div className="mt-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2.5 space-y-2">
      <div className="flex justify-between gap-3 text-sm">
        <span className="text-[var(--content-tertiary)] shrink-0">You requested</span>
        <span className="font-mono font-semibold tabular-nums text-[var(--content-primary)] text-right">
          {requested} pcs
        </span>
      </div>
      <div className="flex justify-between gap-3 text-sm">
        <span className="text-[var(--content-tertiary)] shrink-0">Billed</span>
        <span className="font-mono font-semibold tabular-nums text-[var(--content-primary)] text-right">
          {billed} × {formatCurrency(price)} = {formatCurrency(lineTotal)}
        </span>
      </div>
      {gap > 0 && (
        <div className="flex justify-between gap-3 border-t border-[var(--border-subtle)] pt-2 text-sm">
          <span className="text-[var(--content-tertiary)] shrink-0">Not billed yet</span>
          <div className="min-w-0 text-right">
            <span className={`font-mono font-semibold tabular-nums ${gapClass}`}>{gap} pcs</span>
            {pendingQtyTotal > 0 && (
              <p className="mt-0.5 text-[11px] leading-snug text-[var(--content-tertiary)]">
                {pendingQtyTotal === gap
                  ? 'Awaiting stock / not invoiced'
                  : `${pendingQtyTotal} pcs recorded as pending (no stock)`}
              </p>
            )}
          </div>
        </div>
      )}
      {typeof shipQty === 'number' &&
        typeof shipCap === 'number' &&
        shipQty < shipCap &&
        !pickerFlagged && (
          <p className="text-[11px] leading-snug text-[var(--content-tertiary)]">
            Available to ship from stock for this line: {shipQty} of {shipCap} pcs
            {typeof poQty === 'number' && poQty > 0 ? ` · ${poQty} on PO` : ''}
          </p>
        )}
    </div>
  );
}

function stockLineSortKey(
  item: OrderItem,
  billingOos: boolean,
  pickerFlagged: boolean,
  pendingQtyTotal: number,
): number {
  const v = stockUiVariant(item, billingOos, pickerFlagged, pendingQtyTotal);
  if (v === 'critical') return 0;
  if (v === 'partial') return 1;
  if (v === 'neutral') return 2;
  return 3;
}

function OrderCard({
  order,
  onTap,
  salesUpdateLabel,
}: {
  order: OrderWithItems | Order;
  onTap: () => void;
  salesUpdateLabel?: string | null;
}) {
  return (
    <Card pressable onClick={onTap}>
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-[var(--content-primary)]">{order.order_number}</span>
            {salesUpdateLabel && (
              <>
                <span
                  className="inline-block w-2 h-2 rounded-full bg-[var(--bg-negative)]"
                  aria-label="Order has an unread update"
                  title="Unread update"
                />
                <span className="text-[11px] font-semibold text-[var(--content-negative)]">
                  {salesUpdateLabel}
                </span>
              </>
            )}
            {order.workflow_status !== 'flagged' &&
              'items' in order &&
              order.items &&
              (order.items as OrderItem[]).some((i: OrderItem) => isBillingStockRejection(i)) && (
                <Warning size={16} weight="fill" className="text-[var(--content-warning)]" />
              )}
          </div>
          <StatusBadge status={order.workflow_status} />
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
  const { data: pending } = usePendingItems({
    orderId,
    status: 'pending',
    enabled: orderId !== null,
  });

  const sheetRows = useMemo(
    () => mergeOrderLinesAndPending(order?.items, pending),
    [order?.items, pending],
  );

  if (!isOpen) return null;

  const sheetTitle = order?.customer_name?.trim() || order?.order_number || 'Order';

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={sheetTitle}>
      {isLoading ? (
        <Skeleton variant="text" lines={6} />
      ) : order ? (
        <div className="space-y-4">
          <p className="text-sm text-[var(--content-secondary)]">
            <span className="font-mono text-[var(--content-primary)] font-semibold">{order.order_number}</span>
            {order.customer_city && (
              <>
                <span className="text-[var(--content-quaternary)]"> · </span>
                {order.customer_city}
              </>
            )}
          </p>

          <p className="text-[11px] leading-snug text-[var(--content-tertiary)]">
            <span className="text-[var(--content-primary)]">●</span> Full match ·{' '}
            <span className="text-[var(--content-warning)]">●</span> Partial ·{' '}
            <span className="text-[var(--content-negative)]">●</span> Not supplied
          </p>

          <ul className="space-y-0 divide-y divide-[var(--border-subtle)]">
            {sheetRows.map((row) => {
              if (row.kind === 'pending_only') {
                const pi = row.pi;
                const q = pi.qty_pending;
                return (
                  <li key={`p-${pi.id}`} className="flex flex-col gap-1.5 py-4 first:pt-0">
                    <p className="text-[15px] font-semibold leading-snug text-[var(--content-negative)]">
                      {pi.item_name}
                    </p>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--content-negative)]">
                      No invoice line — still outstanding
                    </p>
                    <div className="mt-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2.5 space-y-2">
                      <div className="flex justify-between gap-3 text-sm">
                        <span className="text-[var(--content-tertiary)]">Billed</span>
                        <span className="font-mono font-semibold tabular-nums text-[var(--content-primary)]">0 pcs</span>
                      </div>
                      <div className="flex justify-between gap-3 border-t border-[var(--border-subtle)] pt-2 text-sm">
                        <span className="text-[var(--content-tertiary)]">Not yet supplied</span>
                        <span className="font-mono font-semibold tabular-nums text-[var(--content-negative)]">
                          {q} pcs
                        </span>
                      </div>
                    </div>
                    {pi.note && (
                      <p className="text-xs text-[var(--content-tertiary)]">Note: {pi.note}</p>
                    )}
                  </li>
                );
              }

              const item = row.item;
              const price = item.price_quoted ?? item.price_system ?? 0;
              const billingOos = isBillingStockRejection(item);
              const pickerFlagged = isPickerOrNonBillingFlag(item);
              const pendingQtyTotal = row.pendingQtyTotal;
              const reqQty = item.qty_requested;
              const shipQty = item.qty_shippable;
              const billed = billedUnits(item, billingOos, pendingQtyTotal);
              const lineTotal = price * billed;
              const gap = Math.max(0, reqQty - billed);
              const v = stockUiVariant(item, billingOos, pickerFlagged, pendingQtyTotal);
              const nameClass = pickerFlagged
                ? titleClassForVariant('neutral')
                : titleClassForVariant(v);

              return (
                <li key={item.id} className="flex flex-col gap-1.5 py-4 first:pt-0">
                  <div className="min-w-0">
                    <p className={nameClass}>{item.item_name}</p>

                    {billingOos && (
                      <div className="mt-1.5 space-y-1">
                        <span className="inline-flex rounded-md bg-[var(--bg-negative-subtle)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--content-negative)]">
                          Rejected at billing: {formatFlagReason(item.flag_reason)}
                        </span>
                        {item.flag_notes && (
                          <p className="text-xs text-[var(--content-secondary)]">Note: {item.flag_notes}</p>
                        )}
                        {typeof item.flag_box_price === 'number' && (
                          <p className="text-xs text-[var(--content-secondary)]">
                            Printed box price: {formatCurrency(item.flag_box_price)}
                          </p>
                        )}
                      </div>
                    )}

                    {pickerFlagged && (
                      <div className="mt-1.5 space-y-1">
                        <span className="inline-flex rounded-md bg-[var(--bg-tertiary)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--content-secondary)]">
                          Flagged (warehouse): {formatFlagReason(item.flag_reason)}
                        </span>
                        {item.flag_notes && (
                          <p className="text-xs text-[var(--content-secondary)]">Note: {item.flag_notes}</p>
                        )}
                        {typeof item.flag_box_price === 'number' && (
                          <p className="text-xs text-[var(--content-secondary)]">
                            Printed box price: {formatCurrency(item.flag_box_price)}
                          </p>
                        )}
                      </div>
                    )}

                    <OrderLineMetrics
                      requested={reqQty}
                      billed={billed}
                      gap={gap}
                      price={price}
                      lineTotal={lineTotal}
                      pendingQtyTotal={pendingQtyTotal}
                      variant={v}
                      pickerFlagged={pickerFlagged}
                      shipQty={shipQty}
                      shipCap={reqQty}
                      poQty={item.qty_po}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-[var(--border-subtle)] pt-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-base font-semibold text-[var(--content-primary)]">Total</span>
              <div className="text-right">
                {order.items?.some((i: OrderItem) => isBillingStockRejection(i)) ? (
                  <>
                    <span className="font-mono text-sm text-[var(--content-tertiary)] line-through mr-2">
                      {formatCurrency(order.total_value)}
                    </span>
                    <span className="font-mono text-lg font-bold text-[var(--content-primary)]">
                      {formatCurrency(
                        order.items.reduce((acc: number, line: OrderItem) => {
                          if (isBillingStockRejection(line)) return acc;
                          const p = line.price_quoted ?? line.price_system ?? 0;
                          const q = line.qty_approved ?? line.qty_requested;
                          return acc + p * q;
                        }, 0),
                      )}
                    </span>
                  </>
                ) : (
                  <span className="font-mono text-lg font-bold text-[var(--content-primary)]">
                    {formatCurrency(order.total_value)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </BottomSheet>
  );
}

export default function MyOrdersPage(): React.JSX.Element | null {
  const { userName, userId } = useAuth();
  const { data: orders, isLoading, error } = useOrders({
    salespersonName: userName ?? undefined,
  });
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const { items: notifications, markRead } = useUserNotifications(userId);

  const unreadSalesUpdatesByOrderId = useMemo(() => {
    const map = new Map<number, { id: number; label: string; created_at: string }>();
    for (const n of notifications) {
      if (n.read_at !== null) continue;
      if (n.type !== 'order_update_for_sales' && n.type !== 'item_flagged_by_picker') continue;
      if (typeof n.order_id !== 'number' || !Number.isFinite(n.order_id)) continue;
      const existing = map.get(n.order_id);
      const label = n.type === 'item_flagged_by_picker' ? 'Flagged' : inferSalesUpdateLabel(n.body);
      if (!existing || new Date(n.created_at).getTime() > new Date(existing.created_at).getTime()) {
        map.set(n.order_id, { id: n.id, label, created_at: n.created_at });
      }
    }
    return map;
  }, [notifications]);

  const openOrder = useCallback(
    async (orderId: number) => {
      setSelectedOrderId(orderId);
      // Best-effort: mark any unread sales updates for this order as read.
      const toRead = notifications.filter((n) => {
        if (n.read_at !== null) return false;
        if (n.order_id !== orderId) return false;
        return n.type === 'order_update_for_sales' || n.type === 'item_flagged_by_picker';
      });
      await Promise.allSettled(toRead.map((n) => markRead(n.id)));
    },
    [markRead, notifications],
  );

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
              salesUpdateLabel={unreadSalesUpdatesByOrderId.get(order.id)?.label ?? null}
              onTap={() => void openOrder(order.id)}
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
