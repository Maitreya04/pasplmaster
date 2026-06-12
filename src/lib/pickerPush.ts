import { supabase } from './supabase/client';
import type { OrderPriority } from '../types';

export type PickerReadyPayload = {
  eventType: 'order_ready_to_pick';
  orderId: number;
  orderNumber: string;
  customerName: string;
  priority: OrderPriority;
  approvedAt: string | null;
  /** When set, notify only this picker. Omit to broadcast to all active pickers. */
  targetUserId?: number;
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

export type PickCompleteReminderPayload = {
  eventType: 'pick_complete_reminder';
  kind: 'all_done' | 'stalled';
  orderId: number;
  orderNumber: string;
  customerName: string;
  priority: OrderPriority;
  targetUserId: number;
  linesDone: number;
  linesTotal: number;
  linesRemaining: number;
};

export type PickReadyForBillingPayload = {
  eventType: 'pick_ready_for_billing';
  orderId: number;
  orderNumber: string;
  customerName: string;
  boxCount: number;
  flaggedLineCount: number;
  pickerName: string | null;
};

export type BillReadyToCollectPayload = {
  eventType: 'bill_ready_to_collect';
  orderId: number;
  orderNumber: string;
  customerName: string;
  billingPersonName: string;
};

export type InternalNotificationPayload =
  | PickerReadyPayload
  | ItemFlaggedPayload
  | OrderUpdateForSalesPayload
  | PickCompleteReminderPayload
  | PickReadyForBillingPayload
  | BillReadyToCollectPayload;

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

export async function sendPickCompleteReminder(payload: PickCompleteReminderPayload) {
  return sendInternalNotification(payload);
}

export async function notifyPickerBillReadyToCollect(payload: BillReadyToCollectPayload) {
  return sendInternalNotification(payload);
}
