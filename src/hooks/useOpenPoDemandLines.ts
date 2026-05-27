import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import {
  mergeOpenPoDemandLines,
  OPEN_PO_WORKFLOW_STATUSES,
  normalizeEmbeddedItem,
  normalizeEmbeddedOrder,
  type OpenPoDemandLine,
  type PendingPoDemandRow,
  type PoLossSource,
} from '../lib/purchase/openPoDemand';
import { matchesPartnerBrand } from '../lib/purchase/partnerBrandMatch';
import type { PendingItem, StockLocationCode } from '../types';

export type UseOpenPoDemandLinesOptions = {
  brandKeys?: string[];
};

export {
  OPEN_PO_WORKFLOW_STATUSES,
  normalizeEmbeddedItem,
  normalizeEmbeddedOrder,
  type OpenPoDemandLine,
  type PendingPoDemandRow,
  type PoLossSource,
};

type OrderRow = {
  id: number;
  order_number: string;
  customer_name: string;
  workflow_status: string;
  created_at: string;
  salesperson_name: string | null;
  stock_location_code?: StockLocationCode | null;
};

type ItemGroupRow = {
  id: number;
  alias: string | null;
  alias1: string | null;
  main_group: string | null;
  parent_group: string | null;
};

type OrderItemPriceRow = {
  order_id: number;
  item_id: number;
  price_quoted: number | null;
  price_system: number | null;
  qty_shippable: number;
  qty_requested: number;
  qty_po: number;
  stock_location_code?: StockLocationCode | null;
};

const ORDER_ITEMS_SELECT_WITH_LOCATION = `
  id,
  order_id,
  item_id,
  item_name,
  qty_po,
  qty_shippable,
  qty_requested,
  price_quoted,
  price_system,
  stock_location_code,
  orders (
    order_number,
    customer_name,
    workflow_status,
    created_at,
    salesperson_name,
    stock_location_code
  ),
  items (
    alias,
    alias1,
    main_group,
    parent_group
  )
`;

const ORDER_ITEMS_SELECT_BASE = `
  id,
  order_id,
  item_id,
  item_name,
  qty_po,
  qty_shippable,
  qty_requested,
  price_quoted,
  price_system,
  orders (
    order_number,
    customer_name,
    workflow_status,
    created_at,
    salesperson_name
  ),
  items (
    alias,
    alias1,
    main_group,
    parent_group
  )
`;

function poDemandKey(orderId: number, itemId: number): string {
  return `${orderId}:${itemId}`;
}

function isMissingColumnError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const haystack = [error.code, error.message].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes('stock_location_code') || haystack.includes('42703');
}

function toOpenPoDemandOrder(row: OrderRow) {
  return {
    order_number: row.order_number,
    customer_name: row.customer_name,
    workflow_status: row.workflow_status,
    created_at: row.created_at,
    salesperson_name: row.salesperson_name,
    stock_location_code: row.stock_location_code ?? null,
  };
}

function toItemEmbed(row: ItemGroupRow): NonNullable<OpenPoDemandLine['items']> {
  return {
    alias: row.alias,
    alias1: row.alias1,
    main_group: row.main_group,
    parent_group: row.parent_group,
  };
}

function buildPendingPoDemandRows(
  pendingItems: PendingItem[],
  ordersById: Map<number, OrderRow>,
  itemsById: Map<number, ItemGroupRow>,
): PendingPoDemandRow[] {
  const rows: PendingPoDemandRow[] = [];

  for (const pending of pendingItems) {
    if (pending.item_id == null) continue;
    const order = ordersById.get(pending.order_id);
    if (!order || !OPEN_PO_WORKFLOW_STATUSES.has(order.workflow_status)) continue;

    rows.push({
      id: pending.id,
      order_id: pending.order_id,
      item_id: pending.item_id,
      item_name: pending.item_name,
      qty_pending: pending.qty_pending,
      source: pending.source,
      stock_location_code: pending.stock_location_code ?? order.stock_location_code ?? null,
      orders: toOpenPoDemandOrder(order),
      items: itemsById.has(pending.item_id) ? toItemEmbed(itemsById.get(pending.item_id)!) : null,
    });
  }

  return rows;
}

