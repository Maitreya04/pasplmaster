import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase/client';

export type SalesPacePeriod = 'month' | 'quarter' | 'fy';
export type SalesPaceRpcPeriod = 'today' | SalesPacePeriod;

export interface SalesPeriodMetric {
  actual: number;
  expected: number;
}

export interface SalesCategoryPace {
  segmentId: number;
  name: string;
  isUnmapped: boolean;
  annualTarget: number;
  today: SalesPeriodMetric;
  month: SalesPeriodMetric;
  quarter: SalesPeriodMetric;
  fy: SalesPeriodMetric;
  fyContributionPercent: number;
}

export interface SalesDashboardData {
  status: 'ready' | 'targets_missing' | 'financial_year_missing';
  asOfDate: string;
  financialYear: {
    id: number;
    label: string;
    startsOn: string;
    endsOn: string;
  } | null;
  workingDays: {
    total: number;
    elapsedFy: number;
    elapsedMonth: number;
    elapsedQuarter: number;
    month: number;
    quarter: number;
    remainingMonth: number;
    remainingQuarter: number;
    remaining: number;
    isTodayWorkingDay: boolean;
  };
  periodWindows: Record<SalesPacePeriod, { startsOn: string; endsOn: string } | null>;
  annualTarget: number;
  remainingAnnual: number;
  requiredDailyRunRate: number;
  periods: Record<SalesPaceRpcPeriod, SalesPeriodMetric>;
  categories: SalesCategoryPace[];
  freshness: {
    aggregatedAt: string | null;
    sourceMaxVoucherDate: string | null;
    isStale: boolean;
    unmappedRows: number;
    unmappedValue: number;
  };
}

interface PaceRpcCategory {
  segment_id?: number;
  name?: string;
  is_unmapped?: boolean;
  annual_target?: number | string;
  today_actual?: number | string;
  today_expected?: number | string;
  month_actual?: number | string;
  month_expected?: number | string;
  quarter_actual?: number | string;
  quarter_expected?: number | string;
  fy_actual?: number | string;
  fy_expected?: number | string;
  fy_contribution_percent?: number | string;
}

interface PaceRpcPayload {
  status?: SalesDashboardData['status'];
  as_of_date?: string;
  financial_year?: {
    id?: number;
    label?: string;
    starts_on?: string;
    ends_on?: string;
  };
  working_days?: {
    total?: number;
    elapsed_fy?: number;
    elapsed_month?: number;
    elapsed_quarter?: number;
    month?: number;
    quarter?: number;
    remaining_month?: number;
    remaining_quarter?: number;
    remaining?: number;
    is_today_working_day?: boolean;
  };
  period_windows?: Partial<
    Record<SalesPacePeriod, { starts_on?: string; ends_on?: string }>
  >;
  annual_target?: number | string;
  remaining_annual?: number | string;
  required_daily_run_rate?: number | string;
  periods?: Partial<Record<SalesPaceRpcPeriod, { actual?: number | string; expected?: number | string }>>;
  categories?: PaceRpcCategory[];
  freshness?: {
    aggregated_at?: string | null;
    source_max_voucher_date?: string | null;
    is_stale?: boolean;
    unmapped_rows?: number;
    unmapped_value?: number | string;
  };
}

