import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../context/AuthContext';

function getTodayStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export interface PickerDailyStats {
  ordersAssigned: number;
  ordersCompleted: number;
  linesCompleted: number;
}

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
          .select('id, pick_line_count, item_count, completed_at')
          .eq('picker_name', pickerName)
          .in('workflow_status', ['completed', 'flagged'])
          .gte('completed_at', todayStart),
      ]);

      if (assignedRes.error) throw assignedRes.error;
      if (completedRes.error) throw completedRes.error;

      const completedRows = completedRes.data ?? [];
      let linesCompleted = 0;
      for (const row of completedRows) {
        const lineCount =
          typeof row.pick_line_count === 'number'
            ? row.pick_line_count
            : typeof row.item_count === 'number'
              ? row.item_count
              : 0;
        linesCompleted += lineCount;
      }

      return {
        ordersAssigned: assignedRes.data?.length ?? 0,
        ordersCompleted: completedRows.length,
        linesCompleted,
      };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
