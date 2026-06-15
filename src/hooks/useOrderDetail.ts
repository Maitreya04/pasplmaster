import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { subscribeToTable } from '../lib/realtime';
import { isDirectTableRealtimeEnabled } from '../lib/realtimePolicy';
import { isAskLine } from '../lib/picking/askBrand';
import { isLucasLine } from '../lib/picking/lucasBrand';
import { countPickableOrderLines } from '../lib/cartSupply';
import type { OrderItem, OrderWithItems } from '../types';

type ItemCatalogJoin = {
  alias: string | null;
  alias1: string | null;
  main_group: string | null;
  parent_group: string | null;
  busy_code: number | null;
};

type OrderItemRow = Omit<
  OrderItem,
  | 'catalog_alias'
  | 'catalog_alias1'
  | 'catalog_main_group'
  | 'catalog_parent_group'
  | 'catalog_busy_code'
> & {
  items?: ItemCatalogJoin | ItemCatalogJoin[] | null;
};

/**
 * Realtime is primary; REST keep-alive is a slow safety net when the websocket
 * is healthy. If Realtime is disabled, the hook falls back to short polling.
 */
const KEEPALIVE_INTERVAL_MS = 60_000;
const POLL_NO_REALTIME_MS = 2_000;
const REALTIME_DEBOUNCE_MS = 500;

const DIRECT_TABLE_REALTIME_ON = isDirectTableRealtimeEnabled();

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
      catalog_busy_code: c?.busy_code ?? null,
    };
  });
}

export function useOrderDetail(orderId: number | null) {
  const queryClient = useQueryClient();
  const queryKey = ['order', orderId] as const;

  const query = useQuery<OrderWithItems>({
    queryKey,
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
            parent_group,
            busy_code
          )
        `,
        )
        .eq('order_id', orderId!)
        .order('bill_line_no', { ascending: true })
        .order('id', { ascending: true });

      if (itemsError) throw itemsError;

      const items = mapOrderItemsWithCatalog(rawItems as OrderItemRow[] | null);
      const pickLineCount = countPickableOrderLines(items);
      const askLineCount = items.filter((oi) =>
        isAskLine({
          item_name: oi.item_name,
          main_group: oi.catalog_main_group,
          parent_group: oi.catalog_parent_group,
        }),
      ).length;
      const lucasLineCount = items.filter((oi) =>
        isLucasLine({
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

        if (customerError) {
          console.warn('[useOrderDetail] customer lookup failed', customerError);
        } else {
          customerMobile = (customer as { mobile?: string | null } | null)?.mobile ?? null;
          customerAddress = (customer as { address?: string | null } | null)?.address ?? null;
        }
      }

      return {
        ...order,
        customer_mobile: customerMobile,
        customer_address: customerAddress,
        items,
        /** Busy “items” = invoice rows; pick_line_count excludes PO-only lines. */
        item_count: items.length,
        pick_line_count: pickLineCount,
        ask_line_count: askLineCount,
        lucas_line_count: lucasLineCount,
      } as OrderWithItems;
    },
    enabled: orderId !== null,
    staleTime: 0,
    refetchInterval: DIRECT_TABLE_REALTIME_ON ? KEEPALIVE_INTERVAL_MS : POLL_NO_REALTIME_MS,
    refetchIntervalInBackground: false,
  });

  // Optional direct table Realtime for local/debug environments.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (orderId == null || !DIRECT_TABLE_REALTIME_ON) return;

    const scheduleInvalidate = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      }, REALTIME_DEBOUNCE_MS);
    };

    const unsubOrder = subscribeToTable({
      channelName: `order-detail:${orderId}`,
      table: 'orders',
      filter: `id=eq.${orderId}`,
      onChange: scheduleInvalidate,
      onReconnect: () =>
        queryClient.invalidateQueries({ queryKey: ['order', orderId] }),
    });

    const unsubItems = subscribeToTable({
      channelName: `order-items:${orderId}`,
      table: 'order_items',
      filter: `order_id=eq.${orderId}`,
      onChange: scheduleInvalidate,
      onReconnect: () =>
        queryClient.invalidateQueries({ queryKey: ['order', orderId] }),
    });

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      unsubOrder();
      unsubItems();
    };
  }, [orderId, queryClient]);

  return query;
}
