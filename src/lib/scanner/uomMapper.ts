import { saveBarcodeMapping, type SaveBarcodeMappingResult } from '../barcodeMapping';
import { supabase } from '../supabase/client';
import { buildSaveInputForScan } from './oemBarcodeEngine';
import { parseManufacturerBarcode } from './barcodeParser';
import { classifyScanPayload, normalizeScanCode } from './qrPayload';

export type UomTier = 'piece' | 'packet' | 'box';
export type SellingUnit = UomTier;

export type UomResolveSource =
  | 'pack_def'
  | 'lpn'
  | 'barcode_override'
  | 'barcode_default'
  | 'catalog'
  | 'barcode_mapping';

export interface ResolvedUom {
  matched: boolean;
  busyCode: number | null;
  itemId: number | null;
  itemName: string | null;
  sellingUnit: SellingUnit;
  tier: UomTier | null;
  baseQtyEa: number | null;
  packetQtyEa: number | null;
  packetsPerBox: number | null;
  source: UomResolveSource | 'rack_payload' | 'empty_payload' | 'no_catalog_match' | 'unknown' | null;
  reason?: string | null;
}

interface RpcUomRow {
  matched?: boolean;
  busy_code?: number | string | null;
  item_id?: number | string | null;
  item_name?: string | null;
  selling_unit?: string | null;
  tier?: string | null;
  base_qty_ea?: number | string | null;
  packet_qty_ea?: number | string | null;
  packets_per_box?: number | string | null;
  source?: string | null;
  reason?: string | null;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function mapRpc(payload: RpcUomRow | null): ResolvedUom {
  if (!payload || typeof payload !== 'object') {
    return {
      matched: false,
      busyCode: null,
      itemId: null,
      itemName: null,
      sellingUnit: 'piece',
      tier: null,
      baseQtyEa: null,
      packetQtyEa: null,
      packetsPerBox: null,
      source: 'unknown',
      reason: 'invalid_rpc_payload',
    };
  }

  const matched = Boolean(payload.matched);
  const tierRaw = payload.tier;
  const tier: UomTier | null =
    tierRaw === 'piece' || tierRaw === 'packet' || tierRaw === 'box' ? tierRaw : null;

  const sellingRaw = payload.selling_unit;
  const sellingUnit: SellingUnit =
    sellingRaw === 'packet' || sellingRaw === 'box' ? sellingRaw : 'piece';

  const source = (payload.source ?? null) as ResolvedUom['source'];

  return {
    matched,
    busyCode: num(payload.busy_code),
    itemId: num(payload.item_id),
    itemName: typeof payload.item_name === 'string' ? payload.item_name : null,
    sellingUnit,
    tier,
    baseQtyEa: num(payload.base_qty_ea),
    packetQtyEa: num(payload.packet_qty_ea),
    packetsPerBox: num(payload.packets_per_box),
    source,
    reason: typeof payload.reason === 'string' ? payload.reason : null,
  };
}

/**
 * Single round-trip UoM resolution for a raw scan (QR/barcode).
 * Passes through normalized candidates from `collectQrLookupCandidates` when available.
 */
export async function resolveScanToUom(rawValue: string): Promise<ResolvedUom> {
  const trimmed = rawValue?.trim() ?? '';
  if (!trimmed) {
    return {
      matched: false,
      busyCode: null,
      itemId: null,
      itemName: null,
      sellingUnit: 'piece',
      tier: null,
      baseQtyEa: null,
      packetQtyEa: null,
      packetsPerBox: null,
      source: 'empty_payload',
      reason: 'empty_payload',
    };
  }

  const classified = classifyScanPayload(trimmed);
  const candidates = classified.normalizedCandidates;

  const extractedPieceQty =
    classified.kind === 'sku' &&
    classified.extractedQuantity != null &&
    classified.extractedQuantity > 0
      ? classified.extractedQuantity
      : null;

  try {
    const { data, error } = await supabase.rpc('resolve_scan_to_uom', {
      p_raw_value: trimmed,
      p_normalized_candidates: candidates.length > 0 ? candidates : null,
      p_extracted_piece_qty: extractedPieceQty,
    });

    if (error) {
      return {
        matched: false,
        busyCode: null,
        itemId: null,
        itemName: null,
        sellingUnit: 'piece',
        tier: null,
        baseQtyEa: null,
        packetQtyEa: null,
        packetsPerBox: null,
        source: 'unknown',
        reason: error.message,
      };
    }

    return mapRpc(data as RpcUomRow);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'resolve_scan_to_uom_failed';
    return {
      matched: false,
      busyCode: null,
      itemId: null,
      itemName: null,
      sellingUnit: 'piece',
      tier: null,
      baseQtyEa: null,
      packetQtyEa: null,
      packetsPerBox: null,
      source: 'unknown',
      reason: message,
    };
  }
}

/** Human-readable breakdown for pick/billing UI (EA is authoritative). */
export function formatUomPickHint(args: {
  suggestedQtyEa: number;
  tier: UomTier | null;
  packetQtyEa: number | null;
  packetsPerBox: number | null;
  packPayloadType?: 'inner' | 'outer' | null;
}): string | null {
  const { suggestedQtyEa, tier, packetQtyEa, packetsPerBox, packPayloadType } = args;
  if (!Number.isFinite(suggestedQtyEa) || suggestedQtyEa < 1) return null;

  const tierLabel =
    packPayloadType === 'inner'
      ? 'packet'
      : packPayloadType === 'outer'
        ? 'box'
        : tier === 'packet'
          ? 'packet'
          : tier === 'box'
            ? 'box'
            : null;

  if (tierLabel === 'box' && packetsPerBox != null && packetQtyEa != null && packetQtyEa > 0) {
    return `${suggestedQtyEa} pcs (1 box ≈ ${packetsPerBox} packets × ${packetQtyEa} pcs)`;
  }
  if (tierLabel === 'packet' && packetQtyEa != null && packetQtyEa > 0) {
    return `${suggestedQtyEa} pcs (1 packet × ${packetQtyEa} pcs)`;
  }
  if (tier === 'piece' && suggestedQtyEa > 1) {
    return `${suggestedQtyEa} pcs (piece-level scan)`;
  }
  return null;
}

export interface UomCoverageGapRow {
  busy_code: number;
  item_id: number;
  item_name: string;
  confirmed_at: string | null;
  inner_pack_qty: number | null;
  outer_pack_qty: number | null;
}

export type RegisterBarcodeWithTierResult =
  | { ok: true; barcodeStatus: SaveBarcodeMappingResult['status'] }
  | { ok: false; kind: 'invalid'; message: string }
  | { ok: false; kind: 'wrong_sku'; resolvedBusyCode: number; resolvedItemName: string | null }
  | { ok: false; kind: 'conflict'; result: SaveBarcodeMappingResult };

/**
 * Save manufacturer barcode → SKU (`item_barcodes`) and attach a UoM tier for that scan key
 * (`item_qr_tier_overrides`). Does not stamp pack-definition confirmation — final Save SKU does that.
 */
export async function registerBarcodeWithTier(params: {
  rawValue: string;
  skuBusyCode: number;
  binId: string | null;
  manufacturer: string | null;
  mappedByUserId: number | null;
  mappedByName: string | null;
  tier: UomTier;
  force?: boolean;
}): Promise<RegisterBarcodeWithTierResult> {
  const parsed = parseManufacturerBarcode(params.rawValue.trim());
  if (!parsed.key?.trim()) {
    return { ok: false, kind: 'invalid', message: 'Barcode was empty after parsing.' };
  }

  const uom = await resolveScanToUom(params.rawValue.trim());
  if (
    uom.matched &&
    uom.busyCode != null &&
    Number(uom.busyCode) !== Number(params.skuBusyCode)
  ) {
    return {
      ok: false,
      kind: 'wrong_sku',
      resolvedBusyCode: Number(uom.busyCode),
      resolvedItemName: uom.itemName,
    };
  }

  const saveInput = buildSaveInputForScan(parsed, {
    skuBusyCode: params.skuBusyCode,
    binId: params.binId,
    manufacturer: params.manufacturer,
    mappedByUserId: params.mappedByUserId,
    mappedByName: params.mappedByName,
  });

  const mapped = await saveBarcodeMapping({ ...saveInput, force: params.force ?? false });

  if (mapped.status === 'conflict') {
    return { ok: false, kind: 'conflict', result: mapped };
  }

  if (!mapped.success) {
    return { ok: false, kind: 'invalid', message: mapped.message ?? 'Could not save barcode mapping.' };
  }

  const barcodeKey = normalizeScanCode(parsed.key);
  if (!barcodeKey) {
    return { ok: false, kind: 'invalid', message: 'Could not normalize barcode key.' };
  }

  const { error: tierError } = await supabase.from('item_qr_tier_overrides').upsert(
    {
      busy_code: params.skuBusyCode,
      barcode_key: barcodeKey,
      tier: params.tier,
      created_by_user_id: params.mappedByUserId,
    },
    { onConflict: 'barcode_key' },
  );

  if (tierError) {
    return { ok: false, kind: 'invalid', message: tierError.message };
  }

  return { ok: true, barcodeStatus: mapped.status };
}

export async function fetchUomCoverageGaps(limit = 500): Promise<UomCoverageGapRow[]> {
  const { data, error } = await supabase.rpc('list_uom_coverage_gaps', {
    p_limit: limit,
  });
  if (error) throw error;
  const payload = data as { success?: boolean; rows?: unknown } | null;
  const rows = payload?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      busy_code: Number(row.busy_code),
      item_id: Number(row.item_id),
      item_name: String(row.item_name ?? ''),
      confirmed_at: row.confirmed_at != null ? String(row.confirmed_at) : null,
      inner_pack_qty: row.inner_pack_qty != null ? Number(row.inner_pack_qty) : null,
      outer_pack_qty: row.outer_pack_qty != null ? Number(row.outer_pack_qty) : null,
    };
  });
}
