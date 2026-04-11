import type { Order } from '../types';
import { summarizeSpecialPricing } from './specialPricing';

/** PostgREST: live count of rows in order_items (Busy “items” = invoice lines / SKUs). */
export const ORDERS_SELECT_WITH_ITEM_LINE_COUNT = '*, order_items(count,price_quoted,price_system,qty_requested)' as const;

export type OrderRowWithEmbed = Order & {
  order_items?: {
    count?: number;
    price_quoted?: number | null;
    price_system?: number | null;
    qty_requested?: number;
  }[] | null;
};

/**
 * Prefer embedded `order_items` count over denormalized `orders.item_count`
 * so the UI matches Busy even if the column is stale or migrations were not applied.
 */
export function normalizeOrderBusyItemCount(row: OrderRowWithEmbed): Order & {
  special_rate_line_count: number;
  special_rate_qty: number;
} {
  const { order_items: embed, ...rest } = row;
  const n = embed?.[0]?.count;
  const liveLineCount = typeof n === 'number' ? n : (embed?.length ?? rest.item_count);
  const { specialLineCount, specialQty } = summarizeSpecialPricing(
    (embed ?? []).map((item) => ({
      price_quoted: item.price_quoted ?? null,
      price_system: item.price_system ?? null,
      qty_requested: item.qty_requested ?? 0,
    })),
  );
  return {
    ...rest,
    item_count: liveLineCount,
    special_rate_line_count: specialLineCount,
    special_rate_qty: specialQty,
  };
}
