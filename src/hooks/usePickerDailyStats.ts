import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../context/AuthContext';
import { countPickableOrderLines } from '../lib/cartSupply';

function getTodayStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export interface PickerDailyStats {
  ordersAssigned: number;
  ordersCompleted: number;
  ordersFlagged: number;
  linesCompleted: number;
}

type CompletedPickStatsRow = {
  item_count?: number | null;
  workflow_status?: string | null;
  order_items?: {
    qty_requested?: number | null;
    qty_shippable?: number | null;
    qty_po?: number | null;
    qty_approved?: number | null;
  }[] | null;
};

export function usePickerDailyStats() {
  const { userName } = useAuth();

  return useQuery({
    queryKey: ['picker-daily-stats', userName],
    enabled: Boolean(userName?.trim()),
    queryFn: async (): Promise<PickerDailyStats> => {
      const todayStart = getTodayStartIso();
      const pickerName = userName!;

      const [assignedRes, completedRes] = await Promise.all([
        supabase
          .from('orders')
          .select('id')
          .eq('picker_name', pickerName)
          .gte('approved_at', todayStart),
        supabase
          .from('orders')
          .select(
            'id, item_count, workflow_status, picking_completed_at, order_items(qty_requested, qty_shippable, qty_po, qty_approved)',
          )
          .eq('picker_name', pickerName)
          .in('workflow_status', ['completed', 'flagged'])
          .gte('picking_completed_at', todayStart),
      ]);

      if (assignedRes.error) throw assignedRes.error;
      if (completedRes.error) throw completedRes.error;

      const completedRows = (completedRes.data ?? []) as CompletedPickStatsRow[];
      let linesCompleted = 0;
      let ordersFlagged = 0;
      for (const row of completedRows) {
        const embeddedLines = row.order_items ?? [];
        const lineCount =
          embeddedLines.length > 0
            ? countPickableOrderLines(
                embeddedLines.map((item) => ({
                  qty_requested: item.qty_requested ?? 0,
                  qty_shippable: item.qty_shippable,
                  qty_po: item.qty_po,
                  qty_approved: item.qty_approved,
                })),
              )
            : typeof row.item_count === 'number'
              ? row.item_count
              : 0;
        linesCompleted += lineCount;
        if (row.workflow_status === 'flagged') ordersFlagged += 1;
      }

      return {
        ordersAssigned: assignedRes.data?.length ?? 0,
        ordersCompleted: completedRows.length,
        ordersFlagged,
        linesCompleted,
      };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
