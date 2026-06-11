import { supabase } from '../supabase/client';
import { notifyBillingPickReady } from './notifyBillingPickReady';
import { pickNoLongerActiveMessage } from './pickSessionErrors';

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

export async function completePickSession(params: CompletePickSessionParams): Promise<void> {
  if (params.boxCount < 1) {
    throw new Error('Box count must be at least 1');
  }
  if (params.isLab) return;

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
    await notifyBillingPickReady({
      orderId: params.orderId,
      orderNumber: params.orderNumber,
      customerName: params.customerName,
      boxCount: params.boxCount,
      flaggedLineCount: params.flaggedLineCount,
      pickerName: params.pickerName,
    });
  } catch {
    // Pick is already complete — billing can still see the order in queue.
  }
}
