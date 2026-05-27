import type { PendingItem, StockLocationCode } from '../../types';

export type PoLossSource = PendingItem['source'];

export type OpenPoDemandOrder = {
  order_number: string;
  customer_name: string;
  workflow_status: string;
  created_at: string;
  salesperson_name: string | null;
  stock_location_code?: StockLocationCode | null;
};

export type OpenPoDemandLine = {
  id: number;
  order_id: number;
  item_id: number;
  item_name: string;
  qty_po: number;
  qty_shippable: number;
  qty_requested: number;
  price_quoted: number | null;
  price_system: number | null;
  stock_location_code?: StockLocationCode | null;
  loss_source?: PoLossSource;
  orders: OpenPoDemandOrder | OpenPoDemandOrder[] | null;
  /** PostgREST may return a single object or a one-element array. */
  items:
    | {
        alias: string | null;
        alias1: string | null;
        main_group: string | null;
        parent_group: string | null;
        busy_code?: number | null;
      }
    | {
        alias: string | null;
        alias1: string | null;
        main_group: string | null;
        parent_group: string | null;
        busy_code?: number | null;
      }[]
    | null;
};

export type PendingPoDemandRow = {
  id: number;
  order_id: number;
  item_id: number | null;
  item_name: string;
  qty_pending: number;
  source: PoLossSource;
  stock_location_code: StockLocationCode | null;
  orders: OpenPoDemandOrder | OpenPoDemandOrder[] | null;
  items: OpenPoDemandLine['items'];
};

/**
 * Orders whose remaining PO qty counts as purchase demand / sales loss.
 * Includes completed orders billed with pending PO qty still on the line.
 */
export const OPEN_PO_WORKFLOW_STATUSES = new Set([
  'submitted',
  'approved',
  'picking',
  'flagged',
  'completed',
]);

export function normalizeEmbeddedOrder(
  o: OpenPoDemandOrder | OpenPoDemandOrder[] | null | undefined,
): OpenPoDemandOrder | null {
  if (!o) return null;
  return Array.isArray(o) ? o[0] ?? null : o;
}

export function normalizeEmbeddedItem(
  row: OpenPoDemandLine['items'],
): {
  alias: string | null;
  alias1: string | null;
  main_group: string | null;
  parent_group: string | null;
  busy_code?: number | null;
} | null {
  if (!row) return null;
  return Array.isArray(row) ? row[0] ?? null : row;
}

export type DemandLocationFilter = 'all' | StockLocationCode;

export function parseDemandLocationFilter(value: string | null): DemandLocationFilter {
  if (value === 'jabalpur') return 'jabalpur';
  if (value === 'indore' || value === 'main_store') return 'main_store';
  return 'all';
}

export function demandLocationFilterParam(filter: DemandLocationFilter): string | null {
  if (filter === 'all') return null;
  return filter === 'jabalpur' ? 'jabalpur' : 'indore';
}

export function demandLocationFilterLabel(filter: DemandLocationFilter): string {
  if (filter === 'jabalpur') return 'Jabalpur';
  if (filter === 'main_store') return 'Indore';
  return 'All locations';
}

export function resolveDemandLineLocation(line: OpenPoDemandLine): StockLocationCode {
  if (line.stock_location_code === 'jabalpur') return 'jabalpur';
  const order = normalizeEmbeddedOrder(line.orders);
  return order?.stock_location_code === 'jabalpur' ? 'jabalpur' : 'main_store';
}

export function resolvePendingItemLocation(
  item: Pick<PendingItem, 'stock_location_code'>,
): StockLocationCode {
  return item.stock_location_code === 'jabalpur' ? 'jabalpur' : 'main_store';
}

export function matchesDemandLocationFilter(
  location: StockLocationCode,
  filter: DemandLocationFilter,
): boolean {
  return filter === 'all' || location === filter;
}

function poDemandKey(orderId: number, itemId: number): string {
  return `${orderId}:${itemId}`;
}

function resolveStockLocationCode(args: {
  lineLocation?: StockLocationCode | null;
  pendingLocation?: StockLocationCode | null;
  orderLocation?: StockLocationCode | null;
}): StockLocationCode | null {
  return args.lineLocation ?? args.pendingLocation ?? args.orderLocation ?? null;
}

function resolveLossSource(orderQtyPo: number, pendingQty: number, pendingSource: PoLossSource): PoLossSource {
  if (pendingQty <= 0) return 'sales';
  if (orderQtyPo <= 0) return pendingSource;
  return pendingSource;
}

