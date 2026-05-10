import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { isAskLine } from '../lib/picking/askBrand';
import type { OrderItem, OrderWithItems } from '../types';

type ItemCatalogJoin = {
  alias: string | null;
  alias1: string | null;
  main_group: string | null;
  parent_group: string | null;
};

type OrderItemRow = Omit<
  OrderItem,
  'catalog_alias' | 'catalog_alias1' | 'catalog_main_group' | 'catalog_parent_group'
> & {
  items?: ItemCatalogJoin | ItemCatalogJoin[] | null;
};

function mapOrderItemsWithCatalog(rows: OrderItemRow[] | null): OrderItem[] {
  if (!rows?.length) return [];
  return rows.map((row) => {
    const { items: cat, ...base } = row;
    const c = Array.isArray(cat) ? cat[0] : cat;
    return {
      ...base,
      catalog_alias: c?.alias ?? null,
      catalog_alias1: c?.alias1 ?? null,
      catalog_main_group: c?.main_group ?? null,
      catalog_parent_group: c?.parent_group ?? null,
    };
  });
}

export function useOrderDetail(orderId: number | null) {
  return useQuery<OrderWithItems>({
    queryKey: ['order', orderId],
    queryFn: async () => {
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', orderId!)
        .single();

      if (orderError) throw orderError;

      const { data: rawItems, error: itemsError } = await supabase
        .from('order_items')
        .select(
          `
          *,
          items (
            alias,
            alias1,
            main_group,
            parent_group
          )
        `,
        )
        .eq('order_id', orderId!);

      if (itemsError) throw itemsError;

      const items = mapOrderItemsWithCatalog(rawItems as OrderItemRow[] | null);
      const askLineCount = items.filter((oi) =>
        isAskLine({
          item_name: oi.item_name,
          main_group: oi.catalog_main_group,
          parent_group: oi.catalog_parent_group,
        }),
      ).length;
      let customerMobile: string | null = null;
      let customerAddress: string | null = null;

      if (typeof order.customer_id === 'number') {
        const { data: customer, error: customerError } = await supabase
          .from('customers')
          .select('mobile, address')
          .eq('id', order.customer_id)
          .limit(1)
          .maybeSingle();

        if (customerError) throw customerError;
        customerMobile = (customer as { mobile?: string | null } | null)?.mobile ?? null;
        customerAddress = (customer as { address?: string | null } | null)?.address ?? null;
      }

      return {
        ...order,
        customer_mobile: customerMobile,
        customer_address: customerAddress,
        items,
        /** Busy “items” = invoice lines; prefer live row count over denormalized column. */
        item_count: items.length,
        ask_line_count: askLineCount,
      } as OrderWithItems;
    },
    enabled: orderId !== null,
    staleTime: 0,
    refetchInterval: 30000,
  });
}
