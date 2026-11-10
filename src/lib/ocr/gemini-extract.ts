import { supabase } from '../supabase/client';
import type { GeminiRawOrder } from './types';

const EMPTY: GeminiRawOrder = { customer_name: null, items: [] };

export async function extractOrderFromImage(
  base64Image: string,
  mimeType: string,
): Promise<GeminiRawOrder> {
  const { data, error } = await supabase.functions.invoke('gemini-extract', {
    body: { mode: 'order', base64Image, mimeType },
  });
  if (error) throw new Error(`Gemini order extraction failed: ${error.message}`);
  if (!data || typeof data !== 'object' || ('error' in data && data.error)) {
    if (data && typeof data === 'object' && 'error' in data) {
      throw new Error(`Gemini order extraction failed: ${String(data.error)}`);
    }
    return EMPTY;
  }
  const order = data as GeminiRawOrder;
  return {
    customer_name: order.customer_name ?? null,
    items: Array.isArray(order.items) ? order.items : [],
  };
}
