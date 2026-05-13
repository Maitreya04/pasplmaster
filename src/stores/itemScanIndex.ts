import { create } from 'zustand';
import { queryClient } from '../lib/queryClient';
import { fetchAllItems, ITEMS_QUERY_KEY } from '../hooks/useItems';
import type { Item } from '../types';
import { itemPickCode } from '../utils/itemCodes';
import { collectQrLookupCandidates, normalizeScanCode } from '../lib/scanner/qrPayload';
import { supabase } from '../lib/supabase/client';

export interface ScanCatalogItem extends Item {
  itemCode: string;
}

export type ScanMatchSource = 'alias1' | 'alias' | 'item_code' | 'pack' | 'barcode_mapping';

export interface ScanLookupResult {
  code: string;
  item: ScanCatalogItem;
  source: ScanMatchSource;
}

interface BarcodeMappingRow {
  barcode_key: string;
  sku_busy_code: number;
}

interface ItemScanIndexState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  itemsById: Map<number, ScanCatalogItem>;
  alias1Map: Map<string, ScanCatalogItem>;
  aliasMap: Map<string, ScanCatalogItem>;
  itemCodeMap: Map<string, ScanCatalogItem>;
  barcodeMappingMap: Map<string, ScanCatalogItem>;
  setLoading: () => void;
  setReady: (payload: {
    itemsById: Map<number, ScanCatalogItem>;
    alias1Map: Map<string, ScanCatalogItem>;
    aliasMap: Map<string, ScanCatalogItem>;
    itemCodeMap: Map<string, ScanCatalogItem>;
    barcodeMappingMap: Map<string, ScanCatalogItem>;
  }) => void;
  setError: (message: string) => void;
}

function firstWriteWins(map: Map<string, ScanCatalogItem>, key: string, item: ScanCatalogItem) {
  if (!key || map.has(key)) return;
  map.set(key, item);
}

function buildIndex(items: Item[], barcodeMappings: BarcodeMappingRow[]) {
  const itemsById = new Map<number, ScanCatalogItem>();
  const itemsByBusyCode = new Map<number, ScanCatalogItem>();
  const alias1Map = new Map<string, ScanCatalogItem>();
  const aliasMap = new Map<string, ScanCatalogItem>();
  const itemCodeMap = new Map<string, ScanCatalogItem>();
  const barcodeMappingMap = new Map<string, ScanCatalogItem>();

  for (const item of items) {
    const scanItem: ScanCatalogItem = {
      ...item,
      itemCode: itemPickCode(item),
    };
    itemsById.set(scanItem.id, scanItem);
    if (scanItem.busy_code != null) {
      itemsByBusyCode.set(Number(scanItem.busy_code), scanItem);
    }
    firstWriteWins(alias1Map, normalizeScanCode(scanItem.alias1), scanItem);
    firstWriteWins(aliasMap, normalizeScanCode(scanItem.alias), scanItem);
    firstWriteWins(itemCodeMap, normalizeScanCode(scanItem.itemCode), scanItem);
  }

  for (const mapping of barcodeMappings) {
    const normalizedKey = normalizeScanCode(mapping.barcode_key);
    if (!normalizedKey || barcodeMappingMap.has(normalizedKey)) continue;
    const skuItem = itemsByBusyCode.get(Number(mapping.sku_busy_code));
    if (!skuItem) continue;
    barcodeMappingMap.set(normalizedKey, skuItem);
  }

  return { itemsById, alias1Map, aliasMap, itemCodeMap, barcodeMappingMap };
}

export const useItemScanIndexStore = create<ItemScanIndexState>((set) => ({
  status: 'idle',
  error: null,
  itemsById: new Map(),
  alias1Map: new Map(),
  aliasMap: new Map(),
  itemCodeMap: new Map(),
  barcodeMappingMap: new Map(),
  setLoading: () => set({ status: 'loading', error: null }),
  setReady: ({ itemsById, alias1Map, aliasMap, itemCodeMap, barcodeMappingMap }) =>
    set({
      status: 'ready',
      error: null,
      itemsById,
      alias1Map,
      aliasMap,
      itemCodeMap,
      barcodeMappingMap,
    }),
  setError: (message) =>
    set({
      status: 'error',
      error: message,
    }),
}));

let initializePromise: Promise<void> | null = null;

async function fetchBarcodeMappings(): Promise<BarcodeMappingRow[]> {
  const { data, error } = await supabase
    .from('item_barcodes')
    .select('barcode_key,sku_busy_code')
    .limit(100_000);
  if (error) throw error;
  return (data ?? []) as BarcodeMappingRow[];
}

export async function initializeItemScanIndex(): Promise<void> {
  const state = useItemScanIndexStore.getState();
  if (state.status === 'ready') return;
  if (initializePromise) return initializePromise;

  state.setLoading();
  initializePromise = Promise.all([
    queryClient.ensureQueryData({
      queryKey: ITEMS_QUERY_KEY,
      queryFn: fetchAllItems,
      staleTime: Number.POSITIVE_INFINITY,
    }),
    fetchBarcodeMappings(),
  ])
    .then(([items, barcodeMappings]) => {
      useItemScanIndexStore.getState().setReady(buildIndex(items, barcodeMappings));
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Failed to load scan index';
      useItemScanIndexStore.getState().setError(message);
      throw error;
    })
    .finally(() => {
      initializePromise = null;
    });

  return initializePromise;
}

export function resolveScannedCatalogItem(rawValue: string): ScanLookupResult | null {
  const { alias1Map, aliasMap, itemCodeMap, barcodeMappingMap } = useItemScanIndexStore.getState();

  for (const code of collectQrLookupCandidates(rawValue)) {
    const alias1Hit = alias1Map.get(code);
    if (alias1Hit) return { code, item: alias1Hit, source: 'alias1' };

    const aliasHit = aliasMap.get(code);
    if (aliasHit) return { code, item: aliasHit, source: 'alias' };

    const itemCodeHit = itemCodeMap.get(code);
    if (itemCodeHit) return { code, item: itemCodeHit, source: 'item_code' };

    const barcodeMappingHit = barcodeMappingMap.get(code);
    if (barcodeMappingHit) return { code, item: barcodeMappingHit, source: 'barcode_mapping' };
  }

  return null;
}

export function getScanCatalogItemById(itemId: number): ScanCatalogItem | null {
  return useItemScanIndexStore.getState().itemsById.get(itemId) ?? null;
}