async function fetchOpenOrderItemLines(): Promise<OpenPoDemandLine[]> {
  const withLocation = await supabase
    .from('order_items')
    .select(ORDER_ITEMS_SELECT_WITH_LOCATION)
    .gt('qty_po', 0)
    .order('id', { ascending: false });

  if (!withLocation.error) {
    return (withLocation.data ?? []) as unknown as OpenPoDemandLine[];
  }

  if (!isMissingColumnError(withLocation.error)) throw withLocation.error;

  const base = await supabase
    .from('order_items')
    .select(ORDER_ITEMS_SELECT_BASE)
    .gt('qty_po', 0)
    .order('id', { ascending: false });

  if (base.error) throw base.error;
  return (base.data ?? []) as unknown as OpenPoDemandLine[];
}

async function fetchOrdersById(orderIds: number[]): Promise<Map<number, OrderRow>> {
  const withLocation = await supabase
    .from('orders')
    .select('id, order_number, customer_name, workflow_status, created_at, salesperson_name, stock_location_code')
    .in('id', orderIds)
    .returns<OrderRow[]>();

  if (!withLocation.error) {
    return new Map((withLocation.data ?? []).map((row) => [row.id, row]));
  }

  if (!isMissingColumnError(withLocation.error)) throw withLocation.error;

  const base = await supabase
    .from('orders')
    .select('id, order_number, customer_name, workflow_status, created_at, salesperson_name')
    .in('id', orderIds)
    .returns<OrderRow[]>();

  if (base.error) throw base.error;
  return new Map((base.data ?? []).map((row) => [row.id, row]));
}

async function fetchOrderItemPrices(orderIds: number[]): Promise<Map<string, OrderItemPriceRow>> {
  const withLocation = await supabase
    .from('order_items')
    .select('order_id, item_id, price_quoted, price_system, qty_shippable, qty_requested, qty_po, stock_location_code')
    .in('order_id', orderIds);

  const rows = withLocation.error && isMissingColumnError(withLocation.error)
    ? (
        await supabase
          .from('order_items')
          .select('order_id, item_id, price_quoted, price_system, qty_shippable, qty_requested, qty_po')
          .in('order_id', orderIds)
      )
    : withLocation;

  if (rows.error) throw rows.error;
  return new Map(
    (rows.data ?? []).map((row) => [
      poDemandKey((row as OrderItemPriceRow).order_id, (row as OrderItemPriceRow).item_id),
      row as OrderItemPriceRow,
    ]),
  );
}

export function useOpenPoDemandLines(options?: UseOpenPoDemandLinesOptions) {
  const brandKeys = options?.brandKeys;
  const brandKeyLabel = brandKeys?.length ? brandKeys.join(',') : 'all';

  return useQuery({
    queryKey: ['open-po-demand-lines', brandKeyLabel],
    queryFn: async () => {
      const orderLines = await fetchOpenOrderItemLines();

      let pendingRaw: PendingItem[] | null = null;
      let pendingResult = await supabase
        .from('pending_items')
        .select('*')
        .eq('status', 'pending')
        .is('recovery_order_id', null)
        .order('id', { ascending: false })
        .returns<PendingItem[]>();

      if (isMissingColumnError(pendingResult.error)) {
        pendingResult = await supabase
          .from('pending_items')
          .select('*')
          .eq('status', 'pending')
          .order('id', { ascending: false })
          .returns<PendingItem[]>();
      }

      if (pendingResult.error) throw pendingResult.error;
      pendingRaw = pendingResult.data;

      const pendingItems = pendingRaw ?? [];
      let pendingRows: PendingPoDemandRow[] = [];
      let priceByKey = new Map<string, OrderItemPriceRow>();

      if (pendingItems.length > 0) {
        const orderIds = [...new Set(pendingItems.map((item) => item.order_id))];
        const itemIds = [
          ...new Set(
            pendingItems
              .map((item) => item.item_id)
              .filter((id): id is number => typeof id === 'number'),
          ),
        ];

        const [ordersById, itemsResult, prices] = await Promise.all([
          fetchOrdersById(orderIds),
          itemIds.length > 0
            ? supabase
                .from('items')
                .select('id, alias, alias1, main_group, parent_group')
                .in('id', itemIds)
                .returns<ItemGroupRow[]>()
            : Promise.resolve({ data: [], error: null }),
          fetchOrderItemPrices(orderIds),
        ]);

        if (itemsResult.error) throw itemsResult.error;

        const itemsById = new Map((itemsResult.data ?? []).map((row) => [row.id, row]));
        pendingRows = buildPendingPoDemandRows(pendingItems, ordersById, itemsById);
        priceByKey = prices;
      }

      const merged = mergeOpenPoDemandLines(orderLines, pendingRows, priceByKey);
      if (!brandKeys?.length) return merged;
      return merged.filter((line) => matchesPartnerBrand(line, brandKeys));
    },
    staleTime: 15_000,
  });
}
