import type { Order } from '../types';

/** PostgREST: live count of rows in order_items (Busy “items” = invoice lines / SKUs). */
export const ORDERS_SELECT_WITH_ITEM_LINE_COUNT = '*, order_items(count)' as const;

export type OrderRowWithEmbed = Order & {
  order_items?: { count: number }[] | null;
};

/**
 * Prefer embedded `order_items` count over denormalized `orders.item_count`
 * so the UI matches Busy even if the column is stale or migrations were not applied.
 */
export function normalizeOrderBusyItemCount(row: OrderRowWithEmbed): Order {
  const { order_items: embed, ...rest } = row;
  const n = embed?.[0]?.count;
  return {
    ...rest,
    item_count: typeof n === 'number' ? n : rest.item_count,
  };
}
