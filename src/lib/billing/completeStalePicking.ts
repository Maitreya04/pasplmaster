import { supabase } from '../supabase/client';
import { formatSupabaseUserMessage } from '../supabase/formatUserMessage';

interface CompleteStalePickingResult {
  success?: boolean;
  reason?: string;
  claimed_by?: string;
  workflow_status?: string;
  has_flags?: boolean;
  flagged_count?: number;
}

export async function billingCompleteStalePicking(options: {
  orderId: number;
  userId: number;
  userName: string | null;
}): Promise<CompleteStalePickingResult> {
  const { data, error } = await supabase.rpc('billing_complete_stale_picking', {
    p_order_id: options.orderId,
    p_actor_user_id: options.userId,
    p_actor_name: options.userName ?? 'Billing',
  });

  if (error) throw new Error(formatSupabaseUserMessage(error));
  return (data ?? {}) as CompleteStalePickingResult;
}

export function stalePickingCompleteErrorMessage(result: CompleteStalePickingResult): string {
  if (result.reason === 'picking_still_active') {
    const who = result.claimed_by ? ` by ${result.claimed_by}` : '';
    return `Picking is still active${who}. Wait for the session to go stale or ask the picker to finish.`;
  }
  if (result.reason === 'not_picking') {
    return 'Order is not in picking status.';
  }
  if (result.reason === 'order_not_found') {
    return 'Order not found.';
  }
  return result.reason ?? 'Failed to complete order';
}

interface ForceCompletePrePickResult {
  success?: boolean;
  reason?: string;
  picker_name?: string;
  claimed_by?: string;
  workflow_status?: string;
}

export async function billingForceCompletePrePick(options: {
  orderId: number;
  userId: number;
  userName: string | null;
}): Promise<ForceCompletePrePickResult> {
  const { data, error } = await supabase.rpc('billing_force_complete_pre_pick', {
    p_order_id: options.orderId,
    p_actor_user_id: options.userId,
    p_actor_name: options.userName ?? 'Billing',
  });

  if (error) throw new Error(formatSupabaseUserMessage(error));
  return (data ?? {}) as ForceCompletePrePickResult;
}

export function forceCompletePrePickErrorMessage(result: ForceCompletePrePickResult): string {
  if (result.reason === 'not_approved') {
    return 'Order is not waiting for picking.';
  }
  if (result.reason === 'already_direct_bill') {
    return 'Order is already on direct bill path.';
  }
  if (result.reason === 'picker_assigned') {
    const who = result.picker_name ? ` (${result.picker_name})` : '';
    return `A picker is already assigned${who}. Use complete order after picking instead.`;
  }
  if (result.reason === 'picking_in_progress') {
    const who = result.claimed_by ? ` by ${result.claimed_by}` : '';
    return `Picking is in progress${who}. Wait for the picker to finish or use stale-pick complete.`;
  }
  if (result.reason === 'order_not_found') {
    return 'Order not found.';
  }
  return result.reason ?? 'Failed to complete order';
}
