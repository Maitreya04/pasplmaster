import {
  sendInternalNotification,
  type InternalNotificationResult,
  type PickReadyForBillingPayload,
} from '../pickerPush';

export type NotifyBillingPickReadyParams = {
  orderId: number;
  orderNumber: string;
  customerName: string;
  boxCount: number;
  flaggedLineCount: number;
  pickerName: string | null;
};

export async function notifyBillingPickReady(
  params: NotifyBillingPickReadyParams,
): Promise<InternalNotificationResult | null> {
  const payload: PickReadyForBillingPayload = {
    eventType: 'pick_ready_for_billing',
    orderId: params.orderId,
    orderNumber: params.orderNumber,
    customerName: params.customerName,
    boxCount: params.boxCount,
    flaggedLineCount: params.flaggedLineCount,
    pickerName: params.pickerName,
  };
  return sendInternalNotification(payload);
}
