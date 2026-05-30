import { supabase } from '../supabase/client';
import { formatSupabaseUserMessage } from '../supabase/formatUserMessage';
import { applyWarehousePickSkipForPoOnlyLine } from '../cartSupply';
import type { FulfillmentPath, OrderItem, OrderPriority, StockLocationCode } from '../../types';
import {
  billingApprovedQty,
  countEffectivePickLinesAfterBilling,
  deriveBillLineOutcome,
  resolveFulfillmentPathAfterBilling,
} from './billLineOutcome';
import type { BillingLiveQueueFlag } from './liveQueueDraft';
import { persistAndNotifySalesOrderUpdate } from './notifySalesOrderUpdate';

export const BILLING_OOS_FLAG_REASON = 'Out of Stock (Billing)';

export type BillingApproveOrderContext = {
  id: number;
  order_number: string;
  customer_id: number | null;
  customer_name: string;
  salesperson_name: string;
  stock_location_code?: StockLocationCode | null;
  priority?: OrderPriority;
};

export type BillingApproveLineResult = {
  item: OrderItem;
  approvedQty: number;
  flag: BillingLiveQueueFlag | undefined;
  finalState: ReturnType<typeof deriveBillLineOutcome>;
};

export type ApplyBillingApproveParams = {
  order: BillingApproveOrderContext;
  visibleLines: OrderItem[];
  removedLines?: OrderItem[];
  flags: Record<number, BillingLiveQueueFlag>;
  requestedFulfillmentPath: FulfillmentPath;
  reviewer: string;
  userId: number;
  /** When true, inserts billing_customer_updates and notifies sales. */
  notifySales?: boolean;
};

export type ApplyBillingApproveResult = {
  lineResults: BillingApproveLineResult[];
  effectivePickLineCount: number;
  resolvedFulfillmentPath: FulfillmentPath;
  clientPathDowngraded: boolean;
  customerMessageText: string;
  customerUpdateId: number;
  nextItemCount: number;
  nextTotalValue: number;
};

export function buildLineResults(
  visibleLines: OrderItem[],
  flags: Record<number, BillingLiveQueueFlag>,
): BillingApproveLineResult[] {
  return visibleLines.map((item) => {
    const flag = flags[item.id];
    const approvedQty = billingApprovedQty(item.qty_requested, flag);
    const finalState = deriveBillLineOutcome(item, approvedQty, flag);
    return { item, approvedQty, flag, finalState };
  });
}

/** Map compact queue machine decisions to live-queue-style flags for pick-target math. */
export function flagsFromCompactDecisions(
  items: OrderItem[],
  decisions: Record<number, string | undefined>,
): Record<number, BillingLiveQueueFlag> {
  const flags: Record<number, BillingLiveQueueFlag> = {};
  for (const item of items) {
    const decision = decisions[item.id];
    if (decision === 'drop_entirely') {
      flags[item.id] = { type: 'no_stock' };
      continue;
    }
    if (decision === 'bill_available_po_rest') {
      const availableQty = Math.max(0, item.qty_shippable ?? 0);
      if (availableQty < item.qty_requested) {
        flags[item.id] = { type: 'partial', availableQty };
      }
    }
  }
  return flags;
}

