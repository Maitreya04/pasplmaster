import { supabase } from '../supabase/client';

export async function syncLabelMrpFlagForOrderItem(orderItemId: number): Promise<void> {
  const { error } = await supabase.rpc('sync_order_item_label_mrp_flag', {
    p_order_item_id: orderItemId,
  });
  if (error) throw error;
}
