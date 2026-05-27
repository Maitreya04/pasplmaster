import { syncLabelMrpFlagForOrderItem } from '../billing/syncLabelMrpFlag';
import { supabase } from '../supabase/client';

export type RevertPickLineMode = 'full' | 'qty_only';

export async function revertPickLine(options: {
  orderId: number;
  claimId: number | null;
  userId: number;
  orderItemId: number;
  mode: RevertPickLineMode;
  restoreQty?: number | null;
}): Promise<{ success: boolean; orderItemId?: number; error?: string }> {
  const { data, error } = await supabase.rpc('revert_pick_line', {
    p_order_id: options.orderId,
    p_claim_id: options.claimId,
    p_user_id: options.userId,
    p_order_item_id: options.orderItemId,
    p_mode: options.mode,
    p_restore_qty: options.restoreQty ?? null,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const payload = data as Record<string, unknown> | null;
  if (!payload || payload.success !== true) {
    return {
      success: false,
      error: typeof payload?.error === 'string' ? payload.error : 'revert_failed',
    };
  }

  const orderItemId =
    payload.order_item_id != null ? Number(payload.order_item_id) : options.orderItemId;

  if (options.mode === 'full') {
    try {
      await syncLabelMrpFlagForOrderItem(orderItemId);
    } catch {
      /* flag sync is best-effort */
    }
  }

  return { success: true, orderItemId };
}
