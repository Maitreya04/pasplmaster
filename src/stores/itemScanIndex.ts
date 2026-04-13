import { create } from 'zustand';
import { queryClient } from '../lib/queryClient';
import { fetchAllItems, ITEMS_QUERY_KEY } from '../hooks/useItems';
import type { Item } from '../types';
import { itemPickCode } from '../utils/itemCodes';
import { collectQrLookupCandidates, normalizeScanCode } from '../lib/scanner/qrPayload';

export interface ScanCatalogItem extends Item {
  itemCode: string;
}

export type ScanMatchSource = 'alias1' | 'alias' | 'item_code';

export interface ScanLookupResult {
  code: string;
  item: ScanCatalogItem;
  source: ScanMatchSource;
}

interface ItemScanIndexState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  itemsById: Map<number, ScanCatalogItem>;
  alias1Map: Map<string, ScanCatalogItem>;
  aliasMap: Map<string, ScanCatalogItem>;
  itemCodeMap: Map<string, ScanCatalogItem>;
  setLoading: () => void;
  setReady: (payload: {
    itemsById: Map<number, ScanCatalogItem>;
    alias1Map: Map<string, ScanCatalogItem>;
    aliasMap: Map<string, ScanCatalogItem>;
    itemCodeMap: Map<string, ScanCatalogItem>;
  }) => void;
  setError: (message: string) => void;
}

function firstWriteWins(map: Map<string, ScanCatalogItem>, key: string, item: ScanCatalogItem) {
  if (!key || map.has(key)) return;
  map.set(key, item);
}

function buildIndex(items: Item[]) {
  const itemsById = new Map<number, ScanCatalogItem>();
  const alias1Map = new Map<string, ScanCatalogItem>();
  const aliasMap = new Map<string, ScanCatalogItem>();
  const itemCodeMap = new Map<string, ScanCatalogItem>();

  for (const item of items) {
    const scanItem: ScanCatalogItem = {
      ...item,
      itemCode: itemPickCode(item),
    };
    itemsById.set(scanItem.id, scanItem);
    firstWriteWins(alias1Map, normalizeScanCode(scanItem.alias1), scanItem);
    firstWriteWins(aliasMap, normalizeScanCode(scanItem.alias), scanItem);
    firstWriteWins(itemCodeMap, normalizeScanCode(scanItem.itemCode), scanItem);
  }

  return { itemsById, alias1Map, aliasMap, itemCodeMap };
}

export const useItemScanIndexStore = create<ItemScanIndexState>((set) => ({
  status: 'idle',
  error: null,
  itemsById: new Map(),
  alias1Map: new Map(),
  aliasMap: new Map(),
  itemCodeMap: new Map(),
  setLoading: () => set({ status: 'loading', error: null }),
  setReady: ({ itemsById, alias1Map, aliasMap, itemCodeMap }) =>
    set({
      status: 'ready',
      error: null,
      itemsById,
      alias1Map,
      aliasMap,
      itemCodeMap,
    }),
  setError: (message) =>
    set({
      status: 'error',
      error: message,
    }),
}));

let initializePromise: Promise<void> | null = null;

export async function initializeItemScanIndex(): Promise<void> {
  const state = useItemScanIndexStore.getState();
  if (state.status === 'ready') return;
  if (initializePromise) return initializePromise;

  state.setLoading();
  initializePromise = queryClient
    .ensureQueryData({
      queryKey: ITEMS_QUERY_KEY,
      queryFn: fetchAllItems,
      staleTime: Number.POSITIVE_INFINITY,
    })
    .then((items) => {
      useItemScanIndexStore.getState().setReady(buildIndex(items));
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
  const { alias1Map, aliasMap, itemCodeMap } = useItemScanIndexStore.getState();

  for (const code of collectQrLookupCandidates(rawValue)) {
    const alias1Hit = alias1Map.get(code);
    if (alias1Hit) return { code, item: alias1Hit, source: 'alias1' };

    const aliasHit = aliasMap.get(code);
    if (aliasHit) return { code, item: aliasHit, source: 'alias' };

    const itemCodeHit = itemCodeMap.get(code);
    if (itemCodeHit) return { code, item: itemCodeHit, source: 'item_code' };
  }

  return null;
}

export function getScanCatalogItemById(itemId: number): ScanCatalogItem | null {
  return useItemScanIndexStore.getState().itemsById.get(itemId) ?? null;
}
