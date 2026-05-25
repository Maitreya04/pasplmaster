import type { OrderItem, ScanResult } from '../../types';
import { primaryBusyCodeForOrderItem } from '../wms/binLayers';

export interface PickLineMrpState {
  confirmedMrp: number | null;
  customMrp: number | null;
}

export function pickLineMrpFinal(state: PickLineMrpState | undefined): number | null {
  if (!state) return null;
  return state.customMrp ?? state.confirmedMrp;
}

export function isPickLineMrpConfirmed(state: PickLineMrpState | undefined): boolean {
  return pickLineMrpFinal(state) != null;
}

/** Busy code + catalog fallback for stock_mrpwise / items MRP lookup. */
export function pickLineMrpLookup(orderItem: OrderItem): {
  busyCode: number | null;
  itemsMrpFallback: number | null;
} {
  const fromCandidates = primaryBusyCodeForOrderItem(orderItem);
  const fromCatalog =
    orderItem.catalog_busy_code != null ? Number(orderItem.catalog_busy_code) : null;
  const busyCode =
    fromCandidates ??
    (fromCatalog != null && Number.isFinite(fromCatalog) && fromCatalog > 0 ? fromCatalog : null);
  const itemsMrpFallback =
    orderItem.price_system != null && orderItem.price_system > 0
      ? orderItem.price_system
      : orderItem.price_quoted != null && orderItem.price_quoted > 0
        ? orderItem.price_quoted
        : null;
  return { busyCode, itemsMrpFallback };
}

export function isPickLineMrpFlagged(
  state: PickLineMrpState | undefined,
  latestMrp: number | null,
): boolean {
  const final = pickLineMrpFinal(state);
  if (final == null || latestMrp == null) return false;
  return final !== latestMrp;
}

const STORAGE_PREFIX = 'paspl.pick.lineMrp.v1';

export function readPickLineMrpMap(orderId: number | null): Map<number, PickLineMrpState> {
  if (!orderId || typeof window === 'undefined') return new Map();
  try {
    const raw = window.sessionStorage.getItem(`${STORAGE_PREFIX}:${orderId}`);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return new Map();
    const out = new Map<number, PickLineMrpState>();
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      const id = Number(key);
      if (!Number.isFinite(id) || !val || typeof val !== 'object') continue;
      const row = val as Record<string, unknown>;
      out.set(id, {
        confirmedMrp: row.confirmedMrp != null ? Number(row.confirmedMrp) : null,
        customMrp: row.customMrp != null ? Number(row.customMrp) : null,
      });
    }
    return out;
  } catch {
    return new Map();
  }
}

export function writePickLineMrpMap(orderId: number | null, map: Map<number, PickLineMrpState>): void {
  if (!orderId || typeof window === 'undefined') return;
  try {
    const obj: Record<string, PickLineMrpState> = {};
    for (const [id, state] of map) obj[String(id)] = state;
    window.sessionStorage.setItem(`${STORAGE_PREFIX}:${orderId}`, JSON.stringify(obj));
  } catch {
    // best-effort
  }
}

export function mergeMrpIntoScanResult(
  scanResult: ScanResult,
  state: PickLineMrpState | undefined,
  latestMrp: number | null,
  historyCount: number,
  mrpSource: ScanResult['mrpSource'],
): ScanResult {
  const finalMrp = pickLineMrpFinal(state);
  if (finalMrp == null) return scanResult;

  return {
    ...scanResult,
    ocrExtracted: {
      ...scanResult.ocrExtracted,
      mrp: finalMrp,
    },
    confirmedMrp: finalMrp,
    mrpFlagged: isPickLineMrpFlagged(state, latestMrp),
    mrpSource: finalMrp != null ? mrpSource : null,
    mrpHistoryCount: historyCount,
  };
}
