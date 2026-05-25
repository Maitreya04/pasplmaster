import { supabase } from '../supabase/client';
import { formatSupabaseUserMessage } from '../supabase/formatUserMessage';

export interface StartPickingResult {
  success?: boolean;
  reason?: string;
  claim_id?: number;
  already_started?: boolean;
}

export async function startPicking(options: {
  orderId: number;
  userId: number;
}): Promise<StartPickingResult> {
  const { data, error } = await supabase.rpc('start_picking', {
    p_order_id: options.orderId,
    p_user_id: options.userId,
  });

  if (error) throw new Error(formatSupabaseUserMessage(error));
  return (data ?? {}) as StartPickingResult;
}

export function startPickingErrorMessage(result: StartPickingResult): string {
  if (result.reason === 'not_your_claim') {
    return 'This order is assigned to another picker.';
  }
  if (result.reason === 'no_claim') {
    return 'Claim this order from the queue before starting.';
  }
  if (result.reason === 'not_ready') {
    return 'This order is no longer ready for picking.';
  }
  if (result.reason === 'picking_in_progress') {
    return 'Another picker is already working on this order.';
  }
  if (result.reason === 'direct_bill') {
    return 'This order skips warehouse picking.';
  }
  if (result.reason === 'order_not_found') {
    return 'Order not found.';
  }
  return result.reason ?? 'Failed to start picking';
}
