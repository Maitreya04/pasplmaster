import { sendInternalNotification, type PickReadyForBillingPayload } from '../pickerPush';

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
): Promise<void> {
  const payload: PickReadyForBillingPayload = {
    eventType: 'pick_ready_for_billing',
    orderId: params.orderId,
    orderNumber: params.orderNumber,
    customerName: params.customerName,
    boxCount: params.boxCount,
    flaggedLineCount: params.flaggedLineCount,
    pickerName: params.pickerName,
  };
  await sendInternalNotification(payload);
}
