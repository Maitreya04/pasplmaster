import { supabase } from './supabase/client';
import type { OrderPriority } from '../types';

interface PickerPushPayload {
  eventType: 'order_ready_to_pick';
  orderId: number;
  orderNumber: string;
  customerName: string;
  priority: OrderPriority;
  approvedAt: string | null;
}

export async function sendPickerReadyNotification(payload: PickerPushPayload) {
  const { data, error } = await supabase.functions.invoke('send-picker-push', {
    body: payload,
  });

  if (error) throw error;
  return data;
}
