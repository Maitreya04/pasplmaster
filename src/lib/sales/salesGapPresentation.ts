import type {
  SalesCategoryPace,
  SalesPacePeriod,
  SalesPeriodMetric,
} from '../../hooks/useSalesDashboard';

export type SalesGapState = 'ahead' | 'short';

export interface SalesGapPresentation {
  amount: number;
  state: SalesGapState;
  signedLabel: string;
  summaryLabel: string;
  verbLabel: string;
}

export function compactSalesCurrency(value: number): string {
  const absolute = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (absolute >= 10_000_000) {
    return `${sign}₹${stripTrailingZero(absolute / 10_000_000)}Cr`;
  }
  if (absolute >= 100_000) {
    return `${sign}₹${stripTrailingZero(absolute / 100_000)}L`;
  }
  if (absolute >= 1_000) {
    return `${sign}₹${Math.round(absolute / 1_000)}K`;
  }

  return `${sign}₹${Math.round(absolute).toLocaleString('en-IN')}`;
}

function stripTrailingZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

export function salesGap(metric: SalesPeriodMetric): SalesGapPresentation {
  const gap = metric.actual - metric.expected;
  const state: SalesGapState = gap >= 0 ? 'ahead' : 'short';
  const amount = Math.abs(gap);

  return {
    amount,
    state,
    signedLabel: `${gap >= 0 ? '+' : '-'}${compactSalesCurrency(amount)}`,
    summaryLabel: `${compactSalesCurrency(amount)} ${state === 'ahead' ? 'up' : 'to close'}`,
    /** Close-the-number framing for the hero snapshot. */
    verbLabel: state === 'ahead' ? 'Above target' : 'Left to close',
  };
}

export function salesProgress(metric: SalesPeriodMetric): {
  actualPercent: number;
  targetPercent: number;
} {
  const scale = Math.max(metric.actual, metric.expected, 1);
  return {
    actualPercent: clampPercent((Math.max(metric.actual, 0) / scale) * 100),
    targetPercent: clampPercent((Math.max(metric.expected, 0) / scale) * 100),
  };
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function assignedTargetCategories(categories: SalesCategoryPace[]): SalesCategoryPace[] {
  // The target workbook defines each salesperson's portfolio. Busy may
  // contain sales in other segments, but those must not appear as assigned
  // target categories on the salesperson dashboard.
  return categories.filter((category) => !category.isUnmapped && category.annualTarget > 0);
}

/**
 * Snapshot ranking: biggest assigned targets first so the salesman sees
 * where the plan is heaviest, then period standing within that slice.
 */
export function sortSalesCategoriesByTarget(
  categories: SalesCategoryPace[],
  period: SalesPacePeriod,
): SalesCategoryPace[] {
  return assignedTargetCategories(categories)
    .slice()
    .sort((a, b) => {
      const targetDifference = b.annualTarget - a.annualTarget;
      if (targetDifference !== 0) return targetDifference;
      const expectedDifference = b[period].expected - a[period].expected;
      if (expectedDifference !== 0) return expectedDifference;
      const aGap = a[period].actual - a[period].expected;
      const bGap = b[period].actual - b[period].expected;
      return aGap - bGap || a.name.localeCompare(b.name);
    });
}

export function sortSalesCategoriesByGap(
  categories: SalesCategoryPace[],
  period: SalesPacePeriod,
): SalesCategoryPace[] {
  return sortSalesCategoriesByTarget(categories, period);
}

export function fiscalQuarterNumber(asOfDate: string): number {
  const monthIndex = Number(asOfDate.slice(5, 7)) - 1;
  return Math.floor(((monthIndex - 3 + 12) % 12) / 3) + 1;
}

export function salesPeriodLabel(
  period: SalesPacePeriod,
  asOfDate: string,
  financialYearLabel: string | null,
): string {
  if (period === 'fy') return financialYearLabel ? `FY ${financialYearLabel}` : 'This FY';
  if (period === 'quarter') {
    const quarter = `Q${fiscalQuarterNumber(asOfDate)}`;
    return financialYearLabel ? `${quarter} · FY ${financialYearLabel}` : quarter;
  }

  const date = new Date(`${asOfDate}T12:00:00`);
  return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export function salesPeriodTargetLabel(
  period: SalesPacePeriod,
  asOfDate: string,
): string {
  if (period === 'fy') return 'FY target';
  if (period === 'quarter') return `Q${fiscalQuarterNumber(asOfDate)} target`;
  const date = new Date(`${asOfDate}T12:00:00`);
  return `${date.toLocaleDateString('en-IN', { month: 'long' })} target`;
}

export function remainingWorkingDays(
  data: {
    workingDays: {
      remainingMonth: number;
      remainingQuarter: number;
      remaining: number;
    };
  },
  period: SalesPacePeriod,
): number {
  if (period === 'month') return data.workingDays.remainingMonth;
  if (period === 'quarter') return data.workingDays.remainingQuarter;
  return data.workingDays.remaining;
}
