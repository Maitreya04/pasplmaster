import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { OpenPoDemandLine } from './useOpenPoDemandLines';
import { lineBusyCode } from '../components/supply/supplyDemandShared';
import {
  useLocationwiseStock,
  type ItemLocationStock,
} from './useLocationwiseStock';
import type { PendingItem } from '../types';

export type SupplyDemandStockContext = {
  busyCodeByItemId: Map<number, number | null>;
  stockByBusyCode: Record<number, ItemLocationStock>;
  stockFetching: boolean;
  stockForItemId: (itemId: number) => ItemLocationStock | undefined;
  stockLoadingForItemId: (itemId: number) => boolean;
};

export function useSupplyDemandLocationStock(
  demandLines: OpenPoDemandLine[],
  pendingItems: PendingItem[] = [],
): SupplyDemandStockContext {
  const itemIds = useMemo(() => {
    const ids = new Set<number>();
    for (const line of demandLines) ids.add(line.item_id);
    for (const item of pendingItems) {
      if (typeof item.item_id === 'number') ids.add(item.item_id);
    }
    return [...ids].sort((a, b) => a - b);
  }, [demandLines, pendingItems]);

  const itemIdsKey = itemIds.join(',');

  const { data: itemRows = [] } = useQuery({
    queryKey: ['supply-demand-item-busy-codes', itemIdsKey],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('items')
        .select('id, busy_code')
        .in('id', itemIds);
      if (error) throw error;
      return (data ?? []) as Array<{ id: number; busy_code: number | null }>;
    },
    enabled: itemIds.length > 0,
    staleTime: 60_000,
  });

  const busyCodeByItemId = useMemo(() => {
    const map = new Map<number, number | null>();
    for (const line of demandLines) {
      const fromLine = lineBusyCode(line);
      if (fromLine != null) map.set(line.item_id, fromLine);
    }
    for (const row of itemRows) {
      const bc = row.busy_code == null ? null : Number(row.busy_code);
      map.set(row.id, Number.isFinite(bc) ? bc : null);
    }
    return map;
  }, [demandLines, itemRows]);

  const busyCodes = useMemo(
    () =>
      [
        ...new Set(
          [...busyCodeByItemId.values()].filter(
            (code): code is number => code != null && Number.isFinite(code),
          ),
        ),
      ].sort((a, b) => a - b),
    [busyCodeByItemId],
  );

  const { data: stockByBusyCode = {}, isFetching: stockFetching } = useLocationwiseStock(busyCodes);

  const stockForItemId = useMemo(() => {
    return (itemId: number): ItemLocationStock | undefined => {
      const busyCode = busyCodeByItemId.get(itemId);
      if (busyCode == null || !Number.isFinite(busyCode)) return undefined;
      return stockByBusyCode[busyCode];
    };
  }, [busyCodeByItemId, stockByBusyCode]);

  const stockLoadingForItemId = useMemo(() => {
    return (itemId: number): boolean => {
      const busyCode = busyCodeByItemId.get(itemId);
      if (busyCode == null || !Number.isFinite(busyCode)) return false;
      if (stockByBusyCode[busyCode]) return false;
      return stockFetching;
    };
  }, [busyCodeByItemId, stockByBusyCode, stockFetching]);

  return {
    busyCodeByItemId,
    stockByBusyCode,
    stockFetching,
    stockForItemId,
    stockLoadingForItemId,
  };
}
