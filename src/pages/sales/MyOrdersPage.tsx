import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CaretDown, CaretUp, Check, Copy, Package, Trash, Warning } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useOrders } from '../../hooks/useOrders';
import { useOrderDetail } from '../../hooks/useOrderDetail';
import { useWorkClaim } from '../../hooks/useWorkClaim';
import { useBillingCustomerUpdate } from '../../hooks/useBillingCustomerUpdate';
import { usePendingItems } from '../../hooks/usePendingItems';
import { useUserNotifications } from '../../hooks/useUserNotifications';
import { Card, BottomSheet, StatusBadge, EmptyState, Skeleton } from '../../components/shared';
import {
  accountHoldDisplayNote,
  isAccountHold,
} from '../../lib/billing/rejectionKind';
import type { Order, OrderItem, OrderWithItems, PendingItem } from '../../types';

import { formatCurrency, formatTimeAgo } from '../../utils/formatters';
import { buildBillingCustomerUpdate } from '../../lib/buildBillingCustomerUpdate';
import { whatsappPrefilledUrl } from '../../lib/buildOrderCustomerMessage';
import {
  isPendingRecoveryActionable,
  pendingRecoveryBadgeClasses,
  pendingRecoveryHelpText,
  pendingRecoveryLabel,
} from '../../lib/pendingRecovery';
import { supabase } from '../../lib/supabase/client';
import { SalesEditAddLineSheet } from './SalesEditAddLineSheet';

const SALES_CLAIM_MESSAGES: Record<string, string> = {
  locked_by_billing: 'Billing is reviewing this order. Try again when they finish.',
  not_owner: 'Only the salesperson on this order can edit lines.',
  not_submitted: 'This order is no longer in submitted status.',
  already_claimed: 'Another session holds this order.',
  'User not found or inactive': 'Your session is invalid. Sign in again.',
  'Order not found': 'Order could not be found.',
  'Invalid stage': 'Cannot start edit.',
};

const REMOVE_SALES_LINE_MESSAGES: Record<string, string> = {
  claim_lost: 'Edit lock lost — tap Done editing and try again.',
  line_not_found: 'That line is no longer on the order.',
  line_order_mismatch: 'That line does not belong to this order.',
  order_not_found: 'Order could not be found.',
  not_submitted: 'This order cannot be edited anymore.',
  not_owner: 'You cannot remove lines on this order.',
  invalid_salesperson: 'Your user cannot edit orders.',
  last_line: 'Cannot remove the last line — ask billing to reject the order instead.',
  submit_failed: 'Could not remove line. Try again.',
};

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
  if (t.includes('*billed:*') || t.includes('billed items as of')) return 'Billed';
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

function isOrderOnAccountHold(order: Order | OrderWithItems): boolean {
  return isAccountHold(order);
}

function badgeStatusForOrder(order: Order | OrderWithItems): Order['workflow_status'] {
  return isWholeOrderRejected(order) ? 'rejected' : order.workflow_status;
}