const numberValue = (value: number | string | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function parsePeriod(payload: PaceRpcPayload, period: SalesPaceRpcPeriod): SalesPeriodMetric {
  const value = payload.periods?.[period];
  return {
    actual: numberValue(value?.actual),
    expected: numberValue(value?.expected),
  };
}

function parsePeriodWindow(
  payload: PaceRpcPayload,
  period: SalesPacePeriod,
  fallbackStartsOn?: string,
  fallbackEndsOn?: string,
): { startsOn: string; endsOn: string } | null {
  const window = payload.period_windows?.[period];
  const startsOn = window?.starts_on ?? fallbackStartsOn;
  const endsOn = window?.ends_on ?? fallbackEndsOn;
  if (!startsOn || !endsOn) return null;
  return { startsOn, endsOn };
}

function parsePace(payload: PaceRpcPayload): SalesDashboardData {
  const fy = payload.financial_year;
  const financialYear = fy?.id && fy.label && fy.starts_on && fy.ends_on
    ? { id: fy.id, label: fy.label, startsOn: fy.starts_on, endsOn: fy.ends_on }
    : null;

  return {
    status: payload.status ?? 'financial_year_missing',
    asOfDate: payload.as_of_date ?? new Date().toISOString().slice(0, 10),
    financialYear,
    workingDays: {
      total: payload.working_days?.total ?? 0,
      elapsedFy: payload.working_days?.elapsed_fy ?? 0,
      elapsedMonth: payload.working_days?.elapsed_month ?? 0,
      elapsedQuarter: payload.working_days?.elapsed_quarter ?? 0,
      month: payload.working_days?.month ?? payload.working_days?.elapsed_month ?? 0,
      quarter: payload.working_days?.quarter ?? payload.working_days?.elapsed_quarter ?? 0,
      remainingMonth: payload.working_days?.remaining_month ?? 0,
      remainingQuarter: payload.working_days?.remaining_quarter ?? 0,
      remaining: payload.working_days?.remaining ?? 0,
      isTodayWorkingDay: payload.working_days?.is_today_working_day ?? false,
    },
    periodWindows: {
      month: parsePeriodWindow(payload, 'month'),
      quarter: parsePeriodWindow(payload, 'quarter'),
      fy: parsePeriodWindow(
        payload,
        'fy',
        financialYear?.startsOn,
        financialYear?.endsOn,
      ),
    },
    annualTarget: numberValue(payload.annual_target),
    remainingAnnual: numberValue(payload.remaining_annual),
    requiredDailyRunRate: numberValue(payload.required_daily_run_rate),
    periods: {
      today: parsePeriod(payload, 'today'),
      month: parsePeriod(payload, 'month'),
      quarter: parsePeriod(payload, 'quarter'),
      fy: parsePeriod(payload, 'fy'),
    },
    categories: (payload.categories ?? []).map((category) => ({
      segmentId: category.segment_id ?? 0,
      name: category.name ?? 'Unmapped',
      isUnmapped: category.is_unmapped ?? false,
      annualTarget: numberValue(category.annual_target),
      today: {
        actual: numberValue(category.today_actual),
        expected: numberValue(category.today_expected),
      },
      month: {
        actual: numberValue(category.month_actual),
        expected: numberValue(category.month_expected),
      },
      quarter: {
        actual: numberValue(category.quarter_actual),
        expected: numberValue(category.quarter_expected),
      },
      fy: {
        actual: numberValue(category.fy_actual),
        expected: numberValue(category.fy_expected),
      },
      fyContributionPercent: numberValue(category.fy_contribution_percent),
    })),
    freshness: {
      aggregatedAt: payload.freshness?.aggregated_at ?? null,
      sourceMaxVoucherDate: payload.freshness?.source_max_voucher_date ?? null,
      isStale: payload.freshness?.is_stale ?? true,
      unmappedRows: payload.freshness?.unmapped_rows ?? 0,
      unmappedValue: numberValue(payload.freshness?.unmapped_value),
    },
  };
}

export function useSalesDashboard(salespersonName: string | null, salespersonUserId?: number | null) {
  return useQuery<SalesDashboardData>({
    // Bump the cache contract whenever the RPC's aggregation/mapping semantics
    // change so persisted/offline clients cannot keep rendering stale results.
    queryKey: ['sales-dashboard-v4', salespersonUserId ?? null, salespersonName],
    queryFn: async () => {
      const paceResult = await supabase.rpc('get_my_sales_pace', {
        p_as_of_date: null,
        p_salesperson_user_id: salespersonUserId!,
      });

      if (paceResult.error) throw paceResult.error;
      return parsePace((paceResult.data ?? {}) as PaceRpcPayload);
    },
    enabled: salespersonUserId != null && !!salespersonName,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    staleTime: 60 * 1000,
    refetchInterval: 3 * 60 * 1000,
  });
}
