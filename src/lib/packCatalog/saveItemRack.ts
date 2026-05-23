import { supabase } from '../supabase/client';

export function normalizeRackNo(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

export async function saveItemRackNo(itemId: number, rackNo: string | null): Promise<void> {
  const normalized = normalizeRackNo(rackNo);
  const { error } = await supabase.from('items').update({ rack_no: normalized }).eq('id', itemId);
  if (error) throw error;
}
