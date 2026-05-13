import { supabase } from './supabase/client';
import { parseRackPayload } from './scanner/qrPayload';
import type { MatchStrategy } from './scanner/barcodeParser';
import type { Item } from '../types';

const ITEM_SELECT = 'id,name,busy_code,parent_group,main_group,item_category,rack_no,alias,alias1';

type ItemLookupRow = Pick<
  Item,
  'id' | 'name' | 'busy_code' | 'parent_group' | 'main_group' | 'item_category' | 'rack_no' | 'alias' | 'alias1'
>;

interface BinInventoryRow {
  bin_id: string;
  sku_busy_code: number | string;
  item_name_snapshot: string | null;
}

export interface BarcodeSkuOption {
  binId: string;
  skuBusyCode: number;
  itemId: number | null;
  itemName: string;
  alias1: string | null;
  alias: string | null;
  mainGroup: string | null;
  parentGroup: string | null;
  itemCategory: string | null;
  rackNo: string | null;
  source: 'bin_inventory' | 'items_rack_no' | 'search';
}

export interface BarcodeCoverage {
  total_active_skus: number;
  mapped_skus: number;
  unmapped_skus: number;
  coverage_pct: number;
}

export interface MappedSkuSummary {
  skuBusyCode: number;
}

export interface BarcodeRackCoverageSummary {
  rack_count: number;
  racks_complete: number;
  racks_in_progress: number;
  racks_without_mappings: number;
}

export interface BarcodeRackCoverageRow {
  rack_id: string;
  total_skus: number;
  mapped_skus: number;
  unmapped_skus: number;
  coverage_pct: number;
}

export interface BarcodeRackCoveragePayload {
  summary: BarcodeRackCoverageSummary;
  racks: BarcodeRackCoverageRow[];
}

export interface SaveBarcodeMappingInput {
  barcodeRaw: string;
  barcodeKey: string;
  matchStrategy: MatchStrategy;
  skuBusyCode: number;
  binId: string | null;
  manufacturer: string | null;
  mappedByUserId: number | null;
  mappedByName: string | null;
  force?: boolean;
}

export interface SaveBarcodeMappingResult {
  success: boolean;
  status: 'saved' | 'already_mapped' | 'conflict' | 'overridden' | 'invalid';
  message?: string;
  barcode_key?: string;
  sku_busy_code?: number;
  item_name?: string | null;
  existing_sku?: number;
  existing_item_name?: string | null;
  existing_bin_id?: string | null;
  new_sku?: number;
  new_item_name?: string | null;
}

