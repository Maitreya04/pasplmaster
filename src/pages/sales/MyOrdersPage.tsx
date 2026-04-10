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

const BILLING_OOS_FLAG_REASON = 'Out of Stock (Billing)';
const TEXT_STATUS_PARTIAL = 'text-[color:var(--content-warning-on-light)]';
const TEXT_STATUS_CRITICAL = 'text-[color:var(--content-negative)]';

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

function isWholeOrderRejected(order: Order | OrderWithItems): boolean {
  if (order.workflow_status === 'rejected') return true;
  if (order.workflow_status !== 'flagged') return false;
  const note = order.notes?.toLowerCase() ?? '';
  if (note.includes('reject') || note.includes('account lock')) return true;
  if (!('items' in order) || !Array.isArray(order.items)) return false;
  return order.items.length > 0 && order.items.every((item) => item.state !== 'flagged');
}

function badgeStatusForOrder(order: Order | OrderWithItems): Order['workflow_status'] {
  return isWholeOrderRejected(order) ? 'rejected' : order.workflow_status;
}

function formatRejectReason(notes: string | null | undefined): string | null {
  const raw = notes?.trim();
  if (!raw) return null;
  const normalized = raw.replace(/\s+/g, ' ');
  if (normalized.toLowerCase().includes('account lock')) {
    return 'Account locked. Billing cannot process this order until the account is unlocked.';
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

// ─── Merge helpers ────────────────────────────────────────────

type OrderSheetRow =
  | { kind: 'line'; item: OrderItem; pendingExtra: PendingItem | null; pendingQtyTotal: number }
  | { kind: 'pending_only'; pi: PendingItem };

function billedUnits(item: OrderItem, billingOos: boolean, pendingQtyTotal: number): number {
  if (billingOos) return 0;
  if (item.qty_approved !== null && item.qty_approved !== undefined) return item.qty_approved;
  if (pendingQtyTotal > 0) return Math.max(0, item.qty_requested - pendingQtyTotal);
  return item.qty_requested;
}

type StockUiVariant = 'ok' | 'partial' | 'critical' | 'neutral';

function stockUiVariant(
  item: OrderItem,
  billingOos: boolean,
  pickerFlagged: boolean,
  pendingQtyTotal: number,
): StockUiVariant {
  if (pickerFlagged) return 'neutral';
  const billed = billedUnits(item, billingOos, pendingQtyTotal);
  const gap = Math.max(0, item.qty_requested - billed);
  if (billingOos) return 'critical';
  if (gap === 0) return pendingQtyTotal > 0 ? 'partial' : 'ok';
  if (billed === 0) return 'critical';
  return 'partial';
}

function sortKey(item: OrderItem, billingOos: boolean, pickerFlagged: boolean, pendingQtyTotal: number): number {
  const v = stockUiVariant(item, billingOos, pickerFlagged, pendingQtyTotal);
  return v === 'critical' ? 0 : v === 'partial' ? 1 : v === 'neutral' ? 2 : 3;
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
    if (!consumed.has(p.id)) rows.push({ kind: 'pending_only', pi: p });
  }

  return rows.sort((a, b) => {
    const ra =
      a.kind === 'line'
        ? sortKey(a.item, isBillingStockRejection(a.item), isPickerOrNonBillingFlag(a.item), a.pendingQtyTotal)
        : 0;
    const rb =
      b.kind === 'line'
        ? sortKey(b.item, isBillingStockRejection(b.item), isPickerOrNonBillingFlag(b.item), b.pendingQtyTotal)
        : 0;
    return ra - rb;
  });
}

// ─── Tiny inline tag ──────────────────────────────────────────

function StatusTag({ variant, pickerFlagged }: { variant: StockUiVariant; pickerFlagged: boolean }): React.JSX.Element | null {
  if (variant === 'ok' && !pickerFlagged) return null;

  if (pickerFlagged) {
    return (
      <span className="inline-flex shrink-0 items-center rounded px-1.5 py-px font-ds-micro font-semibold bg-[var(--bg-tertiary)] text-[var(--content-secondary)] leading-tight">
        Warehouse
      </span>
    );
  }
  if (variant === 'partial') {
    return (
      <span
        className={`inline-flex shrink-0 items-center rounded px-1.5 py-px font-ds-micro font-semibold leading-tight bg-[var(--bg-warning-subtle)] ${TEXT_STATUS_PARTIAL}`}
      >
        Partial
      </span>
    );
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-px font-ds-micro font-semibold leading-tight bg-[var(--bg-negative-subtle)] ${TEXT_STATUS_CRITICAL}`}
    >
      Out of Stock
    </span>
  );
}

// ─── Single flat line row ─────────────────────────────────────

function OrderLineRow({
  name,
  variant,
  pickerFlagged,
  billed,
  requested,
  lineTotal,
  poQty,
  gap,
  billingOos,
  flagNotes,
}: {
  name: string;
  variant: StockUiVariant;
  pickerFlagged: boolean;
  billed: number;
  requested: number;
  lineTotal: number;
  poQty?: number;
  gap: number;
  billingOos: boolean;
  flagNotes?: string | null;
}): React.JSX.Element {
  const qtyColor =
    pickerFlagged
      ? 'text-[var(--content-primary)]'
      : variant === 'critical'
        ? TEXT_STATUS_CRITICAL
        : variant === 'partial'
          ? TEXT_STATUS_PARTIAL
          : 'text-[var(--content-primary)]';

  const amountStr = lineTotal > 0 ? formatCurrency(lineTotal) : '₹0';
  const poCount = typeof poQty === 'number' && poQty > 0 ? poQty : 0;

  return (
    <div className="py-3 space-y-1">
      {/* name + tag ……… amount */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <span className="font-ds-prose font-semibold leading-snug text-[var(--content-primary)] normal-case">
            {name}
          </span>
          {(variant !== 'ok' || pickerFlagged) && (
            <>
              {' '}
              <StatusTag variant={variant} pickerFlagged={pickerFlagged} />
            </>
          )}
        </div>
        <span className="font-mono text-base font-bold tabular-nums text-[var(--content-primary)] shrink-0 pt-px">
          {amountStr}
        </span>
      </div>

      {/* qty ratio */}
      <p className={`font-mono text-base tabular-nums leading-none ${qtyColor}`}>
        <span className="font-bold">{billed}</span>
        <span className="text-[var(--content-quaternary)] font-normal">/</span>
        <span className="font-bold">{requested}</span>
        <span className="ml-1.5 font-sans text-xs font-normal text-[var(--content-secondary)]">pcs billed</span>
      </p>

      {/* PO line — bold, attention-grabbing */}
      {gap > 0 && poCount > 0 && (
        <p className="text-xs font-semibold text-[var(--content-primary)] leading-snug">
          {poCount} pcs in PO
        </p>
      )}
      {gap > 0 && poCount === 0 && !billingOos && (
        <p className="text-xs font-semibold text-[var(--content-primary)] leading-snug">
          {gap} pcs in PO
        </p>
      )}

      {flagNotes && (
        <p className="text-xs text-[var(--content-tertiary)] leading-snug">Note: {flagNotes}</p>
      )}
    </div>
  );
}

// ─── Order card (list page) ───────────────────────────────────

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
                <span className="font-ds-label-size font-semibold text-[var(--content-negative)]">
                  {salesUpdateLabel}
                </span>
              </>
            )}
            {order.workflow_status !== 'flagged' &&
              'items' in order &&
              order.items &&
              (order.items as OrderItem[]).some((i: OrderItem) => isBillingStockRejection(i)) && (
                <Warning size={16} weight="fill" className={TEXT_STATUS_CRITICAL} />
              )}
          </div>
          <StatusBadge status={badgeStatusForOrder(order)} />
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

// ─── Order detail sheet ───────────────────────────────────────

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

  const billingDateStr = order?.completed_at ?? order?.approved_at;
  const billingDate = billingDateStr
    ? new Date(billingDateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  const invoiceTotal = order?.items?.some((i: OrderItem) => isBillingStockRejection(i))
    ? (order.items ?? []).reduce((acc: number, line: OrderItem) => {
        if (isBillingStockRejection(line)) return acc;
        const p = line.price_quoted ?? line.price_system ?? 0;
        const q = line.qty_approved ?? line.qty_requested;
        return acc + p * q;
      }, 0)
    : null;
  const isRejected = order ? isWholeOrderRejected(order) : false;
  const rejectReason = formatRejectReason(order?.notes);

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} closeOnly>
      {isLoading ? (
        <Skeleton variant="text" lines={6} />
      ) : order ? (
        <div>
          {/* ── Header: date + party ──────────────────── */}
          <div className="pb-4">
            <p className="font-ds-stat font-bold tabular-nums text-[var(--content-primary)] leading-tight">
              {billingDate ?? 'Not billed yet'}
            </p>

            <p className="mt-2 text-base font-bold text-[var(--content-primary)] leading-snug normal-case">
              {order.customer_name?.trim() || 'Order'}
            </p>
            <p className="mt-0.5 text-sm text-[var(--content-secondary)]">
              <span className="font-mono font-medium">{order.order_number}</span>
              {order.customer_city && (
                <>
                  <span className="mx-1 text-[var(--content-quaternary)]">·</span>
                  {order.customer_city}
                </>
              )}
            </p>
            {isRejected && rejectReason && (
              <p className="mt-2 text-sm text-[var(--content-negative)] whitespace-pre-wrap">
                <span className="font-semibold">Reason:</span> {rejectReason}
              </p>
            )}
            {!isRejected && order.notes && (
              <p className="mt-2 text-sm text-[var(--content-warning)] whitespace-pre-wrap">
                {order.notes}
              </p>
            )}
          </div>

          {/* ── Items list ────────────────────────────── */}
          <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
            {sheetRows.map((row) => {
              if (row.kind === 'pending_only') {
                const pi = row.pi;
                return (
                  <OrderLineRow
                    key={`p-${pi.id}`}
                    name={pi.item_name}
                    variant="critical"
                    pickerFlagged={false}
                    billed={0}
                    requested={pi.qty_pending}
                    lineTotal={0}
                    gap={pi.qty_pending}
                    billingOos={false}
                    flagNotes={pi.note}
                  />
                );
              }

              const item = row.item;
              const price = item.price_quoted ?? item.price_system ?? 0;
              const billingOos = isBillingStockRejection(item);
              const pickerFlagged = isPickerOrNonBillingFlag(item);
              const pendingQtyTotal = row.pendingQtyTotal;
              const billed = billedUnits(item, billingOos, pendingQtyTotal);
              const lineTotal = price * billed;
              const gap = Math.max(0, item.qty_requested - billed);
              const v = stockUiVariant(item, billingOos, pickerFlagged, pendingQtyTotal);

              return (
                <OrderLineRow
                  key={item.id}
                  name={item.item_name}
                  variant={pickerFlagged ? 'neutral' : v}
                  pickerFlagged={pickerFlagged}
                  billed={billed}
                  requested={item.qty_requested}
                  lineTotal={lineTotal}
                  poQty={item.qty_po}
                  gap={gap}
                  billingOos={billingOos}
                  flagNotes={item.flag_notes}
                />
              );
            })}
          </div>

          {/* ── Total ─────────────────────────────────── */}
          <div className="flex items-end justify-between gap-3 pt-4 pb-1">
            <span className="text-sm font-medium text-[var(--content-secondary)]">Invoice total</span>
            <div className="text-right">
              {invoiceTotal !== null && (
                <span className="font-mono text-xs text-[var(--content-tertiary)] line-through mr-2 tabular-nums">
                  {formatCurrency(order.total_value)}
                </span>
              )}
              <span className="font-mono text-2xl font-bold tabular-nums text-[var(--content-primary)]">
                {formatCurrency(invoiceTotal ?? order.total_value)}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </BottomSheet>
  );
}

// ─── Page ─────────────────────────────────────────────────────

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
