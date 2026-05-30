import { supabase } from '../supabase/client';
import {
  buildBillingCustomerUpdate,
  type BillingCustomerUpdateLineInput,
} from '../buildBillingCustomerUpdate';
import {
  formatInternalNotificationError,
  sendInternalNotification,
} from '../pickerPush';

export type NotifySalesOrderUpdateParams = {
  orderId: number;
  orderNumber: string;
  customerName: string;
  salespersonName: string;
  createdBy: string;
  lines: BillingCustomerUpdateLineInput[];
  /** When false, only persists billing_customer_updates (no inbox/push). */
  notifySales?: boolean;
};

export type NotifySalesOrderUpdateResult = {
  customerUpdateId: number;
  messageText: string;
  inboxCount?: number;
};

export async function persistAndNotifySalesOrderUpdate(
  params: NotifySalesOrderUpdateParams,
): Promise<NotifySalesOrderUpdateResult> {
  const { messageText, summary } = buildBillingCustomerUpdate({
    orderNumber: params.orderNumber,
    customerName: params.customerName,
    businessName: import.meta.env.VITE_BUSINESS_DISPLAY_NAME,
    date: new Date(),
    lines: params.lines,
  });

  const { data: customerUpdateRow, error: customerUpdateError } = await supabase
    .from('billing_customer_updates')
    .insert({
      order_id: params.orderId,
      message_text: messageText,
      summary_json: summary,
      created_by: params.createdBy,
    })
    .select('id')
    .single();

  if (customerUpdateError) throw customerUpdateError;

  const customerUpdateId = (customerUpdateRow as { id: number }).id;

  if (params.notifySales === false) {
    return { customerUpdateId, messageText };
  }

  const notifyResult = await sendInternalNotification({
    eventType: 'order_update_for_sales',
    orderId: params.orderId,
    orderNumber: params.orderNumber,
    customerName: params.customerName,
    salespersonName: params.salespersonName,
    messageBody: messageText,
    billingCustomerUpdateId: customerUpdateId,
  });

  return {
    customerUpdateId,
    messageText,
    inboxCount: notifyResult?.inboxCount,
  };
}

export { formatInternalNotificationError };
