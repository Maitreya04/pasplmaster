import { supabase } from '../supabase/client';
import { normalizeSalesLineUnit } from '../salesUnit';
import type { SalesLineUnit } from '../../types';

export async function persistOrderItemSalesUnit(
  orderItemId: number,
  salesUnit: SalesLineUnit,
): Promise<{ error: Error | null }> {
  const unit = normalizeSalesLineUnit(salesUnit);
  const { error } = await supabase
    .from('order_items')
    .update({ sales_unit: unit })
    .eq('id', orderItemId);

  return { error: error ? new Error(error.message) : null };
}
