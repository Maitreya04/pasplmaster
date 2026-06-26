import { supabase } from './supabase/client';
import type {
  MrpSuggestionSource,
  StockMrpHistoryEntry,
  StockMrpHistoryResult,
  StockLocationCode,
} from '../types';

export const STOCK_MRP_HISTORY_QUERY_KEY = 'stock_mrp_history';

function parseSuggestionSource(raw: unknown): MrpSuggestionSource {
  if (
    raw === 'picker_30d' ||
    raw === 'picker_verified' ||
    raw === 'stock_mrpwise' ||
    raw === 'items_fallback' ||
    raw === 'empty'
  ) {
    return raw;
  }
  return 'empty';
}

function parseHistoryEntry(raw: unknown): StockMrpHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const mrp = Number(row.mrp);
  if (!Number.isFinite(mrp)) return null;
  const sourceRaw = row.source;
  const source =
    sourceRaw === 'picker_verified' ||
    sourceRaw === 'billing_verified' ||
    sourceRaw === 'stock_mrpwise' ||
    sourceRaw === 'items_fallback'
      ? sourceRaw
      : undefined;
  const confirmationCount =
    row.confirmation_count != null ? Number(row.confirmation_count) : undefined;
  const recentPickCount =
    row.recent_pick_count != null ? Number(row.recent_pick_count) : undefined;
  return {
    mrp,
    qty: Number(row.qty) || 0,
    salesprice: row.salesprice != null ? Number(row.salesprice) : null,
    location: typeof row.location === 'string' ? row.location : null,
    location_code: typeof row.location_code === 'string' ? row.location_code : null,
    date: typeof row.date === 'string' ? row.date : null,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
    is_latest: row.is_latest === true,
    source,
    confirmation_count:
      confirmationCount != null && Number.isFinite(confirmationCount)
        ? confirmationCount
        : undefined,
    recent_pick_count:
      recentPickCount != null && Number.isFinite(recentPickCount)
        ? recentPickCount
        : undefined,
  };
}

function emptyResult(
  busyCode: number | null,
  stockLocationCode: StockLocationCode | null,
  source: StockMrpHistoryResult['source'] = 'empty',
): StockMrpHistoryResult {
  return {
    success: false,
    busy_code: busyCode,
    stock_location_code: stockLocationCode,
    latest_mrp: null,
    suggested_mrp: null,
    stock_mrp: null,
    suggestion_source: 'empty',
    history: [],
    source,
  };
}

function itemsFallbackHistory(mrp: number): StockMrpHistoryResult {
  const entry: StockMrpHistoryEntry = {
    mrp,
    qty: 0,
    salesprice: null,
    location: null,
    location_code: null,
    date: null,
    updated_at: null,
    is_latest: true,
    source: 'items_fallback',
  };
  return {
    success: true,
    busy_code: null,
    stock_location_code: null,
    latest_mrp: mrp,
    suggested_mrp: mrp,
    stock_mrp: null,
    suggestion_source: 'items_fallback',
    history: [entry],
    source: 'items_fallback',
  };
}

export async function fetchStockMrpHistory(
  busyCode: number | null | undefined,
  stockLocationCode?: StockLocationCode | null,
  itemsMrpFallback?: number | null,
): Promise<StockMrpHistoryResult> {
  const code = busyCode != null ? Number(busyCode) : NaN;
  const loc = stockLocationCode ?? null;

  if (!Number.isFinite(code) || code <= 0) {
    if (itemsMrpFallback != null && itemsMrpFallback > 0) {
      return itemsFallbackHistory(itemsMrpFallback);
    }
    return emptyResult(null, loc);
  }

  const { data, error } = await supabase.rpc('get_stock_mrp_history', {
    p_busy_code: code,
    p_stock_location_code: loc,
  });

  if (error) {
    console.warn('[fetchStockMrpHistory]', error.message);
    if (itemsMrpFallback != null && itemsMrpFallback > 0) {
      return itemsFallbackHistory(itemsMrpFallback);
    }
    return emptyResult(code, loc);
  }

  const payload = data as Record<string, unknown> | null;
  if (!payload || payload.success !== true) {
    if (itemsMrpFallback != null && itemsMrpFallback > 0) {
      return itemsFallbackHistory(itemsMrpFallback);
    }
    return emptyResult(code, loc);
  }

  const historyRaw = Array.isArray(payload.history) ? payload.history : [];
  const history = historyRaw
    .map(parseHistoryEntry)
    .filter((e): e is StockMrpHistoryEntry => e != null);

  if (history.length === 0) {
    if (itemsMrpFallback != null && itemsMrpFallback > 0) {
      return itemsFallbackHistory(itemsMrpFallback);
    }
    return emptyResult(code, loc);
  }

  const suggestedMrp =
    payload.suggested_mrp != null
      ? Number(payload.suggested_mrp)
      : payload.latest_mrp != null
        ? Number(payload.latest_mrp)
        : history.find((h) => h.is_latest)?.mrp ?? history[0]?.mrp ?? null;

  const stockMrp =
    payload.stock_mrp != null ? Number(payload.stock_mrp) : null;

  const latestMrp =
    payload.latest_mrp != null
      ? Number(payload.latest_mrp)
      : suggestedMrp;

  return {
    success: true,
    busy_code: code,
    stock_location_code:
      typeof payload.stock_location_code === 'string' ? payload.stock_location_code : loc,
    latest_mrp: latestMrp,
    suggested_mrp: suggestedMrp,
    stock_mrp: stockMrp,
    suggestion_source: parseSuggestionSource(payload.suggestion_source),
    history,
    source: 'stock_mrpwise',
  };
}
