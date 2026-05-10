import type { Order } from '../types';
import { isAskLine } from './picking/askBrand';
import { summarizeSpecialPricing } from './specialPricing';

/**
 * Keep the embedded order_items select simple.
 * PostgREST can reject mixed aggregate-style embeds like `count` plus regular
 * columns, which breaks every orders list query.
 */
export const ORDERS_SELECT_WITH_ITEM_LINE_COUNT =
  '*, order_items(price_quoted,price_system,qty_requested,item_name,items(main_group,parent_group))' as const;

type ItemsJoinRow = { main_group?: string | null; parent_group?: string | null } | null;

export type OrderRowWithEmbed = Order & {
  order_items?: {
    price_quoted?: number | null;
    price_system?: number | null;
    qty_requested?: number;
    item_name?: string | null;
    items?: ItemsJoinRow | ItemsJoinRow[];
  }[] | null;
};

function catalogGroupsFromJoin(items: ItemsJoinRow | ItemsJoinRow[] | null | undefined): {
  main_group: string | null;
  parent_group: string | null;
} {
  if (items == null) return { main_group: null, parent_group: null };
  const row = Array.isArray(items) ? items[0] : items;
  return {
    main_group: row?.main_group ?? null,
    parent_group: row?.parent_group ?? null,
  };
}

/**
 * Prefer embedded `order_items` count over denormalized `orders.item_count`
 * so the UI matches Busy even if the column is stale or migrations were not applied.
 */
export function normalizeOrderBusyItemCount(row: OrderRowWithEmbed): Order & {
  special_rate_line_count: number;
  special_rate_qty: number;
} {
  const { order_items: embed, ...rest } = row;
  const liveLineCount = embed?.length ?? rest.item_count;
  const { specialLineCount, specialQty } = summarizeSpecialPricing(
    (embed ?? []).map((item) => ({
      price_quoted: item.price_quoted ?? null,
      price_system: item.price_system ?? null,
      qty_requested: item.qty_requested ?? 0,
    })),
  );
  let askLineCount = 0;
  for (const row of embed ?? []) {
    const { main_group, parent_group } = catalogGroupsFromJoin(row.items);
    if (
      isAskLine({
        item_name: row.item_name,
        main_group,
        parent_group,
      })
    ) {
      askLineCount += 1;
    }
  }
  return {
    ...rest,
    item_count: liveLineCount,
    ask_line_count: askLineCount,
    special_rate_line_count: specialLineCount,
    special_rate_qty: specialQty,
  };
}
