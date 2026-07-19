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

export interface SalesWorkingDaysPace {
  total: number;
  elapsedFy: number;
  elapsedMonth: number;
  elapsedQuarter: number;
  month: number;
  quarter: number;
}

/** Full-period destination gap (close the number). */
export function salesGap(metric: SalesPeriodMetric): SalesGapPresentation {
  const gap = metric.actual - metric.expected;
  const state: SalesGapState = gap >= 0 ? 'ahead' : 'short';
  const amount = Math.abs(gap);

  return {
    amount,
    state,
    signedLabel: `${gap >= 0 ? '+' : '-'}${compactSalesCurrency(amount)}`,
    summaryLabel: `${compactSalesCurrency(amount)} ${state === 'ahead' ? 'up' : 'to close'}`,
    verbLabel: state === 'ahead' ? 'Above target' : 'Left to close',
  };
}

/** Till-date pace gap (ahead / behind where you should be by as-of). */
export function salesPaceGap(metric: SalesPeriodMetric): SalesGapPresentation {
  const gap = metric.actual - metric.expected;
  const state: SalesGapState = gap >= 0 ? 'ahead' : 'short';
  const amount = Math.abs(gap);

  return {
    amount,
    state,
    signedLabel: `${gap >= 0 ? '+' : '-'}${compactSalesCurrency(amount)}`,
    summaryLabel: `${compactSalesCurrency(amount)} ${state === 'ahead' ? 'ahead' : 'behind'}`,
    verbLabel: state === 'ahead' ? 'Ahead' : 'Behind',
  };
}

export function periodWorkingDays(
  workingDays: SalesWorkingDaysPace,
  period: SalesPacePeriod,
): number {
  if (period === 'month') return workingDays.month;
  if (period === 'quarter') return workingDays.quarter;
  return workingDays.total;
}

export function elapsedWorkingDays(
  workingDays: SalesWorkingDaysPace,
  period: SalesPacePeriod,
): number {
  if (period === 'month') return workingDays.elapsedMonth;
  if (period === 'quarter') return workingDays.elapsedQuarter;
  return workingDays.elapsedFy;
}

/**
 * Working-day prorata of the full period target through as-of.
 * periodTarget is the destination (July / Q / FY), not YTD.
 */
export function paceExpected(
  periodTarget: number,
  workingDays: SalesWorkingDaysPace,
  period: SalesPacePeriod,
): number {
  const daysInPeriod = periodWorkingDays(workingDays, period);
  if (periodTarget <= 0 || daysInPeriod <= 0) return 0;
  const elapsed = Math.min(Math.max(elapsedWorkingDays(workingDays, period), 0), daysInPeriod);
  return (periodTarget * elapsed) / daysInPeriod;
}

export function paceMetric(
  metric: SalesPeriodMetric,
  workingDays: SalesWorkingDaysPace,
  period: SalesPacePeriod,
): SalesPeriodMetric {
  return {
    actual: metric.actual,
    expected: paceExpected(metric.expected, workingDays, period),
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
  // Plan workbook rows for this salesperson.
  return categories.filter((category) => !category.isUnmapped && category.annualTarget > 0);
}

function outsideAssignedCategories(
  categories: SalesCategoryPace[],
  period: SalesPacePeriod,
): SalesCategoryPace[] {
  // Billed in Busy but not on this salesperson's target plan. Shown after
  // assigned rows so the list explains the hero total without a separate banner.
  return categories.filter(
    (category) => category.annualTarget <= 0 && category[period].actual !== 0,
  );
}

/**
 * Biggest assigned targets first, then outside-plan billing by period actual.
 */
export function sortSalesCategoriesByTarget(
  categories: SalesCategoryPace[],
  period: SalesPacePeriod,
): SalesCategoryPace[] {
  const assigned = assignedTargetCategories(categories)
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

  const outside = outsideAssignedCategories(categories, period)
    .slice()
    .sort((a, b) => {
      const actualDifference = b[period].actual - a[period].actual;
      if (actualDifference !== 0) return actualDifference;
      return a.name.localeCompare(b.name);
    });

  return [...assigned, ...outside];
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

export function salesPaceTargetLabel(): string {
  return 'Till-date target';
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
