import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../context/AuthContext';

function getTodayStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export interface PickerDailyStats {
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
      const { data, error } = await supabase
        .from('orders')
        .select('id, pick_line_count, item_count, completed_at')
        .eq('picker_name', userName!)
        .in('workflow_status', ['completed', 'flagged'])
        .gte('completed_at', todayStart);

      if (error) throw error;

      const rows = data ?? [];
      let linesCompleted = 0;
      for (const row of rows) {
        const lineCount =
          typeof row.pick_line_count === 'number'
            ? row.pick_line_count
            : typeof row.item_count === 'number'
              ? row.item_count
              : 0;
        linesCompleted += lineCount;
      }

      return {
        ordersCompleted: rows.length,
        linesCompleted,
      };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
