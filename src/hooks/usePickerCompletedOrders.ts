import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../context/AuthContext';
import {
  normalizeOrderListBusyItemCount,
  type OrderItemEmbedRow,
  type OrderRowWithEmbed,
} from '../lib/orderItemCount';
import type { OrderWithClaimInfo } from './useClaimableOrders';
import {
  buildCompletedPickSummary,
  getPickerCompletedDayRange,
  isPickQueueEligibleForBranch,
  type CompletedPickSummary,
  type PickerCompletedDay,
} from '../lib/picking/completedPickSummary';

const PICKER_COMPLETED_ORDERS_SELECT =
  '*, order_items(item_id,item_name,state,flag_reason,flag_notes,rack_no,qty_requested,qty_shippable,qty_po,qty_approved,split_from_id)' as const;

export interface PickerCompletedOrder extends OrderWithClaimInfo {
  completedSummary: CompletedPickSummary;
}

export function pickerCompletedOrdersQueryKey(
  pickerName: string | null | undefined,
  day: PickerCompletedDay,
): readonly [string, string | null | undefined, PickerCompletedDay] {
  return ['picker-completed-orders', pickerName, day];
}

function toCompletedOrder(
  row: OrderRowWithEmbed,
  pickerBranch: 'main_store' | 'jabalpur' | null,
): PickerCompletedOrder | null {
  const embed = row.order_items as OrderItemEmbedRow[] | null | undefined;
  const normalized = normalizeOrderListBusyItemCount([row])[0];
  if (!normalized || !isPickQueueEligibleForBranch(normalized, pickerBranch)) return null;

  return {
    ...normalized,
    claim_info: null,
    sales_edit_claim_info: null,
    is_mine: true,
    special_rate_line_count: normalized.special_rate_line_count ?? 0,
    special_rate_qty: normalized.special_rate_qty ?? 0,
    completedSummary: buildCompletedPickSummary(embed),
  };
}

export function usePickerCompletedOrders(day: PickerCompletedDay) {
  const { userName, branch } = useAuth();
  const { start, end } = getPickerCompletedDayRange(day);

  return useQuery({
    queryKey: pickerCompletedOrdersQueryKey(userName, day),
    enabled: Boolean(userName?.trim()),
    queryFn: async (): Promise<PickerCompletedOrder[]> => {
      const pickerName = userName!;
      const { data, error } = await supabase
        .from('orders')
        .select(PICKER_COMPLETED_ORDERS_SELECT)
        .eq('picker_name', pickerName)
        .in('workflow_status', ['completed', 'flagged'])
        .gte('picking_completed_at', start)
        .lt('picking_completed_at', end)
        .order('picking_completed_at', { ascending: false });

      if (error) throw error;

      const orders: PickerCompletedOrder[] = [];
      for (const row of (data ?? []) as OrderRowWithEmbed[]) {
        const mapped = toCompletedOrder(row, branch);
        if (mapped) orders.push(mapped);
      }
      return orders;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
