import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowsClockwiseIcon,
  HourglassHighIcon,
  ListBulletsIcon,
  SquaresFourIcon,
} from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';
import { usePartnerCompanies } from '../../hooks/usePartnerCompanies';
import { useOpenPoDemandLines } from '../../hooks/useOpenPoDemandLines';
import { usePendingItems } from '../../hooks/usePendingItems';
import { demandLocationFilterParam } from '../../lib/purchase/openPoDemand';
import {
  filterDemandLinesByDateRange,
  filterDemandLinesByLocation,
  filterOpenWorkflowLines,
  filterPendingItemsByLocation,
} from '../../lib/purchase/supplyDemandFilters';
import {
  buildBrandSummaries,
  buildDemandTotals,
  buildSkuSummaries,
} from '../../lib/purchase/supplyDemandAggregates';
import {
  SupplyDemandAgeLegend,
  SupplyDemandDateFilter,
  SupplyDemandSummaryStrip,
  SupplyDemandWarehouseFilter,
  useSupplyDemandUrlFilters,
} from '../../components/supply/SupplyDemandFilters';
import { LinesTab, PendingTab, SkuTab } from '../../components/supply/SupplyDemandTabs';
import { localDateKey } from '../../lib/purchase/supplyDemandFilters';
import {
  ageDays,
  countLabel,
  formatNumber,
  isToday,
  type PendingDayRow,
} from '../../components/supply/supplyDemandShared';
import type { PendingItem } from '../../types';

type PartnerTabId = 'sku' | 'lines' | 'pending';

function isPartnerTabId(value: string | null): value is PartnerTabId {
  return value === 'sku' || value === 'lines' || value === 'pending';
}

