import { supabase } from '../supabase/client';

/** Persist picker-confirmed label MRP into app overlay (never touches ERP / stock_mrpwise). */
export async function recordPickerLabelMrpForOrderItem(orderItemId: number): Promise<void> {
  const { error } = await supabase.rpc('record_picker_label_mrp', {
    p_order_item_id: orderItemId,
  });
  if (error) {
    console.warn('[recordPickerLabelMrp]', error.message);
  }
}

/** Billing accepted label MRP — promote overlay trust for future pickers. */
export async function promoteBillingVerifiedLabelMrp(
  orderItemId: number,
  acceptedMrp?: number | null,
): Promise<void> {
  const { error } = await supabase.rpc('promote_billing_verified_label_mrp', {
    p_order_item_id: orderItemId,
    p_accepted_mrp: acceptedMrp ?? null,
  });
  if (error) {
    console.warn('[promoteBillingVerifiedLabelMrp]', error.message);
  }
}
