import { supabase } from './supabase/client';
import type { OrderPriority } from '../types';

export type PickerReadyPayload = {
  eventType: 'order_ready_to_pick';
  orderId: number;
  orderNumber: string;
  customerName: string;
  priority: OrderPriority;
  approvedAt: string | null;
};

export type ItemFlaggedPayload = {
  eventType: 'item_flagged_by_picker';
  orderId: number;
  orderNumber: string;
  customerName: string;
  itemName: string;
  flagReason: string;
  pickerName: string | null;
  orderItemId: number;
  flagNotes?: string | null;
  flagBoxPrice?: number | null;
};

export type OrderUpdateForSalesPayload = {
  eventType: 'order_update_for_sales';
  orderId: number;
  orderNumber: string;
  customerName: string;
  salespersonName: string;
  messageBody: string;
  billingCustomerUpdateId?: number;
};

export type InternalNotificationPayload =
  | PickerReadyPayload
  | ItemFlaggedPayload
  | OrderUpdateForSalesPayload;

/** Edge function JSON body (partial; varies by eventType). */
export type InternalNotificationResult = {
  success?: boolean;
  inboxCount?: number;
  sentCount?: number;
  failedCount?: number;
  error?: string;
};

export function formatInternalNotificationError(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const m = (err as { message: string }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function sendInternalNotification(
  payload: InternalNotificationPayload,
): Promise<InternalNotificationResult | null> {
  const { data, error } = await supabase.functions.invoke('send-internal-notification', {
    body: payload,
  });
  if (error) throw error;
  return (data ?? null) as InternalNotificationResult | null;
}

export async function sendPickerReadyNotification(payload: PickerReadyPayload) {
  return sendInternalNotification(payload);
}