export default function PartnerSupplyPage(): React.JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { partnerCompanyId, userName } = useAuth();
  const { data: companies = [] } = usePartnerCompanies();

  const partner = useMemo(
    () => companies.find((c) => c.id === partnerCompanyId) ?? null,
    [companies, partnerCompanyId],
  );
  const brandKeys = partner?.brand_keys;

  const filters = useSupplyDemandUrlFilters();
  const tabParam = filters.searchParams.get('tab');
  const tab: PartnerTabId = isPartnerTabId(tabParam) ? tabParam : 'sku';

  const { data: rawLines = [], isLoading: linesLoading, error: linesError } = useOpenPoDemandLines({
    brandKeys,
  });
  const { data: pendingItemsRaw = [], isLoading: pendingLoading } = usePendingItems({
    status: 'pending',
    brandKeys,
  });

  const openLines = useMemo(() => filterOpenWorkflowLines(rawLines), [rawLines]);

  const demandDates = useMemo(
    () => filters.collectDemandDateKeys(openLines),
    [openLines, filters],
  );

  const demandLines = useMemo(
    () =>
      filterDemandLinesByDateRange(openLines, filters.selectedDateFrom, filters.selectedDateTo),
    [openLines, filters.selectedDateFrom, filters.selectedDateTo],
  );

  const locationDemandLines = useMemo(
    () => filterDemandLinesByLocation(demandLines, filters.locationFilter),
    [demandLines, filters.locationFilter],
  );

  const bySku = useMemo(() => buildSkuSummaries(locationDemandLines), [locationDemandLines]);
  const byBrand = useMemo(() => buildBrandSummaries(locationDemandLines), [locationDemandLines]);
  const totals = useMemo(
    () => buildDemandTotals(locationDemandLines, bySku, byBrand),
    [locationDemandLines, bySku, byBrand],
  );

  const pendingItems = useMemo(
    () => filterPendingItemsByLocation(pendingItemsRaw, filters.locationFilter),
    [pendingItemsRaw, filters.locationFilter],
  );

  const pendingByDay = useMemo<PendingDayRow[]>(() => {
    const dayMap = new Map<string, { itemCount: number; qtyPending: number }>();
    for (const item of pendingItems) {
      const key = localDateKey(item.created_at);
      const prev = dayMap.get(key) ?? { itemCount: 0, qtyPending: 0 };
      prev.itemCount += 1;
      prev.qtyPending += item.qty_pending;
      dayMap.set(key, prev);
    }
    return [...dayMap.entries()]
      .map(([dateKey, data]) => ({
        dateKey,
        itemCount: data.itemCount,
        qtyPending: data.qtyPending,
      }))
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
      .slice(0, 7);
  }, [pendingItems]);

  const pendingSummary = useMemo(() => {
    const todayItems = pendingItems.filter((item) => isToday(item.created_at));
    const totalQty = pendingItems.reduce((sum, item) => sum + item.qty_pending, 0);
    const sourceMap = new Map<PendingItem['source'], { count: number; qty: number }>();
    let oldestCreatedAt: string | null = null;
    for (const item of pendingItems) {
      if (!oldestCreatedAt || item.created_at < oldestCreatedAt) oldestCreatedAt = item.created_at;
      const prev = sourceMap.get(item.source) ?? { count: 0, qty: 0 };
      prev.count += 1;
      prev.qty += item.qty_pending;
      sourceMap.set(item.source, prev);
    }
    return {
      totalQty,
      todayCount: todayItems.length,
      todayQty: todayItems.reduce((sum, item) => sum + item.qty_pending, 0),
      oldestCreatedAt,
      sources: [...sourceMap.entries()].map(([source, data]) => ({ source, ...data })),
    };
  }, [pendingItems]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['open-po-demand-lines'] });
    queryClient.invalidateQueries({ queryKey: ['pending-items'] });
  };

  const updateTab = (nextTab: PartnerTabId) => {
    const next = new URLSearchParams(filters.searchParams);
    next.set('tab', nextTab);
    filters.setSearchParams(next, { replace: true });
  };

  const openSkuDetail = (itemId: number) => {
    const next = new URLSearchParams();
    next.set('fromTab', 'sku');
    if (filters.selectedDateFrom) next.set('from', filters.selectedDateFrom);
    if (filters.selectedDateTo) next.set('to', filters.selectedDateTo);
    const warehouse = demandLocationFilterParam(filters.locationFilter);
    if (warehouse) next.set('warehouse', warehouse);
    navigate(`/partner/supply/sku/${itemId}?${next.toString()}`);
  };

  if (!partner) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 lg:px-6">
        <p className="text-sm text-[var(--content-negative)]">
          Company not found. Please switch role and select your company again.
        </p>
      </div>
    );
  }

  const displayName = userName ?? partner.display_name;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-4 lg:px-6">
      <div className="mb-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-[var(--content-primary)]">
            {displayName} — Pending demand
          </h1>
          <p className="text-sm text-[var(--content-tertiary)]">
            Open order lines and queue items for your brand only.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="rounded-xl bg-[var(--bg-secondary)] p-2 text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
          aria-label="Refresh"
        >
          <ArrowsClockwiseIcon size={22} weight="bold" />
        </button>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--bg-accent)] bg-[color-mix(in_srgb,var(--bg-accent-subtle)_78%,white)] px-5 py-4 sm:col-span-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
            Qty to fulfill
          </p>
          <p className="mt-1 text-4xl font-bold text-[var(--content-primary)] tabular-nums sm:text-5xl">
            {formatNumber(totals.poPieces)}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">Items</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-[var(--content-primary)]">{formatNumber(totals.skuCount)}</p>
          <p className="mt-1 text-sm text-[var(--content-secondary)]">{countLabel(totals.customerCount, 'customer')}</p>
        </div>
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">Orders</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-[var(--content-primary)]">{formatNumber(totals.orderCount)}</p>
          {totals.poPieces > 0 && bySku[0]?.oldestCreatedAt && (
            <p className="mt-1 text-sm text-[var(--content-secondary)]">
              Oldest {ageDays(bySku[0].oldestCreatedAt!)}d
            </p>
          )}
        </div>
      </section>

      <SupplyDemandDateFilter
        draftDateFrom={filters.draftDateFrom}
        draftDateTo={filters.draftDateTo}
        setDraftDateFrom={filters.setDraftDateFrom}
        setDraftDateTo={filters.setDraftDateTo}
        selectedDateFrom={filters.selectedDateFrom}
        selectedDateTo={filters.selectedDateTo}
        hasDateRange={filters.hasDateRange}
        activeRangeLabel={filters.activeRangeLabel}
        dateRangeInvalid={filters.dateRangeInvalid}
        todayKey={filters.todayKey}
        demandDates={demandDates}
        applyDateRange={filters.applyDateRange}
        clearDateRange={filters.clearDateRange}
        applyPresetRange={filters.applyPresetRange}
        formatShortDate={filters.formatShortDate}
        addDays={filters.addDays}
        monthStart={filters.monthStart}
      />

      <SupplyDemandWarehouseFilter
        locationFilter={filters.locationFilter}
        activeLocationLabel={filters.activeLocationLabel}
        applyLocationFilter={filters.applyLocationFilter}
      />

      <SupplyDemandSummaryStrip
        activeRangeLabel={filters.activeRangeLabel}
        locationFilter={filters.locationFilter}
        activeLocationLabel={filters.activeLocationLabel}
        skuCount={totals.skuCount}
        brandCount={totals.brandCount}
        orderCount={totals.orderCount}
        showBrandCount={false}
      />

      <SupplyDemandAgeLegend />

      <div className="mt-4 flex flex-wrap gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-1">
        {(
          [
            ['sku', 'Items', SquaresFourIcon],
            ['lines', 'Orders', ListBulletsIcon],
            ['pending', 'Queue', HourglassHighIcon],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => updateTab(id)}
            className={`flex min-w-[7rem] flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-sm font-semibold transition-colors ${
              tab === id
                ? 'border border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                : 'text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            <Icon size={16} weight={tab === id ? 'fill' : 'regular'} />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-4">
        {tab === 'sku' && (
          <SkuTab
            rows={bySku}
            loading={linesLoading}
            error={linesError}
            mode="partner"
            onOpenSku={(itemId) => openSkuDetail(itemId)}
          />
        )}
        {tab === 'lines' && (
          <LinesTab
            lines={locationDemandLines}
            allLines={locationDemandLines}
            allReps={[]}
            repFilter={null}
            onRepFilter={() => {}}
            loading={linesLoading}
            error={linesError}
            mode="partner"
          />
        )}
        {tab === 'pending' && (
          <PendingTab
            items={pendingItems}
            loading={pendingLoading}
            pendingByDay={pendingByDay}
            pendingSummary={pendingSummary}
          />
        )}
      </div>
    </div>
  );
}
