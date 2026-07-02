import { supabase } from '../supabase/client';
import { notifyBillingPickReady } from './notifyBillingPickReady';
import { pickNoLongerActiveMessage } from './pickSessionErrors';
import {
  formatInternalNotificationError,
  type InternalNotificationResult,
} from '../pickerPush';

export interface CompletePickSessionParams {
  orderId: number;
  orderNumber: string;
  customerName: string;
  claimId: number | null;
  userId: number | null;
  pickerName: string | null;
  boxCount: number;
  hasFlagged: boolean;
  flaggedLineCount: number;
  completedAt?: string | null;
  isLab?: boolean;
}

export interface CompletePickSessionResult {
  billingNotified: boolean;
  notificationResult: InternalNotificationResult | null;
  notificationError: string | null;
}

function pickReadyNotificationError(result: InternalNotificationResult | null): string | null {
  if (!result) return 'No notification response from Supabase';
  if (result.error) return result.error;
  if (result.success === false) return 'Notification function reported failure';
  const inboxCount = result.inboxCount ?? 0;
  const sentCount = result.sentCount ?? 0;
  if (inboxCount < 1 && sentCount < 1) {
    return 'No active billing users or push subscriptions received the notification';
  }
  return null;
}

export async function completePickSession(
  params: CompletePickSessionParams,
): Promise<CompletePickSessionResult> {
  if (params.boxCount < 1) {
    throw new Error('Box count must be at least 1');
  }
  if (params.isLab) {
    return {
      billingNotified: false,
      notificationResult: null,
      notificationError: null,
    };
  }

  if (!params.claimId || !params.userId) {
    throw new Error(pickNoLongerActiveMessage('claim_lost'));
  }

  const { data, error } = await supabase.rpc('complete_picking', {
    p_order_id: params.orderId,
    p_claim_id: params.claimId,
    p_user_id: params.userId,
    p_has_flags: params.hasFlagged,
    p_box_count: params.boxCount,
  });
  if (error) throw error;

  const result = data as { success?: boolean; reason?: string } | null;
  if (!result?.success) {
    throw new Error(
      result?.reason ? pickNoLongerActiveMessage(result.reason) : 'Failed to finalise pick',
    );
  }

  try {
    const notificationResult = await notifyBillingPickReady({
      orderId: params.orderId,
      orderNumber: params.orderNumber,
      customerName: params.customerName,
      boxCount: params.boxCount,
      flaggedLineCount: params.flaggedLineCount,
      pickerName: params.pickerName,
    });
    const notificationError = pickReadyNotificationError(notificationResult);
    return {
      billingNotified: notificationError == null,
      notificationResult,
      notificationError,
    };
  } catch (error) {
    // Pick is already complete — billing can still see the order in queue.
    return {
      billingNotified: false,
      notificationResult: null,
      notificationError: formatInternalNotificationError(error),
    };
  }
}
