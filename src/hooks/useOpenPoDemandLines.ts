import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';

export type OpenPoDemandOrder = {
  order_number: string;
  customer_name: string;
  workflow_status: string;
  created_at: string;
  salesperson_name: string | null;
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
  orders: OpenPoDemandOrder | OpenPoDemandOrder[] | null;
  /** PostgREST may return a single object or a one-element array. */
  items:
    | { alias: string | null; main_group: string | null; parent_group: string | null }
    | { alias: string | null; main_group: string | null; parent_group: string | null }[]
    | null;
};

/** Orders that still represent live demand (PO lines may still matter). */
export const OPEN_PO_WORKFLOW_STATUSES = new Set([
  'submitted',
  'approved',
  'picking',
  'flagged',
]);

export function normalizeEmbeddedOrder(
  o: OpenPoDemandOrder | OpenPoDemandOrder[] | null | undefined,
): OpenPoDemandOrder | null {
  if (!o) return null;
  return Array.isArray(o) ? o[0] ?? null : o;
}

export function normalizeEmbeddedItem(
  row: OpenPoDemandLine['items'],
): { alias: string | null; main_group: string | null; parent_group: string | null } | null {
  if (!row) return null;
  return Array.isArray(row) ? row[0] ?? null : row;
}

export function useOpenPoDemandLines() {
  return useQuery({
    queryKey: ['open-po-demand-lines'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_items')
        .select(
          `
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
            main_group,
            parent_group
          )
        `,
        )
        .gt('qty_po', 0)
        .order('id', { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as OpenPoDemandLine[];
    },
    staleTime: 15_000,
  });
}