type PendingBucket = {
  qty: number;
  source: PoLossSource;
  row: PendingPoDemandRow;
};

function indexPendingRows(pendingRows: PendingPoDemandRow[]): Map<string, PendingBucket> {
  const pendingByKey = new Map<string, PendingBucket>();

  for (const row of pendingRows) {
    if (row.item_id == null) continue;
    const order = normalizeEmbeddedOrder(row.orders);
    if (!order || !OPEN_PO_WORKFLOW_STATUSES.has(order.workflow_status)) continue;

    const key = poDemandKey(row.order_id, row.item_id);
    const prev = pendingByKey.get(key);
    const qty = (prev?.qty ?? 0) + Math.max(0, row.qty_pending);
    pendingByKey.set(key, {
      qty,
      source: row.source,
      row,
    });
  }

  return pendingByKey;
}

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

export function mergeOpenPoDemandLines(
  orderLines: OpenPoDemandLine[],
  pendingRows: PendingPoDemandRow[],
  priceByKey: Map<string, OrderItemPriceRow> = new Map(),
): OpenPoDemandLine[] {
  const pendingByKey = indexPendingRows(pendingRows);
  const merged = new Map<string, OpenPoDemandLine>();

  for (const line of orderLines) {
    const order = normalizeEmbeddedOrder(line.orders);
    if (!order || !OPEN_PO_WORKFLOW_STATUSES.has(order.workflow_status)) continue;

    const key = poDemandKey(line.order_id, line.item_id);
    const pending = pendingByKey.get(key);
    const effectiveQty = Math.max(line.qty_po, pending?.qty ?? 0);
    if (effectiveQty <= 0) continue;

    merged.set(key, {
      ...line,
      qty_po: effectiveQty,
      stock_location_code: resolveStockLocationCode({
        lineLocation: line.stock_location_code,
        pendingLocation: pending?.row.stock_location_code,
        orderLocation: order.stock_location_code,
      }),
      loss_source: resolveLossSource(line.qty_po, pending?.qty ?? 0, pending?.source ?? 'sales'),
    });
    pendingByKey.delete(key);
  }

  for (const [key, pending] of pendingByKey) {
    const order = normalizeEmbeddedOrder(pending.row.orders);
    if (!order || pending.row.item_id == null) continue;

    const priceRow = priceByKey.get(key);
    const effectiveQty = Math.max(pending.qty, priceRow?.qty_po ?? 0);
    if (effectiveQty <= 0) continue;

    merged.set(key, {
      id: -pending.row.id,
      order_id: pending.row.order_id,
      item_id: pending.row.item_id,
      item_name: pending.row.item_name,
      qty_po: effectiveQty,
      qty_shippable: priceRow?.qty_shippable ?? 0,
      qty_requested: priceRow?.qty_requested ?? effectiveQty,
      price_quoted: priceRow?.price_quoted ?? null,
      price_system: priceRow?.price_system ?? null,
      stock_location_code: resolveStockLocationCode({
        lineLocation: priceRow?.stock_location_code,
        pendingLocation: pending.row.stock_location_code,
        orderLocation: order.stock_location_code,
      }),
      loss_source: pending.source,
      orders: pending.row.orders,
      items: pending.row.items,
    });
  }

  return [...merged.values()].sort((a, b) => Math.abs(b.id) - Math.abs(a.id));
}

export function filterOpenPoDemandLines(lines: OpenPoDemandLine[]): OpenPoDemandLine[] {
  return lines.filter((row) => {
    const order = normalizeEmbeddedOrder(row.orders);
    return order != null && OPEN_PO_WORKFLOW_STATUSES.has(order.workflow_status);
  });
}

/** item_id → open PO demand lines (sales + billing loss, including completed orders). */
export function groupOpenPoDemandByItemId(lines: OpenPoDemandLine[]): Map<number, OpenPoDemandLine[]> {
  const map = new Map<number, OpenPoDemandLine[]>();
  for (const line of filterOpenPoDemandLines(lines)) {
    const id = Number(line.item_id);
    if (!Number.isFinite(id)) continue;
    const list = map.get(id) ?? [];
    list.push(line);
    map.set(id, list);
  }
  return map;
}

export function sumQtyPo(lines: OpenPoDemandLine[]): number {
  let total = 0;
  for (const line of lines) {
    total += Number(line.qty_po) || 0;
  }
  return total;
}
