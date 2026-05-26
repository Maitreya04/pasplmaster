import { supabase } from '../supabase/client';
import type { ScanResult } from '../../types';

export type SplitMrpSegmentResult = {
  success: boolean;
  order_item_id?: number;
  is_new_row?: boolean;
  error?: string;
};

export async function commitPickMrpSegment(options: {
  orderId: number;
  claimId: number | null;
  userId: number;
  rootOrderItemId: number;
  segmentQty: number;
  confirmedMrp: number;
  scanResult: ScanResult;
  isFirstSegment: boolean;
}): Promise<SplitMrpSegmentResult> {
  const { data, error } = await supabase.rpc('split_order_item_at_pick', {
    p_order_id: options.orderId,
    p_claim_id: options.claimId,
    p_user_id: options.userId,
    p_root_order_item_id: options.rootOrderItemId,
    p_segment_qty: options.segmentQty,
    p_confirmed_mrp: options.confirmedMrp,
    p_scan_result: options.scanResult as unknown as Record<string, unknown>,
    p_is_first_segment: options.isFirstSegment,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const payload = data as Record<string, unknown> | null;
  if (!payload || payload.success !== true) {
    return {
      success: false,
      error: typeof payload?.error === 'string' ? payload.error : 'split_failed',
    };
  }

  return {
    success: true,
    order_item_id: payload.order_item_id != null ? Number(payload.order_item_id) : undefined,
    is_new_row: payload.is_new_row === true,
  };
}

export async function undoPickMrpSegment(options: {
  orderId: number;
  claimId: number | null;
  userId: number;
  rootOrderItemId: number;
  segmentOrderItemId: number;
  restoreQty?: number | null;
}): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('merge_pick_mrp_segment', {
    p_order_id: options.orderId,
    p_claim_id: options.claimId,
    p_user_id: options.userId,
    p_root_order_item_id: options.rootOrderItemId,
    p_segment_order_item_id: options.segmentOrderItemId,
    p_restore_qty: options.restoreQty ?? null,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  const payload = data as Record<string, unknown> | null;
  if (!payload || payload.success !== true) {
    return {
      success: false,
      error: typeof payload?.error === 'string' ? payload.error : 'merge_failed',
    };
  }

  return { success: true };
}
