import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';
import type { Order } from '../types';

// Targets are stored with financial year label "2025-26"
const TARGET_YEAR = '2025-26';
// Imported history in salesperson_fy_sales uses "2025" for FY 2025-26
const HISTORY_FYEAR_KEY = '2025';

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
  lastUpdatedAt: string | null;
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
          lastUpdatedAt: null,
        };
      }

      // 1. Fetch sales targets for this person (year 2025-26)
      const { data: targets, error: targetsErr } = await supabase
        .from('sales_targets')
        .select('product_group, annual_target_lakhs')
        .eq('salesperson_name', salespersonName)
        .eq('year', TARGET_YEAR);

      if (targetsErr) throw targetsErr;

      const annualTargetLakhs =
        (targets ?? []).reduce((sum, r) => sum + Number(r.annual_target_lakhs || 0), 0) || 0;
      const monthlyTargetLakhs = annualTargetLakhs / 12;

      // 1b. Product group achievements from history for this FY
      const { data: pgRows, error: pgErr } = await supabase
        .from('salesperson_product_group_sales')
        .select('product_group, total_value')
        .eq('salesperson_name', salespersonName)
        .eq('fyear', HISTORY_FYEAR_KEY);

      if (pgErr) throw pgErr;

      const achievedByGroup = new Map<string, number>();
      for (const row of pgRows ?? []) {
        const key = String(row.product_group ?? '');
        if (!key) continue;
        const prev = achievedByGroup.get(key) ?? 0;
        achievedByGroup.set(key, prev + Number(row.total_value || 0));
      }

      // Build list with achieved mapped in rupees
      const withAchieved: ProductGroupTarget[] = (targets ?? []).map((t) => {
        const pg = t.product_group;
        const achieved = achievedByGroup.get(pg) ?? 0;
        return {
          product_group: pg,
          annual_target_lakhs: Number(t.annual_target_lakhs || 0),
          achieved,
        };
      });

      // Sort by largest gap first (target - achieved), so biggest problems are on top
      withAchieved.sort((a, b) => {
        const aGap = a.annual_target_lakhs * 100000 - (achievedByGroup.get(a.product_group) ?? 0);
        const bGap = b.annual_target_lakhs * 100000 - (achievedByGroup.get(b.product_group) ?? 0);
        return bGap - aGap;
      });

      const topProductGroups = withAchieved.slice(0, 5);

      // 2. Fetch total sales achievement for this salesperson for FY 2025-26
      // from imported history (salesperson_fy_sales)
      const { data: fyRows, error: fyErr } = await supabase
        .from('salesperson_fy_sales')
        .select('total_value')
        .eq('salesperson_name', salespersonName)
        .eq('fyear', HISTORY_FYEAR_KEY);

      if (fyErr) throw fyErr;

      const fyAchievement =
        (fyRows ?? []).reduce((sum, r) => sum + Number(r.total_value || 0), 0) || 0;

      // 2b. "Last updated" timestamp so salesperson knows data freshness
      // We take the latest of targets.updated_at and salesperson_fy_sales.updated_at
      const { data: targetMeta, error: targetMetaErr } = await supabase
        .from('sales_targets')
        .select('updated_at')
        .eq('salesperson_name', salespersonName)
        .eq('year', TARGET_YEAR)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (targetMetaErr) throw targetMetaErr;

      const { data: historyMeta, error: historyMetaErr } = await supabase
        .from('salesperson_fy_sales')
        .select('updated_at')
        .eq('salesperson_name', salespersonName)
        .eq('fyear', HISTORY_FYEAR_KEY)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (historyMetaErr) throw historyMetaErr;

      const latestTargetUpdatedAt = targetMeta?.[0]?.updated_at as string | undefined;
      const latestHistoryUpdatedAt = historyMeta?.[0]?.updated_at as string | undefined;

      let lastUpdatedAt: string | null = null;
      if (latestTargetUpdatedAt && latestHistoryUpdatedAt) {
        lastUpdatedAt =
          latestTargetUpdatedAt > latestHistoryUpdatedAt
            ? latestTargetUpdatedAt
            : latestHistoryUpdatedAt;
      } else {
        lastUpdatedAt = (latestTargetUpdatedAt ?? latestHistoryUpdatedAt) ?? null;
      }

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
        lastUpdatedAt,
      };
    },
    enabled: !!salespersonName,
    staleTime: 60 * 1000,
  });
}
