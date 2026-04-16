import type { Item } from '../../../types';
import type { OcrStageItem, OcrStageProduct, OcrStageRun, OcrRunSummary } from './types';
import type { MatchConfidence, OCROrderResult } from '../../../lib/ocr/types';
import { itemAlternateCode, itemPickCode } from '../../../utils/itemCodes';

function confidenceScore(confidence: MatchConfidence, strategy: string): number {
  if (confidence === 'high') return strategy === 'exact_code' ? 0.97 : 0.93;
  if (confidence === 'medium') return strategy === 'prefix_code' ? 0.86 : 0.79;
  if (confidence === 'low') return 0.62;
  return 0.34;
}

function normalizeCatalogSearch(value: string): string {
  return value.trim().toLowerCase().replace(/o/g, '0');
}

function coordinateForIndex(index: number, total: number): { top: string; left: string } {
  const safeTotal = Math.max(total, 1);
  const start = 16;
  const end = 78;
  const step = safeTotal > 1 ? (end - start) / (safeTotal - 1) : 0;
  return {
    top: `${start + step * index}%`,
    left: '8%',
  };
}

export function toStageProduct(item: Pick<Item, 'id' | 'name' | 'alias' | 'alias1' | 'sales_price' | 'main_group'>): OcrStageProduct {
  return {
    id: String(item.id),
    name: item.name,
    sku: itemPickCode(item) || item.name,
    secondaryCode: itemAlternateCode(item),
    price: item.sales_price,
    brand: item.main_group ?? null,
  };
}

function resolveMatchedProduct(
  source: OCROrderResult['items'][number],
  catalog: OcrStageProduct[],
): OcrStageProduct | null {
  const match = source.match_result;
  if (!match) return null;
  return (
    catalog.find((product) => product.sku === match.alias1)
    ?? catalog.find((product) => product.sku === match.item_code)
    ?? catalog.find((product) => product.secondaryCode === match.alias)
    ?? catalog.find((product) => product.name === match.item_name)
    ?? {
      id: match.item_code || match.item_name,
      name: match.item_name,
      sku: match.alias1 || match.item_code || match.item_name,
      secondaryCode: match.alias,
      price: 0,
      brand: match.brand || null,
    }
  );
}

export function toStageRun(
  result: OCROrderResult,
  catalog: OcrStageProduct[],
): OcrStageRun {
  const total = result.items.length;
  return {
    customerName: result.customer_name,
    customerContext: result.customer_context,
    stats: result.stats,
    startedAt: new Date().toISOString(),
    items: result.items.map((item, index): OcrStageItem => ({
      id: `ocr-${index + 1}`,
      rawText: item.raw_text,
      matchedProduct: resolveMatchedProduct(item, catalog),
      quantity: item.qty,
      confidence: confidenceScore(item.confidence, item.match_strategy),
      confidenceLabel: item.confidence,
      coordinates: coordinateForIndex(index, total),
      status: 'pending',
      source: item,
    })),
  };
}

export function recentRunFromStage(run: OcrStageRun): OcrRunSummary {
  const strong = run.items.filter((item) => item.source.confidence === 'high' || item.source.confidence === 'medium').length;
  return {
    id: `${run.startedAt}-${run.customerContext.resolved_customer_id ?? 'na'}`,
    customer: run.customerContext.resolved_customer_name ?? run.customerName ?? 'Unknown customer',
    itemCount: run.items.length,
    status: strong === run.items.length ? 'Strong match' : 'Needs review',
    timeLabel: 'Just now',
  };
}

export function filterCatalog(catalog: OcrStageProduct[], query: string): OcrStageProduct[] {
  const normalized = query.trim().toLowerCase();
  const normalizedCode = normalizeCatalogSearch(query);
  if (!normalized) return catalog.slice(0, 30);
  return catalog
    .filter((product) => {
      const haystack = `${product.name} ${product.brand ?? ''}`.toLowerCase();
      const codeHaystack = normalizeCatalogSearch(`${product.sku} ${product.secondaryCode ?? ''}`);
      return haystack.includes(normalized) || codeHaystack.includes(normalizedCode);
    })
    .slice(0, 40);
}

export function itemStatusComplete(status: OcrStageItem['status']): boolean {
  return status === 'confirmed' || status === 'edited';
}