export async function applyBillingApprove(
  params: ApplyBillingApproveParams,
): Promise<ApplyBillingApproveResult> {
  const {
    order,
    visibleLines,
    removedLines = [],
    flags,
    requestedFulfillmentPath,
    reviewer,
    userId,
    notifySales = true,
  } = params;

  if (visibleLines.length === 0) {
    throw new Error('Cannot approve an empty order. Use Reject instead.');
  }

  const nowIso = new Date().toISOString();

  for (const line of removedLines) {
    const { error: evErr } = await supabase.from('order_events').insert({
      order_id: order.id,
      event_type: 'billing_line_removed',
      actor_user_id: userId,
      stage: 'billing',
      payload: {
        order_item_id: line.id,
        item_id: line.item_id,
        item_name: line.item_name,
        qty_requested: line.qty_requested,
      },
    });
    if (evErr) throw evErr;

    const { error: pendErr } = await supabase
      .from('pending_items')
      .update({
        status: 'cancelled',
        resolved_at: nowIso,
        resolved_by: reviewer,
        note: 'Line removed by billing',
      })
      .eq('order_id', order.id)
      .eq('item_id', line.item_id)
      .eq('status', 'pending');
    if (pendErr) throw pendErr;

    const { error: delErr } = await supabase.from('order_items').delete().eq('id', line.id);
    if (delErr) throw delErr;
  }

  const lineResults = buildLineResults(visibleLines, flags);

  const effectivePickLineCount = countEffectivePickLinesAfterBilling(visibleLines, flags);
  const resolvedFulfillmentPath = resolveFulfillmentPathAfterBilling(
    requestedFulfillmentPath,
    order.stock_location_code,
    effectivePickLineCount,
  );
  const clientPathDowngraded =
    requestedFulfillmentPath === 'warehouse_pick' &&
    resolvedFulfillmentPath === 'direct_bill';

  const updateResponses = await Promise.all(
    lineResults.map(({ item, finalState, flag }) => {
      const qty_shippable = finalState.qtyBilled;
      const qty_po = Math.max(0, item.qty_requested - qty_shippable);
      const update: Record<string, unknown> = {
        qty_approved: qty_shippable,
        qty_po,
        qty_shippable,
        qty_requested: item.qty_requested,
        price_quoted: item.price_quoted,
      };
      if (flag?.type === 'no_stock') {
        update.flag_reason = BILLING_OOS_FLAG_REASON;
      }
      applyWarehousePickSkipForPoOnlyLine(update, item, {
        fulfillmentPath: resolvedFulfillmentPath,
        currentState: item.state,
      });
      return supabase.from('order_items').update(update).eq('id', item.id);
    }),
  );
  const updateError = updateResponses.find((r) => r.error)?.error;
  if (updateError) throw new Error(formatSupabaseUserMessage(updateError));

  const { error: resolvePendingError } = await supabase
    .from('pending_items')
    .update({
      status: 'resolved',
      resolved_at: nowIso,
      resolved_by: reviewer,
    })
    .eq('order_id', order.id)
    .eq('status', 'pending');
  if (resolvePendingError) throw resolvePendingError;

  const pendingRows = lineResults
    .map(({ item, finalState }) => {
      if (finalState.qtyPending <= 0 || !finalState.pendingSource || !finalState.pendingNote) {
        return null;
      }
      return {
        order_id: order.id,
        order_number: order.order_number,
        customer_id: order.customer_id,
        customer_name: order.customer_name,
        item_id: item.item_id,
        item_name: item.item_name,
        qty_pending: finalState.qtyPending,
        source: finalState.pendingSource,
        created_by: reviewer,
        note: finalState.pendingNote,
        stock_location_code:
          order.stock_location_code ?? item.stock_location_code ?? 'main_store',
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  if (pendingRows.length > 0) {
    const { error: pendingError } = await supabase.from('pending_items').insert(pendingRows);
    if (pendingError) throw pendingError;
  }

  const nextItemCount = lineResults.length;
  const nextTotalValue = lineResults.reduce((acc, { item, finalState }) => {
    const rate = Number(item.price_quoted ?? 0);
    return acc + rate * Math.max(0, finalState.qtyBilled);
  }, 0);

  const { error: orderTotalsErr } = await supabase
    .from('orders')
    .update({
      item_count: nextItemCount,
      total_value: nextTotalValue,
    })
    .eq('id', order.id);
  if (orderTotalsErr) throw orderTotalsErr;

  const { customerUpdateId, messageText: customerMessageText } =
    await persistAndNotifySalesOrderUpdate({
      orderId: order.id,
      orderNumber: order.order_number,
      customerName: order.customer_name,
      salespersonName: order.salesperson_name,
      createdBy: reviewer,
      notifySales,
      lines: lineResults.map(({ item, finalState }) => ({
        itemId: item.item_id,
        name: item.item_name,
        qtyRequested: item.qty_requested,
        qtyBilled: finalState.qtyBilled,
        qtyPending: finalState.qtyPending,
      })),
    });

  return {
    lineResults,
    effectivePickLineCount,
    resolvedFulfillmentPath,
    clientPathDowngraded,
    customerMessageText,
    customerUpdateId,
    nextItemCount,
    nextTotalValue,
  };
}
