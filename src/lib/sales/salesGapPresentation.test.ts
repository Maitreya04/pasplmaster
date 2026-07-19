import assert from 'node:assert/strict';
import type { SalesCategoryPace } from '../../hooks/useSalesDashboard';
import {
  compactSalesCurrency,
  fiscalQuarterNumber,
  remainingWorkingDays,
  salesGap,
  salesPeriodLabel,
  salesPeriodTargetLabel,
  salesProgress,
  sortSalesCategoriesByGap,
  sortSalesCategoriesByTarget,
} from './salesGapPresentation';

function category(
  name: string,
  actual: number,
  expected: number,
  annualTarget = expected,
): SalesCategoryPace {
  const metric = { actual, expected };
  return {
    segmentId: name.length,
    name,
    isUnmapped: false,
    annualTarget,
    today: metric,
    month: metric,
    quarter: metric,
    fy: metric,
    fyContributionPercent: 0,
  };
}

assert.equal(compactSalesCurrency(1_420_000), '₹14.2L');
assert.equal(compactSalesCurrency(-23_000), '-₹23K');
assert.deepEqual(salesGap({ actual: 142_000, expected: 121_000 }), {
  amount: 21_000,
  state: 'ahead',
  signedLabel: '+₹21K',
  summaryLabel: '₹21K up',
  verbLabel: 'Above target',
});
assert.equal(salesGap({ actual: -5_000, expected: 10_000 }).summaryLabel, '₹15K to close');
assert.equal(salesGap({ actual: -5_000, expected: 10_000 }).verbLabel, 'Left to close');
const overTargetProgress = salesProgress({ actual: 150, expected: 100 });
assert.equal(overTargetProgress.actualPercent, 100);
assert.ok(Math.abs(overTargetProgress.targetPercent - (100 / 1.5)) < 0.000_001);

assert.equal(fiscalQuarterNumber('2026-04-01'), 1);
assert.equal(fiscalQuarterNumber('2026-07-11'), 2);
assert.equal(fiscalQuarterNumber('2027-01-15'), 4);
assert.equal(salesPeriodLabel('quarter', '2027-01-15', '2026-27'), 'Q4 · FY 2026-27');
assert.equal(salesPeriodLabel('month', '2026-07-11', '2026-27'), 'July 2026');
assert.equal(salesPeriodTargetLabel('month', '2026-07-11'), 'July target');
assert.equal(salesPeriodTargetLabel('quarter', '2026-07-11'), 'Q2 target');
assert.equal(salesPeriodTargetLabel('fy', '2026-07-11'), 'FY target');
assert.equal(
  remainingWorkingDays(
    { workingDays: { remainingMonth: 14, remainingQuarter: 55, remaining: 180 } },
    'quarter',
  ),
  55,
);

const unmapped = category('Unmapped', 0, 1_000);
unmapped.isUnmapped = true;
const busyOnly = category('Busy only, not assigned', 20_000, 0, 0);

assert.deepEqual(
  sortSalesCategoriesByTarget([
    category('Small target', 20_000, 10_000, 50_000),
    category('Biggest target', 1_000, 10_000, 5_000_000),
    unmapped,
    busyOnly,
    category('Mid target', 9_000, 10_000, 500_000),
  ], 'month').map((item) => item.name),
  ['Biggest target', 'Mid target', 'Small target'],
);

assert.deepEqual(
  sortSalesCategoriesByGap([
    category('Small target', 20_000, 10_000, 50_000),
    category('Biggest target', 1_000, 10_000, 5_000_000),
  ], 'month').map((item) => item.name),
  ['Biggest target', 'Small target'],
);

console.log('salesGapPresentation tests passed');
