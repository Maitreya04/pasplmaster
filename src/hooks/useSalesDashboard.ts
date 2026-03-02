import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { Order } from '../types';

const FY_START = '2025-04-01';
const FY_END = '2026-04-01';
const YEAR = '2025-26';

export interface ProductGroupTarget {
  product_group: string;
  annual_target_lakhs: number;
  achieved: number; // rupees, 0 for now
}

export interface SalesDashboardData {
  annualTargetLakhs: number;
  fyAchievement: number; // sum of total_value in FY
  monthlyTargetLakhs: number;
  thisMonthOrders: number;
  thisMonthValue: number;
  topProductGroups: ProductGroupTarget[];
  recentOrders: Order[];
}

function getMonthStartEnd(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
  return {
    start: start.toISOString().slice(0, 19) + 'Z',
    end: end.toISOString(),
  };
}

export function useSalesDashboard(salespersonName: string | null) {
  return useQuery<SalesDashboardData>({
    queryKey: ['sales-dashboard', salespersonName],
    queryFn: async () => {
      if (!salespersonName) {
        return {
          annualTargetLakhs: 0,
          fyAchievement: 0,
          monthlyTargetLakhs: 0,
          thisMonthOrders: 0,
          thisMonthValue: 0,
          topProductGroups: [],
          recentOrders: [],
        };
      }

      // 1. Fetch sales targets for this person (year 2025-26)
      const { data: targets, error: targetsErr } = await supabase
        .from('sales_targets')
        .select('product_group, annual_target_lakhs')
        .eq('salesperson_name', salespersonName)
        .eq('year', YEAR);

      if (targetsErr) throw targetsErr;

      const annualTargetLakhs =
        (targets ?? []).reduce((sum, r) => sum + Number(r.annual_target_lakhs || 0), 0) || 0;
      const monthlyTargetLakhs = annualTargetLakhs / 12;

      // Top 5 by target amount (annual_target_lakhs descending)
      const sorted = [...(targets ?? [])].sort(
        (a, b) => Number(b.annual_target_lakhs || 0) - Number(a.annual_target_lakhs || 0)
      );
      const topProductGroups: ProductGroupTarget[] = sorted.slice(0, 5).map((t) => ({
        product_group: t.product_group,
        annual_target_lakhs: Number(t.annual_target_lakhs || 0),
        achieved: 0,
      }));

      // 2. Fetch orders for this salesperson in FY 2025-26
      const { data: fyOrders, error: fyErr } = await supabase
        .from('orders')
        .select('id, total_value, created_at')
        .eq('salesperson_name', salespersonName)
        .gte('created_at', FY_START)
        .lt('created_at', FY_END);

      if (fyErr) throw fyErr;

      const fyAchievement =
        (fyOrders ?? []).reduce((sum, o) => sum + Number(o.total_value || 0), 0) || 0;

      // 3. This month's orders
      const { start: monthStart, end: monthEnd } = getMonthStartEnd();
      const { data: monthOrders, error: monthErr } = await supabase
        .from('orders')
        .select('id, total_value')
        .eq('salesperson_name', salespersonName)
        .gte('created_at', monthStart)
        .lte('created_at', monthEnd);

      if (monthErr) throw monthErr;

      const thisMonthOrders = (monthOrders ?? []).length;
      const thisMonthValue =
        (monthOrders ?? []).reduce((sum, o) => sum + Number(o.total_value || 0), 0) || 0;

      // 4. Last 3 orders
      const { data: recentOrders, error: recentErr } = await supabase
        .from('orders')
        .select('*')
        .eq('salesperson_name', salespersonName)
        .order('created_at', { ascending: false })
        .limit(3);

      if (recentErr) throw recentErr;

      return {
        annualTargetLakhs,
        fyAchievement,
        monthlyTargetLakhs,
        thisMonthOrders,
        thisMonthValue,
        topProductGroups,
        recentOrders: (recentOrders ?? []) as Order[],
      };
    },
    enabled: !!salespersonName,
    staleTime: 60 * 1000,
  });
}
