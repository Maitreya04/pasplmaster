import { supabase } from '../supabase/client';

interface AIVerifyResult {
  match: boolean;
  confidence: number;
  extracted_code?: string;
  extracted_description?: string;
  extracted_mrp?: string;
  extracted_brand?: string;
  reason: string;
}

export async function verifyWithAI(
  imageBase64: string,
  expectedItem: {
    name: string;
    pickCode?: string | null;
    alias1?: string | null;
    alias?: string | null;
    mrp?: number;
  },
): Promise<AIVerifyResult> {
  try {
    const { data, error } = await supabase.functions.invoke('verify-item', {
      body: { imageBase64, expectedItem },
    });

    if (error) {
      console.error('AI verify edge function error:', error);
      return { match: false, confidence: 0, reason: 'AI verification unavailable' };
    }

    return {
      match: data?.match ?? false,
      confidence: data?.confidence ?? 0,
      extracted_code: data?.extracted_code,
      extracted_description: data?.extracted_description,
      extracted_mrp: data?.extracted_mrp,
      extracted_brand: data?.extracted_brand,
      reason: data?.reason ?? 'AI verification',
    };
  } catch (err) {
    console.error('AI verify failed:', err);
    return { match: false, confidence: 0, reason: 'AI verification unavailable' };
  }
}
