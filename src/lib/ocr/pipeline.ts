// Orchestrates OCR extraction, normalization, matching, and summary stats for admin-lab testing.
import type { SupabaseClient } from '@supabase/supabase-js';
import { extractOrderFromImage } from './gemini-extract';
import { matchItems } from './matcher';
import { normalizeItems } from './normalizer';
import type { GeminiRawItem, MatchedItem, OCROrderResult, OCRQtyUnit } from './types';

const TEXT_LINE_REGEX = /^(.+?)\s*[-—]\s*(\d+)\s*(set|pcs|packet|net|box)?/i;

function normalizeCustomerName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function scoreCustomerNameMatch(a: string, b: string): number {
  const aNorm = normalizeCustomerName(a);
  const bNorm = normalizeCustomerName(b);
  if (!aNorm || !bNorm) return 0;
  if (aNorm === bNorm) return 100;
  const aTokens = new Set(aNorm.split(' ').filter(Boolean));
  const bTokens = new Set(bNorm.split(' ').filter(Boolean));
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }
  return overlap * 10;
}

function normalizeQtyUnit(value?: string): OCRQtyUnit {
  switch (value?.toLowerCase()) {
    case 'set':
    case 'packet':
    case 'net':
    case 'box':
      return value.toLowerCase() as OCRQtyUnit;
    default:
      return 'pcs';
  }
}

export function parseTextOrderItems(rawText: string): GeminiRawItem[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(TEXT_LINE_REGEX);
      return {
        raw_text: line,
        qty: match ? Number(match[2]) || 1 : 1,
        qty_unit: normalizeQtyUnit(match?.[3]),
        is_cancelled: false,
      };
    });
}

export function buildOrderStats(items: MatchedItem[]): OCROrderResult['stats'] {
  return items.reduce<OCROrderResult['stats']>(
    (stats, item) => {
      stats.total += 1;
      stats[item.confidence] += 1;
      return stats;
    },
    { total: 0, high: 0, medium: 0, low: 0, none: 0 },
  );
}

export async function resolveCustomerContext(
  supabase: SupabaseClient,
  customerId?: string,
  customerName?: string | null,
): Promise<OCROrderResult['customer_context']> {
  if (customerId?.trim()) {
    const { data } = await supabase
      .from('customers')
      .select('id,name')
      .eq('id', customerId.trim())
      .maybeSingle<{ id: number; name: string }>();

    return {
      input_customer_id: customerId.trim(),
      resolved_customer_id: data?.id ? String(data.id) : customerId.trim(),
      resolved_customer_name: data?.name ?? customerName ?? null,
      resolution_source: 'provided_id',
    };
  }

  if (!customerName?.trim()) {
    return {
      input_customer_id: null,
      resolved_customer_id: null,
      resolved_customer_name: null,
      resolution_source: 'none',
    };
  }

  const { data } = await supabase
    .from('customers')
    .select('id,name')
    .ilike('name', customerName.trim())
    .limit(1)
    .maybeSingle<{ id: number; name: string }>();

  if (data?.id) {
    return {
      input_customer_id: null,
      resolved_customer_id: String(data.id),
      resolved_customer_name: data.name,
      resolution_source: 'extracted_name',
    };
  }

  const firstToken = customerName.trim().split(/\s+/)[0] ?? '';
  const fallback = firstToken
    ? await supabase
        .from('customers')
        .select('id,name')
        .ilike('name', `%${firstToken}%`)
        .limit(10)
    : { data: null };

  const ranked = (fallback.data ?? [])
    .map((row) => ({
      id: row.id,
      name: row.name,
      score: scoreCustomerNameMatch(customerName, row.name),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];

  return {
    input_customer_id: null,
    resolved_customer_id: best && best.score >= 20 ? String(best.id) : null,
    resolved_customer_name: best && best.score >= 20 ? best.name : customerName.trim(),
    resolution_source: best && best.score >= 20 ? 'extracted_name' : 'none',
  };
}

export async function processOrderImage(
  base64Image: string,
  mimeType: string,
  supabase: SupabaseClient,
  customer_id?: string,
): Promise<OCROrderResult> {
  const extracted = await extractOrderFromImage(base64Image, mimeType);
  const activeItems = extracted.items.filter((item) => !item.is_cancelled);
  const normalized = normalizeItems(activeItems);
  const customerContext = await resolveCustomerContext(supabase, customer_id, extracted.customer_name);
  const matched = await matchItems(normalized, supabase, customerContext.resolved_customer_id ?? undefined);

  return {
    customer_name: extracted.customer_name,
    items: matched,
    customer_context: customerContext,
    stats: buildOrderStats(matched),
  };
}

export async function processOrderText(
  rawText: string,
  supabase: SupabaseClient,
  customer_id?: string,
): Promise<OCROrderResult> {
  const normalized = normalizeItems(parseTextOrderItems(rawText));
  const customerContext = await resolveCustomerContext(supabase, customer_id, null);
  const matched = await matchItems(normalized, supabase, customerContext.resolved_customer_id ?? undefined);

  return {
    customer_name: null,
    items: matched,
    customer_context: customerContext,
    stats: buildOrderStats(matched),
  };
}

/*
Manual verification trace:
- Input image header: "Rahul Dhamnod"
- Line 1: "1896A03601 — 02" -> numeric_code clean_code "1896A03601", qty 2, exact alias/alias1 hit => high
- Line 2: "CA275 STD — 01" -> brand/numeric-like code with variant ["STD"], qty 1, prefix or exact code hit => medium/high
- Line 3: "Clutch Assly HH — 10" -> description, expanded_description "clutch assembly hero honda", vehicle_context "Hero Honda", qty 10 => low
- Line 4: "12x1.5x045 — 100" struck through -> filtered out before normalization and matching
- Final stats should be: { total: 3, high: 1, medium: 1, low: 1, none: 0 }
*/