export function normalizeBinCode(value: string): string {
  const parsed = parseRackPayload(value);
  if (parsed?.rackCode) return parsed.rackCode;
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function toSkuOption({
  binId,
  skuBusyCode,
  item,
  itemNameSnapshot,
  source,
}: {
  binId: string;
  skuBusyCode: number;
  item: ItemLookupRow | null;
  itemNameSnapshot?: string | null;
  source: BarcodeSkuOption['source'];
}): BarcodeSkuOption {
  return {
    binId,
    skuBusyCode,
    itemId: item?.id ?? null,
    itemName: item?.name ?? itemNameSnapshot ?? `Busy ${skuBusyCode}`,
    alias1: item?.alias1 ?? null,
    alias: item?.alias ?? null,
    mainGroup: item?.main_group ?? null,
    parentGroup: item?.parent_group ?? null,
    itemCategory: item?.item_category ?? null,
    rackNo: item?.rack_no ?? binId,
    source,
  };
}

async function fetchItemsByBusyCodes(busyCodes: number[]): Promise<Map<number, ItemLookupRow>> {
  if (busyCodes.length === 0) return new Map();

  const { data, error } = await supabase
    .from('items')
    .select(ITEM_SELECT)
    .in('busy_code', busyCodes);

  if (error) throw error;

  const rows = (data ?? []) as ItemLookupRow[];
  return new Map(rows.map((item) => [Number(item.busy_code), item]));
}

export async function loadSkuOptionsFromBin(rawBinId: string): Promise<BarcodeSkuOption[]> {
  const binId = normalizeBinCode(rawBinId);
  if (!binId) return [];

  const { data: binRows, error: binError } = await supabase
    .from('bin_inventory')
    .select('bin_id,sku_busy_code,item_name_snapshot')
    .eq('bin_id', binId)
    .limit(25);

  if (binError) throw binError;

  const bins = (binRows ?? []) as BinInventoryRow[];
  if (bins.length > 0) {
    const skuCodes = [...new Set(bins.map((row) => Number(row.sku_busy_code)).filter(Number.isFinite))];
    const itemsByBusy = await fetchItemsByBusyCodes(skuCodes);
    return bins
      .map((row) => {
        const skuBusyCode = Number(row.sku_busy_code);
        if (!Number.isFinite(skuBusyCode)) return null;
        return toSkuOption({
          binId,
          skuBusyCode,
          item: itemsByBusy.get(skuBusyCode) ?? null,
          itemNameSnapshot: row.item_name_snapshot,
          source: 'bin_inventory',
        });
      })
      .filter((option): option is BarcodeSkuOption => option !== null);
  }

  const { data: rackItems, error: rackError } = await supabase
    .from('items')
    .select(ITEM_SELECT)
    .eq('is_active', true)
    .eq('rack_no', binId)
    .not('busy_code', 'is', null)
    .limit(25);

  if (rackError) throw rackError;

  return ((rackItems ?? []) as ItemLookupRow[]).map((item) =>
    toSkuOption({
      binId,
      skuBusyCode: Number(item.busy_code),
      item,
      source: 'items_rack_no',
    }),
  );
}

export async function saveBarcodeMapping(
  input: SaveBarcodeMappingInput,
): Promise<SaveBarcodeMappingResult> {
  const { data, error } = await supabase.rpc('save_barcode_mapping', {
    p_barcode_raw: input.barcodeRaw,
    p_barcode_key: input.barcodeKey,
    p_match_strategy: input.matchStrategy,
    p_sku_busy_code: input.skuBusyCode,
    p_bin_id: input.binId,
    p_manufacturer: input.manufacturer,
    p_mapped_by_user_id: input.mappedByUserId,
    p_mapped_by_name: input.mappedByName,
    p_force: input.force ?? false,
  });

  if (error) throw error;
  return data as SaveBarcodeMappingResult;
}

export async function fetchBarcodeCoverage(): Promise<BarcodeCoverage> {
  const { data, error } = await supabase.rpc('get_barcode_coverage');
  if (error) throw error;
  return data as BarcodeCoverage;
}

export async function fetchBarcodeRackCoverage(): Promise<BarcodeRackCoveragePayload> {
  const { data, error } = await supabase.rpc('get_barcode_rack_coverage');
  if (error) throw error;
  const emptySummary: BarcodeRackCoverageSummary = {
    rack_count: 0,
    racks_complete: 0,
    racks_in_progress: 0,
    racks_without_mappings: 0,
  };
  if (data == null || typeof data !== 'object') {
    return { summary: emptySummary, racks: [] };
  }
  const payload = data as {
    summary?: Partial<BarcodeRackCoverageSummary>;
    racks?: BarcodeRackCoverageRow[];
  };
  return {
    summary: {
      rack_count: Number(payload.summary?.rack_count ?? 0),
      racks_complete: Number(payload.summary?.racks_complete ?? 0),
      racks_in_progress: Number(payload.summary?.racks_in_progress ?? 0),
      racks_without_mappings: Number(payload.summary?.racks_without_mappings ?? 0),
    },
    racks: Array.isArray(payload.racks) ? payload.racks : [],
  };
}

export async function fetchMappedSkuSummaries(): Promise<MappedSkuSummary[]> {
  const { data, error } = await supabase
    .from('item_barcodes')
    .select('sku_busy_code')
    .not('sku_busy_code', 'is', null)
    .limit(50_000);

  if (error) throw error;

  const unique = new Set<number>();
  for (const row of data ?? []) {
    const skuBusyCode = Number((row as { sku_busy_code: number | string }).sku_busy_code);
    if (Number.isFinite(skuBusyCode)) unique.add(skuBusyCode);
  }

  return [...unique].map((skuBusyCode) => ({ skuBusyCode }));
}

/**
 * Look up a single SKU by busy_code from the items table.
 * Used by the "Scan First" mapping flow where there is no bin context.
 */
export async function loadSkuFromBusyCode(busyCode: number): Promise<BarcodeSkuOption | null> {
  const { data, error } = await supabase
    .from('items')
    .select(ITEM_SELECT)
    .eq('busy_code', busyCode)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const item = data as ItemLookupRow;
  return toSkuOption({
    binId: item.rack_no ?? '',
    skuBusyCode: Number(item.busy_code),
    item,
    source: 'search',
  });
}
