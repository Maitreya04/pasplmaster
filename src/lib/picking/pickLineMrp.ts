import type { OrderItem, ScanResult } from '../../types';
import { primaryBusyCodeForOrderItem } from '../wms/binLayers';

export type PickMrpSegment = {
  mrp: number;
  qty: number;
  custom?: boolean;
  orderItemId?: number;
  committed: boolean;
};

export interface PickLineMrpState {
  mode: 'single' | 'split';
  confirmedMrp: number | null;
  customMrp: number | null;
  segments: PickMrpSegment[];
  activeSegmentIndex: number | null;
  /** Original line target when split mode started (survives source row shrink). */
  originalTargetQty: number | null;
  /** Root order_items.id for the sales line — never changes during split. */
  rootOrderItemId: number | null;
}

export const PICK_MRP_SPLIT_ENABLED = import.meta.env.VITE_PICK_MRP_SPLIT !== '0';

export function createDefaultPickLineMrpState(): PickLineMrpState {
  return {
    mode: 'single',
    confirmedMrp: null,
    customMrp: null,
    segments: [],
    activeSegmentIndex: null,
    originalTargetQty: null,
    rootOrderItemId: null,
  };
}

export function isSplitMode(state: PickLineMrpState | undefined): boolean {
  return state?.mode === 'split';
}

export function shouldSuggestMrpSplit(
  mrpHistoryCount: number,
  targetQty: number,
  distinctShelfMrpCount = 0,
): boolean {
  if (!PICK_MRP_SPLIT_ENABLED || targetQty <= 1) return false;
  return mrpHistoryCount > 1 || distinctShelfMrpCount > 1;
}

/** Qty > 1 lines can always start a manual MRP split when stock shows fewer bands. */
export function canManualMrpSplit(targetQty: number, splitActive: boolean): boolean {
  return PICK_MRP_SPLIT_ENABLED && targetQty > 1 && !splitActive;
}

export function distinctShelfMrpCount(
  layers: ReadonlyArray<{ mrp_per_ea: number | string }> | null | undefined,
): number {
  if (!layers?.length) return 0;
  const mrps = new Set<number>();
  for (const layer of layers) {
    const mrp = Math.round(Number(layer.mrp_per_ea));
    if (Number.isFinite(mrp) && mrp > 0) mrps.add(mrp);
  }
  return mrps.size;
}

export function pickLineSegmentsCommittedQty(state: PickLineMrpState | undefined): number {
  if (!state) return 0;
  return state.segments.filter((s) => s.committed).reduce((sum, s) => sum + s.qty, 0);
}

export function pickLineSplitRemaining(
  state: PickLineMrpState | undefined,
  targetQty: number,
): number {
  const goal = state?.originalTargetQty ?? targetQty;
  return Math.max(0, goal - pickLineSegmentsCommittedQty(state));
}

export function isSplitInProgress(state: PickLineMrpState | undefined, targetQty: number): boolean {
  if (!isSplitMode(state)) return false;
  return pickLineSplitRemaining(state, targetQty) > 0;
}

export function getActiveSegment(state: PickLineMrpState | undefined): PickMrpSegment | null {
  if (!state || state.activeSegmentIndex == null) return null;
  return state.segments[state.activeSegmentIndex] ?? null;
}

export function getActiveSegmentMrp(state: PickLineMrpState | undefined): number | null {
  const seg = getActiveSegment(state);
  return seg?.mrp ?? null;
}

export function pickLineMrpFinal(state: PickLineMrpState | undefined): number | null {
  if (!state) return null;
  if (isSplitMode(state)) {
    return getActiveSegmentMrp(state);
  }
  return state.customMrp ?? state.confirmedMrp;
}

export function isPickLineMrpConfirmed(state: PickLineMrpState | undefined): boolean {
  if (!state) return false;
  if (isSplitMode(state)) {
    const active = getActiveSegment(state);
    return active != null && active.mrp > 0;
  }
  return pickLineMrpFinal(state) != null;
}

/** True when split mode has no active batch and remaining qty to pick. */
export function splitNeedsNextBatch(state: PickLineMrpState | undefined, targetQty: number): boolean {
  if (!isSplitMode(state)) return false;
  if (pickLineSplitRemaining(state, targetQty) <= 0) return false;
  const active = getActiveSegment(state);
  return active == null || active.committed;
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
  segmentMrp?: number | null,
): boolean {
  const final = segmentMrp ?? pickLineMrpFinal(state);
  if (final == null || latestMrp == null) return false;
  return final !== latestMrp;
}

export function enterSplitMode(
  state: PickLineMrpState | undefined,
  orderItemId: number,
  targetQty: number,
): PickLineMrpState {
  const base = state ?? createDefaultPickLineMrpState();
  return {
    ...base,
    mode: 'split',
    confirmedMrp: null,
    customMrp: null,
    segments: base.segments,
    activeSegmentIndex: null,
    originalTargetQty: targetQty,
    rootOrderItemId: orderItemId,
  };
}

