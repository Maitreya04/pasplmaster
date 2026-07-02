import { supabase } from '../supabase/client';
import type { PendingItem } from '../../types';

export interface EnsurePendingItemInput {
  orderId: number;
  orderNumber: string;
  customerId: number | null;
  customerName: string;
  itemId: number | null;
  itemName: string;
  qtyPending: number;
  createdBy: string;
  note: string | null;
  issueCategory: string | null;
  source?: PendingItem['source'];
}

/**
 * Ensures a pending_items row exists for an order+item (any source).
 * Updates issue_category / note when billing confirms a pick flag removal.
 * Does not duplicate rows when picker already created one.
 */
export async function ensurePendingItem(input: EnsurePendingItemInput): Promise<void> {
  if (input.qtyPending <= 0 || input.itemId == null) return;

  const { data: existingRows, error: existingError } = await supabase
    .from('pending_items')
    .select('*')
    .eq('order_id', input.orderId)
    .eq('item_id', input.itemId)
    .eq('status', 'pending')
    .returns<PendingItem[]>();

  if (existingError) throw existingError;

  const rows = existingRows ?? [];
  if (rows.length > 0) {
    const primary = [...rows].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )[0]!;

    const patch: Record<string, unknown> = {
      qty_pending: Math.max(primary.qty_pending, input.qtyPending),
    };
    if (input.note) patch.note = input.note;
    if (input.issueCategory) patch.issue_category = input.issueCategory;

    const { error: updateError } = await supabase
      .from('pending_items')
      .update(patch)
      .eq('id', primary.id);
    if (updateError) throw updateError;

    const duplicateIds = rows.filter((r) => r.id !== primary.id).map((r) => r.id);
    if (duplicateIds.length > 0) {
      const { error: resolveDupError } = await supabase
        .from('pending_items')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_by: input.createdBy,
        })
        .in('id', duplicateIds);
      if (resolveDupError) throw resolveDupError;
    }
    return;
  }

  const { error: insertError } = await supabase.from('pending_items').insert({
    order_id: input.orderId,
    order_number: input.orderNumber,
    customer_id: input.customerId,
    customer_name: input.customerName,
    item_id: input.itemId,
    item_name: input.itemName,
    qty_pending: input.qtyPending,
    source: input.source ?? 'billing',
    created_by: input.createdBy,
    note: input.note,
    issue_category: input.issueCategory,
  });
  if (insertError) throw insertError;
}

export async function markPendingIssueReviewed(
  pendingItemId: number,
  reviewedBy: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('pending_items')
    .update({
      reviewed_at: now,
      reviewed_by: reviewedBy,
    })
    .eq('id', pendingItemId);
  if (error) throw error;
}
