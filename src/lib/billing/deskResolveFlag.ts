import { supabase } from '../supabase/client';
import type { DeskOrderRow } from '../../hooks/useBillingDeskOrders';
import type { WorkflowStatus } from '../../types';

function isPriceOrStockFlag(reason: string | null | undefined): boolean {
  const lower = (reason ?? '').toLowerCase();
  return (
    lower.includes('price') ||
    lower.includes('mrp') ||
    lower.includes('stock') ||
    lower.includes('out of stock')
  );
}

/** Flags billing can clear in one tap without opening the line editor. */
export function canQuickResolveDeskFlag(order: DeskOrderRow): boolean {
  if (order.pickerFlags.length === 0) {
    return order.workflow_status === 'flagged';
  }
  return order.pickerFlags.every((line) => !isPriceOrStockFlag(line.flagReason));
}

export async function resolveDeskPickerFlags(options: {
  order: Pick<DeskOrderRow, 'id' | 'workflow_status' | 'pickerFlags'>;
  reviewerName: string;
}): Promise<void> {
  const { order, reviewerName } = options;
  const nowIso = new Date().toISOString();
  const itemIds = order.pickerFlags.map((line) => line.orderItemId);

  if (itemIds.length > 0) {
    const { error: itemsError } = await supabase
      .from('order_items')
      .update({
        state: 'picked',
        flag_reason: null,
        flag_notes: null,
        flag_box_price: null,
      })
      .in('id', itemIds);
    if (itemsError) throw itemsError;
  }

  await applyDeskFlagOrderTransition(order.id, order.workflow_status, reviewerName, nowIso);
}

async function applyDeskFlagOrderTransition(
  orderId: number,
  workflowStatus: WorkflowStatus,
  reviewerName: string,
  nowIso: string,
): Promise<void> {
  if (workflowStatus === 'picking') {
    const { error } = await supabase
      .from('orders')
      .update({ reviewer_name: reviewerName })
      .eq('id', orderId);
    if (error) throw error;
    return;
  }

  if (workflowStatus === 'flagged') {
    const { error } = await supabase
      .from('orders')
      .update({
        reviewer_name: reviewerName,
        workflow_status: 'completed',
        priority: 'normal',
        approved_at: nowIso,
        completed_at: nowIso,
        fulfillment_path: 'direct_bill',
      })
      .eq('id', orderId);
    if (error) throw error;
  }
}