export function enterSingleModeFromSplit(state: PickLineMrpState | undefined): PickLineMrpState {
  const base = state ?? createDefaultPickLineMrpState();
  return {
    ...base,
    mode: 'single',
    segments: [],
    activeSegmentIndex: null,
    originalTargetQty: null,
    rootOrderItemId: null,
  };
}

export function startActiveSegment(
  state: PickLineMrpState,
  mrp: number,
  custom = false,
): PickLineMrpState {
  const segments = [...state.segments];
  const idx = segments.length;
  segments.push({ mrp, qty: 0, custom, committed: false });
  return { ...state, segments, activeSegmentIndex: idx };
}

export function commitActiveSegment(
  state: PickLineMrpState,
  qty: number,
  orderItemId: number,
): PickLineMrpState {
  const idx = state.activeSegmentIndex;
  if (idx == null) return state;
  const segments = state.segments.map((s, i) =>
    i === idx ? { ...s, qty, committed: true, orderItemId } : s,
  );
  return { ...state, segments, activeSegmentIndex: null };
}

const STORAGE_PREFIX = 'paspl.pick.lineMrp.v2';
const LAB_STORAGE_PREFIX = 'paspl.pick.lab.lineMrp.v2';

function lineMrpStorageKey(
  orderId: number,
  scope: 'production' | 'lab' = 'production',
): string {
  const prefix = scope === 'lab' ? LAB_STORAGE_PREFIX : STORAGE_PREFIX;
  return `${prefix}:${orderId}`;
}

function parseSegment(raw: unknown): PickMrpSegment | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const mrp = Number(row.mrp);
  const qty = Number(row.qty);
  if (!Number.isFinite(mrp) || !Number.isFinite(qty)) return null;
  return {
    mrp,
    qty,
    custom: row.custom === true,
    orderItemId: row.orderItemId != null ? Number(row.orderItemId) : undefined,
    committed: row.committed === true,
  };
}

function parsePickLineMrpState(raw: Record<string, unknown>): PickLineMrpState {
  const segmentsRaw = Array.isArray(raw.segments) ? raw.segments : [];
  const segments = segmentsRaw.map(parseSegment).filter((s): s is PickMrpSegment => s != null);
  return {
    mode: raw.mode === 'split' ? 'split' : 'single',
    confirmedMrp: raw.confirmedMrp != null ? Number(raw.confirmedMrp) : null,
    customMrp: raw.customMrp != null ? Number(raw.customMrp) : null,
    segments,
    activeSegmentIndex:
      raw.activeSegmentIndex != null ? Number(raw.activeSegmentIndex) : null,
    originalTargetQty:
      raw.originalTargetQty != null ? Number(raw.originalTargetQty) : null,
    rootOrderItemId: raw.rootOrderItemId != null ? Number(raw.rootOrderItemId) : null,
  };
}

export function readPickLineMrpMap(
  orderId: number | null,
  scope: 'production' | 'lab' = 'production',
): Map<number, PickLineMrpState> {
  if (!orderId || typeof window === 'undefined') return new Map();
  try {
    const raw = window.sessionStorage.getItem(lineMrpStorageKey(orderId, scope));
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return new Map();
    const out = new Map<number, PickLineMrpState>();
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      const id = Number(key);
      if (!Number.isFinite(id) || !val || typeof val !== 'object') continue;
      out.set(id, parsePickLineMrpState(val as Record<string, unknown>));
    }
    return out;
  } catch {
    return new Map();
  }
}

export function writePickLineMrpMap(
  orderId: number | null,
  map: Map<number, PickLineMrpState>,
  scope: 'production' | 'lab' = 'production',
): void {
  if (!orderId || typeof window === 'undefined') return;
  try {
    const obj: Record<string, PickLineMrpState> = {};
    for (const [id, state] of map) obj[String(id)] = state;
    window.sessionStorage.setItem(lineMrpStorageKey(orderId, scope), JSON.stringify(obj));
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
  segmentMrp?: number | null,
): ScanResult {
  const finalMrp = segmentMrp ?? pickLineMrpFinal(state);
  if (finalMrp == null) return scanResult;

  const mrpSegments =
    state && isSplitMode(state)
      ? state.segments
          .filter((s) => s.committed)
          .map((s) => ({
            mrp: s.mrp,
            qty: s.qty,
            orderItemId: s.orderItemId ?? 0,
          }))
      : undefined;

  return {
    ...scanResult,
    ocrExtracted: {
      ...scanResult.ocrExtracted,
      mrp: finalMrp,
    },
    confirmedMrp: finalMrp,
    mrpFlagged: isPickLineMrpFlagged(state, latestMrp, finalMrp),
    mrpSource: finalMrp != null ? mrpSource : null,
    mrpHistoryCount: historyCount,
    mrpSegments,
    splitFromId: state?.rootOrderItemId ?? undefined,
  };
}
