import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CaretDown,
  HourglassHigh,
  ListBullets,
  MapPin,
  Plus,
  Warning,
  WifiSlash,
} from '@phosphor-icons/react';
import { Card, Skeleton } from '../../components/shared';
import { useAuth } from '../../context/AuthContext';
import {
  useSalesDashboard,
  type SalesCategoryPace,
  type SalesDashboardData,
  type SalesPacePeriod,
  type SalesPeriodMetric,
} from '../../hooks/useSalesDashboard';
import { getSalesOfflineReadiness } from '../../lib/offlineReadiness';
import {
  compactSalesCurrency,
  remainingWorkingDays,
  salesGap,
  salesPeriodLabel,
  salesPeriodTargetLabel,
  salesProgress,
  sortSalesCategoriesByTarget,
} from '../../lib/sales/salesGapPresentation';
import { formatTimeAgo } from '../../utils/formatters';

const PERIOD_LABELS: Record<SalesPacePeriod, string> = {
  month: 'This month',
  quarter: 'This quarter',
  fy: 'This FY',
};

const TOP_CATEGORY_COUNT = 5;

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function todayFormatted(): string {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatFyDate(value: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function asOfLabel(asOfDate: string): string {
  return new Date(`${asOfDate}T12:00:00`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

function periodPressureLabel(
  period: SalesPacePeriod,
  data: SalesDashboardData,
): string {
  const window = data.periodWindows[period];
  const billedTill = asOfLabel(data.asOfDate);
  const daysLeft = remainingWorkingDays(data, period);
  const closesOn = window ? asOfLabel(window.endsOn) : null;
  const dayPart =
    daysLeft > 0
      ? `${daysLeft} working day${daysLeft === 1 ? '' : 's'} left`
      : 'Period closed';

  if (closesOn) {
    return `Billed till ${billedTill} · closes ${closesOn} · ${dayPart}`;
  }

  return `Billed till ${billedTill} · ${dayPart}`;
}

function gapTone(metric: SalesPeriodMetric): string {
  return salesGap(metric).state === 'ahead'
    ? 'text-[var(--content-signal-ok)]'
    : 'text-[var(--content-negative)]';
}

function PeriodControl({
  value,
  onChange,
}: {
  value: SalesPacePeriod;
  onChange: (period: SalesPacePeriod) => void;
}) {
  return (
    <div
      className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-1 shadow-[var(--shadow-card)]"
      role="radiogroup"
      aria-label="Sales period"
    >
      {(Object.keys(PERIOD_LABELS) as SalesPacePeriod[]).map((period) => {
        const selected = value === period;

        return (
          <button
            key={period}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(period)}
            className={`min-h-10 rounded-lg px-2 text-[12px] font-semibold transition-[background-color,color,box-shadow] duration-150 ease-out active:scale-[0.98] ${
              selected
                ? 'bg-[var(--bg-inverse-primary)] text-[var(--content-inverse-primary)] shadow-sm'
                : 'bg-transparent text-[var(--content-tertiary)]'
            }`}
          >
            {PERIOD_LABELS[period]}
          </button>
        );
      })}
    </div>
  );
}

function ProgressBar({
  metric,
  size = 'md',
}: {
  metric: SalesPeriodMetric;
  size?: 'sm' | 'md';
}) {
  const { actualPercent } = salesProgress(metric);
  const ahead = metric.actual >= metric.expected;
  const height = size === 'sm' ? 'h-1.5' : 'h-2.5';

  return (
    <div
      className={`relative overflow-hidden rounded-full bg-[var(--gray-2)] ${height}`}
      aria-hidden="true"
    >
      <div
        className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out ${
          ahead ? 'bg-[var(--content-signal-ok)]' : 'bg-[var(--bg-negative)]'
        }`}
        style={{ width: `${Math.max(actualPercent, actualPercent > 0 ? 2 : 0)}%` }}
      />
    </div>
  );
}

function MetricTile({
  label,
  value,
  valueClassName,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  valueClassName?: string;
  tone?: 'neutral' | 'short' | 'ahead';
}) {
  const surface =
    tone === 'short'
      ? 'bg-[var(--bg-negative-subtle)] ring-1 ring-[var(--border-negative)]'
      : tone === 'ahead'
        ? 'bg-[var(--bg-positive-subtle)] ring-1 ring-[var(--border-positive)]'
        : 'bg-[var(--bg-primary)]';

  return (
    <div className={`min-w-0 rounded-xl px-3 py-3 ${surface}`}>
      <p className="text-[11px] font-medium leading-tight text-[var(--content-tertiary)]">{label}</p>
      <p
        className={`mt-1 truncate text-lg font-bold tracking-tight ${
          valueClassName ?? 'text-[var(--content-primary)]'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function SalesHero({
  data,
  period,
}: {
  data: SalesDashboardData;
  period: SalesPacePeriod;
}) {
  const metric = data.periods[period];
  const gap = salesGap(metric);
  const targetsPublished = data.status === 'ready';
  const periodLabel = salesPeriodLabel(period, data.asOfDate, data.financialYear?.label ?? null);
  const targetLabel = salesPeriodTargetLabel(period, data.asOfDate);
  const pressureLabel = periodPressureLabel(period, data);
  const achievementPercent =
    metric.expected > 0 ? Math.round((metric.actual / metric.expected) * 100) : null;
  const showAnnualFooter = targetsPublished && data.annualTarget > 0 && period !== 'fy';

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-[var(--shadow-card)]">
      <div className="px-4 pb-4 pt-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--content-tertiary)]">
              {periodLabel}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-[var(--content-quaternary)]">
              {pressureLabel}
            </p>
          </div>
          {targetsPublished && achievementPercent != null && (
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                gap.state === 'ahead'
                  ? 'bg-[var(--bg-positive-subtle)] text-[var(--content-signal-ok)]'
                  : 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]'
              }`}
            >
              {achievementPercent}% closed
            </span>
          )}
        </div>

        <div className="mt-4">
          <p className="text-[13px] font-medium text-[var(--content-tertiary)]">Billed so far</p>
          <p className="mt-0.5 text-[2.5rem] font-bold leading-none tracking-tight text-[var(--content-primary)]">
            {compactSalesCurrency(metric.actual)}
          </p>
        </div>

        {targetsPublished ? (
          <>
            <div className="mt-5">
              <ProgressBar metric={metric} />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <MetricTile
                label={targetLabel}
                value={compactSalesCurrency(metric.expected)}
              />
              <MetricTile
                label={gap.verbLabel}
                value={compactSalesCurrency(gap.amount)}
                tone={gap.state}
                valueClassName={
                  gap.state === 'ahead'
                    ? 'text-[var(--content-signal-ok)]'
                    : 'text-[var(--content-negative)]'
                }
              />
            </div>
          </>
        ) : (
          <div className="mt-5 rounded-xl bg-[var(--bg-primary)] px-3 py-3">
            <p className="text-sm font-semibold text-[var(--content-tertiary)]">
              Targets not published yet
            </p>
            <p className="mt-0.5 text-xs text-[var(--content-quaternary)]">
              Billed sales still show from Busy.
            </p>
          </div>
        )}
      </div>

      {showAnnualFooter && (
        <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)] px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-[var(--content-tertiary)]">
              Full-year target
              {data.financialYear ? ` · FY ${data.financialYear.label}` : ''}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--content-secondary)]">
              {compactSalesCurrency(data.annualTarget)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11px] font-medium text-[var(--content-tertiary)]">Left this year</p>
            <p className="mt-0.5 text-sm font-semibold text-[var(--content-secondary)]">
              {compactSalesCurrency(Math.max(data.remainingAnnual, 0))}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryRow({
  category,
  period,
  targetsPublished,
}: {
  category: SalesCategoryPace;
  period: SalesPacePeriod;
  targetsPublished: boolean;
}) {
  const metric = category[period];
  const hasTarget = targetsPublished && category.annualTarget > 0;
  const gap = salesGap(metric);

  return (
    <div className="grid min-h-[60px] grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-3">
      <div className="min-w-0">
        <p
          className="truncate text-[13px] font-semibold leading-tight text-[var(--content-primary)]"
          title={category.name}
        >
          {category.name}
        </p>
        <div className="mt-1.5">
          {hasTarget ? (
            <ProgressBar metric={metric} size="sm" />
          ) : (
            <div className="h-1.5 rounded-full bg-[var(--gray-2)]" />
          )}
        </div>
        <p className="mt-1.5 flex min-w-0 items-baseline gap-1.5 font-mono text-[11px] leading-tight">
          <span className="font-semibold text-[var(--content-primary)]">
            {compactSalesCurrency(metric.actual)}
          </span>
          <span className="text-[var(--content-quaternary)]">/</span>
          <span className="truncate text-[var(--content-tertiary)]">
            {hasTarget ? compactSalesCurrency(metric.expected) : 'no target'}
          </span>
        </p>
      </div>

      <p
        className={`min-w-[3.25rem] text-right font-mono text-[12px] font-semibold ${
          hasTarget ? gapTone(metric) : 'text-[var(--content-tertiary)]'
        }`}
      >
        {hasTarget ? gap.signedLabel : '—'}
      </p>
    </div>
  );
}

function CategoryBreakdown({
  data,
  period,
}: {
  data: SalesDashboardData;
  period: SalesPacePeriod;
}) {
  const [expanded, setExpanded] = useState(false);
  const categories = useMemo(
    () => sortSalesCategoriesByTarget(data.categories, period),
    [data.categories, period],
  );
  const visible = expanded ? categories : categories.slice(0, TOP_CATEGORY_COUNT);
  const hiddenCount = Math.max(categories.length - TOP_CATEGORY_COUNT, 0);
  const outsideAssigned = useMemo(() => {
    const rows = data.categories.filter(
      (category) => category.annualTarget <= 0 && category[period].actual !== 0,
    );
    return {
      amount: rows.reduce((sum, category) => sum + category[period].actual, 0),
      names: rows.map((category) => category.name),
    };
  }, [data.categories, period]);

  return (
    <section className="space-y-2.5">
      {outsideAssigned.amount !== 0 && (
        <div className="rounded-xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-3.5 py-3">
          <p className="text-sm font-semibold text-[var(--content-warning-on-light)]">
            {compactSalesCurrency(outsideAssigned.amount)} billed outside assigned targets
          </p>
          <p className="mt-0.5 text-xs text-[var(--content-secondary)]">
            Included in billed total, not in category progress:{' '}
            {outsideAssigned.names.join(', ')}.
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-[var(--shadow-card)]">
        <div className="flex items-end justify-between gap-3 border-b border-[var(--border-subtle)] px-3.5 py-3">
          <div>
            <h2 className="text-[13px] font-semibold text-[var(--content-primary)]">
              Top categories by target
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--content-tertiary)]">
              Biggest plan lines · vs full {period === 'fy' ? 'year' : period} target
            </p>
          </div>
          {categories.length > 0 && (
            <p className="shrink-0 text-[11px] font-medium text-[var(--content-quaternary)]">
              {categories.length} assigned
            </p>
          )}
        </div>

        {categories.length > 0 ? (
          <>
            <div className="divide-y divide-[var(--border-subtle)]">
              {visible.map((category) => (
                <CategoryRow
                  key={category.segmentId}
                  category={category}
                  period={period}
                  targetsPublished={data.status === 'ready'}
                />
              ))}
            </div>

            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((current) => !current)}
                className="flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[12px] font-semibold text-[var(--content-secondary)] transition-colors duration-150 ease-out active:scale-[0.99] active:bg-[var(--bg-tertiary)]"
                aria-expanded={expanded}
              >
                {expanded ? 'Show less' : `Show ${hiddenCount} more`}
                <CaretDown
                  size={14}
                  weight="bold"
                  className={`transition-transform duration-200 ease-out ${
                    expanded ? 'rotate-180' : ''
                  }`}
                />
              </button>
            )}
          </>
        ) : (
          <p className="px-3.5 py-6 text-sm text-[var(--content-tertiary)]">
            Category mappings are not ready for this financial year.
          </p>
        )}
      </div>
    </section>
  );
}

function UnifiedSalesModule({
  data,
  period,
  onPeriodChange,
}: {
  data: SalesDashboardData;
  period: SalesPacePeriod;
  onPeriodChange: (period: SalesPacePeriod) => void;
}) {
  return (
    <section className="space-y-3">
      <PeriodControl value={period} onChange={onPeriodChange} />
      <SalesHero data={data} period={period} />
      <CategoryBreakdown data={data} period={period} />
    </section>
  );
}

function ModuleSkeleton() {
  return (
    <Card className="min-h-[520px] overflow-hidden p-0" aria-label="Loading sales performance">
      <div className="p-4">
        <Skeleton variant="text" lines={2} />
      </div>
      <div className="min-h-[180px] border-y border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-4">
        <Skeleton variant="text" lines={5} />
      </div>
      <div className="p-4">
        <Skeleton variant="text" lines={8} />
      </div>
    </Card>
  );
}

const HOME_ACTIONS = [
  { label: 'New order', path: '/sales/new', icon: Plus },
  { label: 'My orders', path: '/sales/orders', icon: ListBullets },
  { label: 'My beat', path: '/sales/beat', icon: MapPin },
  { label: 'Pending', path: '/sales/pending-recovery', icon: HourglassHigh },
] as const;

function QuickActions() {
  return (
    <section
      aria-labelledby="sales-home-actions"
      className="rounded-2xl border border-[color-mix(in_srgb,var(--role-primary)_16%,var(--border-subtle))] p-4 shadow-[var(--shadow-card)]"
      style={{
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--role-primary) 16%, var(--bg-secondary)), color-mix(in srgb, var(--role-primary) 7%, var(--bg-secondary)))',
      }}
    >
      <h2 id="sales-home-actions" className="text-[15px] font-semibold text-[var(--content-primary)]">
        Quick actions
      </h2>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {HOME_ACTIONS.map(({ label, path, icon: Icon }) => (
          <Link
            key={path}
            to={path}
            className="flex flex-col items-center gap-2 rounded-xl px-1 py-1 text-center transition-transform duration-150 ease-out active:scale-[0.96] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--role-primary)]"
          >
            <span className="flex size-12 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-primary)] shadow-sm">
              <Icon size={22} weight="regular" />
            </span>
            <span className="max-w-[4.75rem] text-[11px] font-medium leading-tight text-[var(--content-primary)]">
              {label}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function SalesHome({
  showQuickActions = true,
}: {
  showQuickActions?: boolean;
} = {}): React.JSX.Element | null {
  const { userId, userName } = useAuth();
  const { data, isLoading, isError } = useSalesDashboard(userName, userId);
  const [offlineReady, setOfflineReady] = useState<boolean | null>(null);
  const [period, setPeriod] = useState<SalesPacePeriod>('month');

  useEffect(() => {
    void getSalesOfflineReadiness().then((readiness) => setOfflineReady(readiness.ready));
  }, []);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--content-primary)]">
      <div className="mx-auto max-w-2xl space-y-3.5 p-4 pb-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--content-primary)]">
            {greeting()}, {userName ?? 'there'}
          </h1>
          <p className="mt-0.5 text-sm text-[var(--content-tertiary)]">{todayFormatted()}</p>
          {data?.financialYear && (
            <p className="mt-1 text-[11px] text-[var(--content-quaternary)]">
              FY {data.financialYear.label} · {formatFyDate(data.financialYear.startsOn)} –{' '}
              {formatFyDate(data.financialYear.endsOn)}
            </p>
          )}
        </header>

        {offlineReady === false && (
          <Card className="p-3">
            <div className="flex items-center gap-3">
              <WifiSlash size={20} weight="bold" className="shrink-0 text-[var(--content-warning-on-light)]" />
              <p className="text-sm font-medium">Open once online to cache catalog and stock.</p>
            </div>
          </Card>
        )}

        {isError && (
          <Card className="border-[var(--border-negative)] bg-[var(--bg-negative-subtle)] p-3">
            <div className="flex items-center gap-3">
              <Warning size={20} weight="fill" className="shrink-0 text-[var(--content-negative)]" />
              <p className="text-sm font-semibold">Sales performance is temporarily unavailable.</p>
            </div>
          </Card>
        )}

        {data?.status === 'targets_missing' && (
          <Card className="border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] p-3">
            <div className="flex items-start gap-3">
              <Warning size={20} weight="fill" className="mt-0.5 shrink-0 text-[var(--content-warning-on-light)]" />
              <div>
                <p className="text-sm font-semibold">Targets are not published for this FY.</p>
                <p className="mt-0.5 text-xs text-[var(--content-secondary)]">Busy billed sales are still shown.</p>
              </div>
            </div>
          </Card>
        )}

        {showQuickActions && <QuickActions />}

        {isLoading ? <ModuleSkeleton /> : data ? (
          <UnifiedSalesModule data={data} period={period} onPeriodChange={setPeriod} />
        ) : null}

        {data?.freshness.aggregatedAt && (
          <p className="text-center text-xs text-[var(--content-tertiary)]">
            Busy summary refreshed {formatTimeAgo(data.freshness.aggregatedAt)}
          </p>
        )}
      </div>
    </div>
  );
}
