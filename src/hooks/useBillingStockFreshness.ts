import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { OrderItem, StockLocationCode } from '../types';
import { normalizeBusyCodes } from './useLocationwiseStock';

export type BillingFreshnessRow = {
  orderItemId: number;
  savedShippable: number;
  qtyRequested: number;
  liveCapacity: number | null;
  isStale: boolean;
};

/** Active reservations linked to specific order lines (for add-back vs locationwise view). */
export async function fetchStockReservationsByOrderItem(
  orderId: number,
): Promise<Map<number, number>> {
  const { data, error } = await supabase
    .from('stock_reservations')
    .select('order_item_id, qty_reserved')
    .eq('order_id', orderId)
    .in('status', ['active', 'awaiting_erp_sync']);

  if (error) throw error;

  const m = new Map<number, number>();
  for (const row of data ?? []) {
    const oid = row.order_item_id as number | null | undefined;
    if (oid == null || typeof oid !== 'number') continue;
    const q = Number(row.qty_reserved ?? 0);
    m.set(oid, (m.get(oid) ?? 0) + (Number.isFinite(q) ? q : 0));
  }
  return m;
}

/** Available qty per busy_code at one warehouse location (from `locationwise_stock_available`). */
export async function fetchLocationwiseAvailableForBusyCodes(
  busyCodes: number[],
  stockLocationCode: StockLocationCode | string | null | undefined,
): Promise<Map<number, number>> {
  const loc = (stockLocationCode ?? 'main_store') as string;
  if (busyCodes.length === 0) return new Map();

  const { data, error } = await supabase
    .from('locationwise_stock_available')
    .select('busy_code, available_qty')
    .eq('stock_location_code', loc)
    .in('busy_code', busyCodes);

  if (error) throw error;

  const m = new Map<number, number>();
  for (const row of data ?? []) {
    const bc = Number(row.busy_code);
    if (!Number.isFinite(bc)) continue;
    const aq = row.available_qty == null ? 0 : Math.floor(Number(row.available_qty));
    m.set(bc, Number.isFinite(aq) ? Math.max(0, aq) : 0);
  }
  return m;
}

export function computeBillingFreshnessByOrderItem(
  items: OrderItem[],
  availByBusyCode: Map<number, number>,
  reservedByOrderItemId: Map<number, number>,
): Record<number, BillingFreshnessRow> {
  const out: Record<number, BillingFreshnessRow> = {};

  for (const item of items) {
    const qtyReq = item.qty_requested;
    const savedShippable = item.qty_shippable ?? qtyReq;
    const bcRaw = item.catalog_busy_code;
    const bc = bcRaw != null ? Number(bcRaw) : null;

    if (bc == null || !Number.isFinite(bc)) {
      out[item.id] = {
        orderItemId: item.id,
        savedShippable,
        qtyRequested: qtyReq,
        liveCapacity: null,
        isStale: false,
      };
      continue;
    }

    const viewAvail = availByBusyCode.get(bc) ?? 0;
    const reservedHere = reservedByOrderItemId.get(item.id) ?? 0;
    const liveCapacity = Math.min(qtyReq, Math.max(0, viewAvail + reservedHere));

    out[item.id] = {
      orderItemId: item.id,
      savedShippable,
      qtyRequested: qtyReq,
      liveCapacity,
      isStale: savedShippable !== liveCapacity,
    };
  }

  return out;
}

function itemsFreshnessSignature(items: OrderItem[]): string {
  return items.map((i) => `${i.id}:${i.qty_shippable ?? ''}:${i.qty_requested}`).join('|');
}

export function useBillingStockFreshness(
  orderId: number | null,
  items: OrderItem[],
  stockLocationCode: StockLocationCode | string | null | undefined,
) {
  const busyCodes = useMemo(() => {
    const codes = items
      .map((i) => (i.catalog_busy_code != null ? Number(i.catalog_busy_code) : null))
      .filter((c): c is number => c != null && Number.isFinite(c));
    return normalizeBusyCodes(codes);
  }, [items]);

  const loc = stockLocationCode ?? 'main_store';
  const sig = itemsFreshnessSignature(items);

  return useQuery({
    queryKey: ['billing-stock-freshness', orderId, busyCodes.join(','), loc, sig],
    enabled: orderId != null && busyCodes.length > 0,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const [availMap, reservedMap] = await Promise.all([
        fetchLocationwiseAvailableForBusyCodes(busyCodes, loc),
        fetchStockReservationsByOrderItem(orderId!),
      ]);
      return computeBillingFreshnessByOrderItem(items, availMap, reservedMap);
    },
  });
}
