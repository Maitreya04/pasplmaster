import type { ScanResult } from '../../types';

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
