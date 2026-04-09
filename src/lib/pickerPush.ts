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
};

export type OrderUpdateForSalesPayload = {
  eventType: 'order_update_for_sales';
  orderId: number;
  orderNumber: string;
  customerName: string;
  salespersonName: string;
  messageBody: string;
};

export type InternalNotificationPayload =
  | PickerReadyPayload
  | ItemFlaggedPayload
  | OrderUpdateForSalesPayload;

export async function sendInternalNotification(payload: InternalNotificationPayload) {
  const { data, error } = await supabase.functions.invoke('send-internal-notification', {
    body: payload,
  });
  if (error) throw error;
  return data;
}

export async function sendPickerReadyNotification(payload: PickerReadyPayload) {
  return sendInternalNotification(payload);
}
