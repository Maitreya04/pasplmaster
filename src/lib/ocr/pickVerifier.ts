import { supabase } from '../supabase/client';
import { matchOcrToItem } from './ocrMatcher';
import { buildScanResultFromMatch } from './scanResult';
import type { ScanResult } from '../../types';

interface ItemMeta {
  mrp?: number;
  mainGroup?: string | null;
  alias1?: string | null;
}

export interface AIVerifyResult {
  match: boolean;
  confidence: number;
  extracted_code?: string;
  extracted_description?: string;
  extracted_mrp?: string;
  extracted_brand?: string;
  reason: string;
}

/**
 * Layer 3: Gemini Flash AI verification via Supabase edge function.
 * Called only when local OCR matching (Layers 1+2) fails.
 */
export async function verifyWithAI(
  imageBase64: string,
  expectedItem: { name: string; alias1?: string | null; mrp?: number },
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

/**
 * Build a ScanResult from an AI verification response.
 */
export function buildScanResultFromAI(
  aiResult: AIVerifyResult,
  ocrText: string,
  expectedItem: { item_name: string; item_alias: string | null },
): ScanResult {
  return {
    scannedText: ocrText,
    confidence: aiResult.confidence,
    isMatch: aiResult.match,
    matchedAgainst: aiResult.extracted_code || expectedItem.item_alias || expectedItem.item_name,
    matchStrategy: 'ai_verify',
    ocrExtracted: {
      partNumber: aiResult.extracted_code ?? null,
      mrp: aiResult.extracted_mrp ? parseFloat(aiResult.extracted_mrp) || null : null,
      brand: aiResult.extracted_brand ?? null,
      vehicleModel: null,
    },
    signals: [{
      signal: 'ai',
      score: aiResult.match ? aiResult.confidence : 0,
      maxScore: 100,
      detail: aiResult.reason,
    }],
    method: 'ai_verify',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Full verification pipeline:
 * 1. Run local OCR matching (reuse existing ocrMatcher)
 * 2. If local match fails, fall back to Gemini AI
 *
 * Returns { scanResult, usedAI }
 */
export async function verifyPickFull(
  ocrText: string,
  imageBase64: string,
  expectedItem: { item_name: string; item_alias: string | null },
  meta: ItemMeta,
): Promise<{ scanResult: ScanResult; usedAI: boolean }> {
  // Layer 1+2: Local OCR matching (existing multi-signal matcher)
  const matchResult = matchOcrToItem(
    ocrText,
    expectedItem,
    meta.mrp,
    meta.mainGroup ?? null,
    meta.alias1 ?? null,
  );

  if (matchResult.isMatch) {
    const scanResult = buildScanResultFromMatch({
      rawText: ocrText,
      matchResult,
      expectedItem,
    });
    scanResult.method = 'local_match';
    return { scanResult, usedAI: false };
  }

  // Layer 3: AI fallback (only if local matching failed)
  const aiResult = await verifyWithAI(imageBase64, {
    name: expectedItem.item_name,
    alias1: meta.alias1,
    mrp: meta.mrp,
  });

  if (aiResult.match) {
    const scanResult = buildScanResultFromAI(aiResult, ocrText, expectedItem);
    return { scanResult, usedAI: true };
  }

  // Neither local nor AI matched — return local result with no-match
  const scanResult = buildScanResultFromMatch({
    rawText: ocrText,
    matchResult,
    expectedItem,
  });
  scanResult.method = 'local_match';
  return { scanResult, usedAI: true };
}
