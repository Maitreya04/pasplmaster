import { supabase } from '../supabase/client';
import { sendInternalNotification } from '../pickerPush';
import type { RejectionKind } from '../../types';

export interface RejectBillingOrderInput {
  orderId: number;
  orderNumber: string;
  customerName: string;
  salespersonName: string | null;
  kind: RejectionKind;
  reason: string;
  actorUserId: string;
  actorName: string;
}

export interface RejectBillingOrderResult {
  kind: RejectionKind;
  notificationFailed?: boolean;
  notificationError?: unknown;
}

export async function rejectBillingOrder(
  input: RejectBillingOrderInput,
): Promise<RejectBillingOrderResult> {
  const trimmedReason = input.reason.trim();
  if (!trimmedReason) {
    throw new Error('Rejection reason is required');
  }

  if (input.kind === 'account_hold') {
    const { data, error } = await supabase.rpc('hold_order_for_account_lock', {
      p_order_id: input.orderId,
      p_actor_user_id: input.actorUserId,
      p_actor_name: input.actorName,
      p_notes: trimmedReason,
    });
    if (error) throw error;
    const payload = data as { success?: boolean; error?: string };
    if (!payload?.success) {
      throw new Error(payload.error ?? 'hold_failed');
    }
  } else {
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        workflow_status: 'rejected',
        rejection_kind: 'terminal',
        notes: trimmedReason,
      })
      .eq('id', input.orderId);

    if (updateError) throw updateError;
  }

  const notifyBody =
    input.kind === 'account_hold'
      ? `Order ${input.orderNumber} on hold. ${trimmedReason}`
      : `Order ${input.orderNumber} rejected. ${trimmedReason}`;

  try {
    await sendInternalNotification({
      eventType: 'order_update_for_sales',
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      customerName: input.customerName,
      salespersonName: input.salespersonName ?? '',
      messageBody: notifyBody,
    });
    return { kind: input.kind };
  } catch (e) {
    console.error('order_update_for_sales', e);
    return { kind: input.kind, notificationFailed: true, notificationError: e };
  }
}

export function formatRejectBillingOrderError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Failed to reject order';
}
