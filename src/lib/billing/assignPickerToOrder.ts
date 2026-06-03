import { supabase } from '../supabase/client';
import { formatSupabaseUserMessage } from '../supabase/formatUserMessage';
import { sendPickerReadyNotification } from '../pickerPush';
import type { OrderPriority } from '../../types';

export interface AssignPickerResult {
  success?: boolean;
  reason?: string;
  claimed_by?: string;
  workflow_status?: string;
  picker_name?: string;
  claim_id?: number;
  resumed?: boolean;
}

export async function billingAssignPicker(options: {
  orderId: number;
  pickerUserId: number;
  actorUserId: number;
  actorName: string | null;
}): Promise<AssignPickerResult> {
  const { data, error } = await supabase.rpc('billing_assign_picker', {
    p_order_id: options.orderId,
    p_picker_user_id: options.pickerUserId,
    p_actor_user_id: options.actorUserId,
    p_actor_name: options.actorName ?? 'Billing',
  });

  if (error) throw new Error(formatSupabaseUserMessage(error));
  return (data ?? {}) as AssignPickerResult;
}

export function assignPickerErrorMessage(result: AssignPickerResult): string {
  if (result.reason === 'not_approved') {
    return 'Order is not ready for picking yet.';
  }
  if (result.reason === 'direct_bill') {
    return 'This order skips warehouse picking.';
  }
  if (result.reason === 'picking_in_progress') {
    const who = result.claimed_by ? ` (${result.claimed_by})` : '';
    return `Another picker is already on this order${who}.`;
  }
  if (result.reason === 'locked_by_sales_edit') {
    const who =
      typeof (result as { locked_by_name?: string }).locked_by_name === 'string'
        ? ` (${(result as { locked_by_name?: string }).locked_by_name})`
        : '';
    return `Sales is editing this order${who}. Try again when they finish.`;
  }
  if (result.reason === 'picker_not_found') {
    return 'Picker not found or inactive.';
  }
  if (result.reason === 'order_not_found') {
    return 'Order not found.';
  }
  return result.reason ?? 'Failed to assign picker';
}

export async function assignPickerAndNotify(options: {
  orderId: number;
  orderNumber: string;
  customerName: string;
  priority: OrderPriority;
  approvedAt: string | null;
  pickerUserId: number;
  actorUserId: number;
  actorName: string | null;
}): Promise<AssignPickerResult> {
  const result = await billingAssignPicker({
    orderId: options.orderId,
    pickerUserId: options.pickerUserId,
    actorUserId: options.actorUserId,
    actorName: options.actorName,
  });

  if (!result.success) {
    return result;
  }

  await sendPickerReadyNotification({
    eventType: 'order_ready_to_pick',
    orderId: options.orderId,
    orderNumber: options.orderNumber,
    customerName: options.customerName,
    priority: options.priority,
    approvedAt: options.approvedAt,
    targetUserId: options.pickerUserId,
  });

  return result;
}
