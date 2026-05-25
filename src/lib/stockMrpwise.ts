import { supabase } from './supabase/client';
import type { StockMrpHistoryEntry, StockMrpHistoryResult, StockLocationCode } from '../types';

export const STOCK_MRP_HISTORY_QUERY_KEY = 'stock_mrp_history';

function parseHistoryEntry(raw: unknown): StockMrpHistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const mrp = Number(row.mrp);
  if (!Number.isFinite(mrp)) return null;
  return {
    mrp,
    qty: Number(row.qty) || 0,
    salesprice: row.salesprice != null ? Number(row.salesprice) : null,
    location: typeof row.location === 'string' ? row.location : null,
    location_code: typeof row.location_code === 'string' ? row.location_code : null,
    date: typeof row.date === 'string' ? row.date : null,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
    is_latest: row.is_latest === true,
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
  };
  return {
    success: true,
    busy_code: null,
    stock_location_code: null,
    latest_mrp: mrp,
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

  const latestMrp =
    payload.latest_mrp != null
      ? Number(payload.latest_mrp)
      : history.find((h) => h.is_latest)?.mrp ?? history[0]?.mrp ?? null;

  return {
    success: true,
    busy_code: code,
    stock_location_code:
      typeof payload.stock_location_code === 'string' ? payload.stock_location_code : loc,
    latest_mrp: latestMrp,
    history,
    source: 'stock_mrpwise',
  };
}