function formatRejectReason(order: Order | OrderWithItems): string | null {
  if (isOrderOnAccountHold(order)) {
    return accountHoldDisplayNote(order.notes);
  }
  const raw = order.notes?.trim();
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
  const authoritativePendingQty = Math.min(
    item.qty_requested,
    Math.max(pendingQtyTotal, item.qty_po ?? 0),
  );
  if (item.qty_approved !== null && item.qty_approved !== undefined) {
    return Math.max(
      0,
      Math.min(item.qty_approved, item.qty_requested - authoritativePendingQty),
    );
  }
  if (authoritativePendingQty > 0) return Math.max(0, item.qty_requested - authoritativePendingQty);
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

function pendingRecoverySortKey(status: PendingItem['recovery_status']): number {
  if (status === 'back_in_stock') return 0;
  if (status === 'needs_checked') return 1;
  if (status === 'waiting_stock') return 2;
  return 3;
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
      pendingExtra = [...arr].sort(
        (a, b) => pendingRecoverySortKey(a.recovery_status) - pendingRecoverySortKey(b.recovery_status),
      )[0]!;
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

function RecoveryStatusTag({
  status,
}: {
  status: PendingItem['recovery_status'];
}): React.JSX.Element {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-px font-ds-micro font-semibold leading-tight ${pendingRecoveryBadgeClasses(status)}`}
    >
      {pendingRecoveryLabel(status)}
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
  recoveryStatus,
  recoveryHelp,
  actions,
  extraFooter,
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
  recoveryStatus?: PendingItem['recovery_status'] | null;
  recoveryHelp?: string | null;
  actions?: React.ReactNode;
  extraFooter?: React.ReactNode;
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
          {recoveryStatus && (
            <>
              {' '}
              <RecoveryStatusTag status={recoveryStatus} />
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
      {recoveryHelp && (
        <p className="text-xs text-[var(--content-tertiary)] leading-snug">{recoveryHelp}</p>
      )}
      {actions ? <div className="flex flex-wrap gap-2 pt-1">{actions}</div> : null}
      {extraFooter ? <div className="pt-2">{extraFooter}</div> : null}
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
          <StatusBadge
            status={badgeStatusForOrder(order)}
            rejectionKind={order.rejection_kind}
          />
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

function RecoveryActionButton({
  children,
  onClick,
  disabled,
  variant = 'secondary',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const className =
    variant === 'primary'
      ? 'border-transparent bg-[var(--role-primary)] text-[var(--role-content)]'
      : variant === 'danger'
        ? 'border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]'
        : 'border-[var(--border-opaque)] bg-[var(--bg-primary)] text-[var(--content-primary)]';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
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
  const queryClient = useQueryClient();
  const toast = useToast();
  const { userId, userName } = useAuth();
  const { data: order, isLoading } = useOrderDetail(orderId);
  const { data: billingUpdate } = useBillingCustomerUpdate({
    orderId,
    enabled: isOpen && orderId !== null,
  });
  const { data: pending } = usePendingItems({
    orderId,
    status: 'pending',
    enabled: orderId !== null,
  });
  const [messageCopied, setMessageCopied] = useState(false);
  const [showMessagePreview, setShowMessagePreview] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [addLineOpen, setAddLineOpen] = useState(false);

  const {
    claimId: salesEditClaimId,
    claim: claimSalesEdit,
    release: releaseSalesEdit,
  } = useWorkClaim(orderId, 'sales_edit');

  useEffect(() => {
    void releaseSalesEdit();
    setEditMode(false);
    setAddLineOpen(false);
  }, [orderId, releaseSalesEdit]);

  const recoveryActionMutation = useMutation({
    mutationFn: async ({
      pendingItemId,
      action,
    }: {
      pendingItemId: number;
      action: 'send_to_billing' | 'keep_pending' | 'customer_declined';
    }) => {
      const { error } = await supabase.rpc('process_pending_recovery_action', {
        p_pending_item_id: pendingItemId,
        p_action: action,
        p_actor_user_id: userId,
        p_actor_name: userName,
      });

      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['pending-items'] });
      queryClient.invalidateQueries({ queryKey: ['sales-pending-recovery'] });
      queryClient.invalidateQueries({ queryKey: ['order'] });

      if (vars.action === 'send_to_billing') {
        toast.success('Sent back to billing for review');
        return;
      }
      if (vars.action === 'keep_pending') {
        toast.info('Left pending until the next stock/customer check');
        return;
      }
      toast.info('Removed this pending line from follow-up');
    },
    onError: () => {
      toast.error('Failed to update pending follow-up');
    },
  });

  const removeLineMutation = useMutation({
    mutationFn: async (orderItemId: number) => {
      if (!orderId || !salesEditClaimId || !userId) throw new Error('Missing edit lock');
      const { data, error } = await supabase.rpc('remove_sales_submitted_line', {
        p_order_item_id: orderItemId,
        p_claim_id: salesEditClaimId,
        p_user_id: userId,
      });
      if (error) throw error;
      const payload = data as { success?: boolean; error?: string };
      if (!payload?.success) {
        const code = typeof payload.error === 'string' ? payload.error : 'unknown';
        throw new Error(REMOVE_SALES_LINE_MESSAGES[code] ?? code);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      void queryClient.invalidateQueries({ queryKey: ['pending-items'] });
      void queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      toast.success('Line removed');
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : 'Could not remove line');
    },
  });

  const sheetRows = useMemo(
    () => mergeOrderLinesAndPending(order?.items, pending),
    [order?.items, pending],
  );

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
  const isOnAccountHold = order ? isOrderOnAccountHold(order) : false;
  const rejectReason = order ? formatRejectReason(order) : null;
  const liveBillingPreview = useMemo(() => {
    if (!order || !billingUpdate) return null;
    return buildBillingCustomerUpdate({
      orderNumber: order.order_number,
      customerName: order.customer_name,
      businessName: import.meta.env.VITE_BUSINESS_DISPLAY_NAME,
      date: billingDateStr ? new Date(billingDateStr) : new Date(),
      lines: sheetRows
        .filter((row): row is Extract<OrderSheetRow, { kind: 'line' }> => row.kind === 'line')
        .map((row) => {
          const billed = billedUnits(
            row.item,
            isBillingStockRejection(row.item),
            row.pendingQtyTotal,
          );
          const authoritativePendingQty = Math.min(
            row.item.qty_requested,
            Math.max(row.pendingQtyTotal, row.item.qty_po ?? 0),
          );
          return {
            itemId: row.item.item_id,
            name: row.item.item_name,
            qtyRequested: row.item.qty_requested,
            qtyBilled: billed,
            qtyPending: authoritativePendingQty,
          };
        }),
    });
  }, [billingDateStr, billingUpdate, order, sheetRows]);
  const billingMessage = liveBillingPreview?.messageText ?? billingUpdate?.message_text?.trim() ?? '';
  const billingSummaryLines = liveBillingPreview?.summary.lines ?? billingUpdate?.summary_json?.lines ?? [];
  const billedLineCount = billingSummaryLines.filter((line) => line.qty_billed > 0).length;
  const pendingLineCount = billingSummaryLines.filter((line) => line.qty_pending > 0).length;
  const billingUpdateTime = billingUpdate?.created_at
    ? formatTimeAgo(billingUpdate.created_at)
    : null;
  const sendUrl = billingMessage ? whatsappPrefilledUrl(billingMessage) : null;

  const handleCopyMessage = useCallback(async () => {
    if (!billingMessage) return;
    try {
      await navigator.clipboard.writeText(billingMessage);
      setMessageCopied(true);
      window.setTimeout(() => setMessageCopied(false), 2000);
    } catch {
      setMessageCopied(false);
    }
  }, [billingMessage]);

  const handleSendToCustomer = useCallback(() => {
    if (!sendUrl) return;
    window.open(sendUrl, '_blank', 'noopener,noreferrer');
  }, [sendUrl]);

  const handleSheetClose = useCallback(async () => {
    await releaseSalesEdit();
    setEditMode(false);
    setAddLineOpen(false);
    onClose();
  }, [releaseSalesEdit, onClose]);

  const handleStartEdit = useCallback(async () => {
    const r = await claimSalesEdit();
    if (!r.success) {
      const raw = r.reason ?? '';
      const msg = (SALES_CLAIM_MESSAGES[raw] ?? raw) || 'Could not start editing';
      toast.error(msg);
      return;
    }
    setEditMode(true);
  }, [claimSalesEdit, toast]);

  const handleDoneEdit = useCallback(async () => {
    await releaseSalesEdit();
    setEditMode(false);
    setAddLineOpen(false);
    await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    await queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
    toast.success('Finished editing');
  }, [releaseSalesEdit, queryClient, orderId, toast]);

  const canEditLines = useMemo(() => {
    if (!order || userId == null) return false;
    return (
      order.workflow_status === 'submitted' &&
      order.salesperson_user_id != null &&
      order.salesperson_user_id === userId
    );
  }, [order, userId]);

  if (!isOpen) return null;

  return (
    <BottomSheet isOpen={isOpen} onClose={() => void handleSheetClose()} closeOnly>
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
              <p className={`mt-2 text-sm whitespace-pre-wrap ${isOnAccountHold ? 'text-[var(--content-warning)]' : 'text-[var(--content-negative)]'}`}>
                <span className="font-semibold">{isOnAccountHold ? 'On hold:' : 'Reason:'}</span> {rejectReason}
              </p>
            )}
            {!isRejected && order.notes && (
              <p className="mt-2 text-sm text-[var(--content-warning)] whitespace-pre-wrap">
                {order.notes}
              </p>
            )}
          </div>

          {canEditLines && !editMode && (
            <div className="mb-4">
              <button
                type="button"
                onClick={() => void handleStartEdit()}
                className="w-full rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-secondary)] py-3 text-sm font-semibold text-[var(--content-primary)] hover:bg-[var(--bg-tertiary)]"
              >
                Edit order lines
              </button>
              <p className="mt-1.5 text-center text-xs text-[var(--content-tertiary)]">
                Pauses billing until you tap Done editing
              </p>
            </div>
          )}

          {editMode && (
            <div className="mb-4 space-y-3">
              <div className="rounded-xl border border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] px-3 py-2">
                <p className="text-sm font-semibold text-[var(--content-accent)]">Live Queue paused</p>
                <p className="mt-0.5 text-xs text-[var(--content-secondary)]">
                  Billing cannot claim this order while you edit lines.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setAddLineOpen(true)}
                  className="min-h-[44px] flex-1 min-w-[120px] rounded-xl bg-[var(--role-primary)] py-2.5 text-sm font-semibold text-[var(--role-content)]"
                >
                  Add line
                </button>
                <button
                  type="button"
                  onClick={() => void handleDoneEdit()}
                  className="min-h-[44px] flex-1 min-w-[120px] rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-primary)] py-2.5 text-sm font-semibold text-[var(--content-primary)]"
                >
                  Done editing
                </button>
              </div>
            </div>
          )}

          {billingMessage && (
            <div className="mb-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--content-primary)]">Billing update ready</p>
                  <p className="text-xs text-[var(--content-secondary)]">
                    {billedLineCount} billed line{billedLineCount === 1 ? '' : 's'}
                    {pendingLineCount > 0 ? ` · ${pendingLineCount} pending` : ' · fully billed'}
                    {billingUpdateTime ? ` · ${billingUpdateTime}` : ''}
                  </p>
                </div>
                <div className="inline-flex items-center rounded-full bg-embed-whatsapp-tint px-2.5 py-1 text-xs font-semibold text-embed-whatsapp">
                  Ready to send
                </div>
              </div>

              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={handleSendToCustomer}
                  className="flex-[1.3] rounded-xl bg-embed-whatsapp-solid px-4 py-3 text-sm font-semibold text-white hover:opacity-90"
                >
                  <span className="inline-flex items-center justify-center">Send update</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowMessagePreview((prev) => !prev)}
                  className="rounded-xl border border-[var(--border-opaque)] bg-[var(--bg-primary)] px-4 py-3 text-sm font-semibold text-[var(--content-primary)] hover:bg-[var(--bg-tertiary)]"
                >
                  <span className="inline-flex items-center justify-center gap-2">
                    {showMessagePreview ? <CaretUp size={16} weight="bold" /> : <CaretDown size={16} weight="bold" />}
                    {showMessagePreview ? 'Hide preview' : 'Preview'}
                  </span>
                </button>
              </div>

              <p className="mt-2 text-xs text-[var(--content-secondary)]">
                WhatsApp opens with this message — search your chats, pick the party, then send.
              </p>

              {showMessagePreview && (
                <div className="mt-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--embed-whatsapp-bg)] p-4">
                  <div className="mb-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleCopyMessage()}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                        messageCopied
                          ? 'border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]'
                          : 'border-[var(--border-opaque)] bg-[var(--bg-primary)] text-[var(--content-primary)] hover:bg-[var(--bg-tertiary)]'
                      }`}
                    >
                      {messageCopied ? <Check size={14} weight="bold" /> : <Copy size={14} weight="bold" />}
                      {messageCopied ? 'Copied' : 'Copy message'}
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--embed-whatsapp-fg)]">
                    {billingMessage}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Items list ────────────────────────────── */}
          <div className="divide-y divide-[var(--border-subtle)] border-y border-[var(--border-subtle)]">
            {sheetRows.map((row) => {
              if (row.kind === 'pending_only') {
                const pi = row.pi;
                const isBusy =
                  recoveryActionMutation.isPending &&
                  recoveryActionMutation.variables?.pendingItemId === pi.id;
                const recoveryActions = isPendingRecoveryActionable(pi.recovery_status) ? (
                  <>
                    <RecoveryActionButton
                      variant="primary"
                      disabled={isBusy}
                      onClick={() =>
                        recoveryActionMutation.mutate({
                          pendingItemId: pi.id,
                          action: 'send_to_billing',
                        })
                      }
                    >
                      Customer confirmed → send to billing
                    </RecoveryActionButton>
                    <RecoveryActionButton
                      disabled={isBusy}
                      onClick={() =>
                        recoveryActionMutation.mutate({
                          pendingItemId: pi.id,
                          action: 'keep_pending',
                        })
                      }
                    >
                      Keep pending
                    </RecoveryActionButton>
                    <RecoveryActionButton
                      variant="danger"
                      disabled={isBusy}
                      onClick={() =>
                        recoveryActionMutation.mutate({
                          pendingItemId: pi.id,
                          action: 'customer_declined',
                        })
                      }
                    >
                      Customer no longer wants it
                    </RecoveryActionButton>
                  </>
                ) : null;

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
                    recoveryStatus={pi.recovery_status}
                    recoveryHelp={pendingRecoveryHelpText(pi.recovery_status)}
                    actions={recoveryActions}
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
              const recoveryPending = row.pendingExtra;
              const isBusy =
                recoveryPending != null &&
                recoveryActionMutation.isPending &&
                recoveryActionMutation.variables?.pendingItemId === recoveryPending.id;
              const recoveryActions =
                recoveryPending && isPendingRecoveryActionable(recoveryPending.recovery_status) ? (
                  <>
                    <RecoveryActionButton
                      variant="primary"
                      disabled={isBusy}
                      onClick={() =>
                        recoveryActionMutation.mutate({
                          pendingItemId: recoveryPending.id,
                          action: 'send_to_billing',
                        })
                      }
                    >
                      Customer confirmed → send to billing
                    </RecoveryActionButton>
                    <RecoveryActionButton
                      disabled={isBusy}
                      onClick={() =>
                        recoveryActionMutation.mutate({
                          pendingItemId: recoveryPending.id,
                          action: 'keep_pending',
                        })
                      }
                    >
                      Keep pending
                    </RecoveryActionButton>
                    <RecoveryActionButton
                      variant="danger"
                      disabled={isBusy}
                      onClick={() =>
                        recoveryActionMutation.mutate({
                          pendingItemId: recoveryPending.id,
                          action: 'customer_declined',
                        })
                      }
                    >
                      Customer no longer wants it
                    </RecoveryActionButton>
                  </>
                ) : null;

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
                  recoveryStatus={recoveryPending?.recovery_status ?? null}
                  recoveryHelp={
                    recoveryPending ? pendingRecoveryHelpText(recoveryPending.recovery_status) : null
                  }
                  actions={recoveryActions}
                  extraFooter={
                    editMode ? (
                      <button
                        type="button"
                        disabled={removeLineMutation.isPending || !salesEditClaimId}
                        onClick={() => {
                          if (!window.confirm(`Remove “${item.item_name}” from this order?`)) return;
                          removeLineMutation.mutate(item.id);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] px-3 py-2 text-xs font-semibold text-[var(--content-negative)] disabled:opacity-50"
                      >
                        <Trash size={14} weight="bold" />
                        Remove line
                      </button>
                    ) : undefined
                  }
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

          <SalesEditAddLineSheet
            isOpen={addLineOpen}
            onClose={() => setAddLineOpen(false)}
            orderId={order.id}
            stockLocationCode={order.stock_location_code}
            claimId={salesEditClaimId}
            userId={userId}
            existingItems={(order.items ?? []).map((i) => ({
              item_id: i.item_id,
              qty_requested: i.qty_requested,
              item_name: i.item_name,
            }))}
            onAdded={() => {
              void queryClient.invalidateQueries({ queryKey: ['order', order.id] });
            }}
          />
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
    /** Cap payload: newest-first; keeps list refetches small. Realtime + default keep-alive stay snappy. */
    limit: 500,
  });
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const { items: notifications, markRead } = useUserNotifications(userId);

  const unreadSalesUpdatesByOrderId = useMemo(() => {
    const map = new Map<number, { id: number; label: string; created_at: string }>();
    for (const n of notifications) {
      if (n.read_at !== null) continue;
      if (
        n.type !== 'order_update_for_sales' &&
        n.type !== 'item_flagged_by_picker' &&
        n.type !== 'pending_item_back_in_stock'
      ) {
        continue;
      }
      if (typeof n.order_id !== 'number' || !Number.isFinite(n.order_id)) continue;
      const existing = map.get(n.order_id);
      const label =
        n.type === 'item_flagged_by_picker'
          ? 'Flagged'
          : n.type === 'pending_item_back_in_stock'
            ? 'Back in stock'
            : inferSalesUpdateLabel(n.body);
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
        return (
          n.type === 'order_update_for_sales' ||
          n.type === 'item_flagged_by_picker' ||
          n.type === 'pending_item_back_in_stock'
        );
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
