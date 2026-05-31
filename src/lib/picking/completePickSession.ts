import { supabase } from '../supabase/client';
import { notifyBillingPickReady } from './notifyBillingPickReady';

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

  const isCompleted = !params.hasFlagged;

  if (params.claimId && params.userId) {
    const { error } = await supabase.rpc('complete_picking', {
      p_order_id: params.orderId,
      p_claim_id: params.claimId,
      p_user_id: params.userId,
      p_has_flags: params.hasFlagged,
      p_box_count: params.boxCount,
    });
    if (error) throw error;
  } else {
    const updates: {
      workflow_status: 'completed' | 'flagged';
      box_count: number;
      completed_at?: string;
      picking_completed_at?: string;
      priority?: 'normal';
    } = {
      workflow_status: isCompleted ? 'completed' : 'flagged',
      box_count: params.boxCount,
      picking_completed_at: new Date().toISOString(),
    };
    if (!params.completedAt && isCompleted) {
      updates.completed_at = new Date().toISOString();
    }
    if (isCompleted) {
      updates.priority = 'normal';
    }
    const { error } = await supabase.from('orders').update(updates).eq('id', params.orderId);
    if (error) throw error;
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
