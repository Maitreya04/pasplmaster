import { useEffect, useId } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { OrderItem, OrderWithItems } from '../types';

type ItemCatalogJoin = { alias: string | null; alias1: string | null };

type OrderItemRow = Omit<OrderItem, 'catalog_alias' | 'catalog_alias1'> & {
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
    };
  });
}

export function useOrderDetail(orderId: number | null) {
  const queryClient = useQueryClient();
  const uid = useId();

  useEffect(() => {
    if (orderId === null) return;

    const channel = supabase
      .channel(`order-items-${orderId}-${uid}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'order_items',
          filter: `order_id=eq.${orderId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['order', orderId] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId, uid, queryClient]);

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
            alias1
          )
        `,
        )
        .eq('order_id', orderId!);

      if (itemsError) throw itemsError;

      const items = mapOrderItemsWithCatalog(rawItems as OrderItemRow[] | null);
      let customerMobile: string | null = null;

      if (typeof order.customer_id === 'number') {
        const { data: customer, error: customerError } = await supabase
          .from('customers')
          .select('mobile')
          .eq('id', order.customer_id)
          .limit(1)
          .maybeSingle();

        if (customerError) throw customerError;
        customerMobile = (customer as { mobile?: string | null } | null)?.mobile ?? null;
      }

      return {
        ...order,
        customer_mobile: customerMobile,
        items,
        /** Busy “items” = invoice lines; prefer live row count over denormalized column. */
        item_count: items.length,
      } as OrderWithItems;
    },
    enabled: orderId !== null,
    staleTime: 0,
  });
}
