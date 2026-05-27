import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  Flag,
  HourglassHighIcon,
  ListBulletsIcon,
  SquaresFourIcon,
  TagIcon,
} from '@phosphor-icons/react';
import { usePendingItems } from '../../hooks/usePendingItems';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { useToast } from '../../context/ToastContext';
import { useOpenPoDemandLines } from '../../hooks/useOpenPoDemandLines';
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
  collectSalesReps,
} from '../../lib/purchase/supplyDemandAggregates';
import {
  SupplyDemandAgeLegend,
  SupplyDemandDateFilter,
  SupplyDemandSummaryStrip,
  SupplyDemandWarehouseFilter,
  useSupplyDemandUrlFilters,
} from '../../components/supply/SupplyDemandFilters';
import {
  BrandTab,
  LinesTab,
  PendingTab,
  PickIssuesTab,
  SkuTab,
} from '../../components/supply/SupplyDemandTabs';
import {
  buildAllBrandCopy,
  buildSingleBrandCopy,
  formatCurrency,
  formatNumber,
  isToday,
  type PendingDayRow,
  type SupplyDemandLocationStockProps,
} from '../../components/supply/supplyDemandShared';
import { useSupplyDemandLocationStock } from '../../hooks/useSupplyDemandLocationStock';
import { localDateKey } from '../../lib/purchase/supplyDemandFilters';
import { normalizeEmbeddedOrder } from '../../hooks/useOpenPoDemandLines';
import type { PendingItem } from '../../types';

type TabId = 'brand' | 'sku' | 'lines' | 'pending' | 'pick_issues';

function isTabId(value: string | null): value is TabId {
  return (
    value === 'brand' ||
    value === 'sku' ||
    value === 'lines' ||
    value === 'pending' ||
    value === 'pick_issues'
  );
}

export default function SupplyDemandPage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { copy, copiedId } = useCopyToClipboard();
  const [repFilter, setRepFilter] = useState<string | null>(null);

  const filters = useSupplyDemandUrlFilters();
  const tab = isTabId(filters.searchParams.get('tab')) ? filters.searchParams.get('tab') : 'brand';

  const { data: rawLines = [], isLoading: linesLoading, error: linesError } = useOpenPoDemandLines();
  const { data: pendingItemsRaw = [], isLoading: pendingLoading } = usePendingItems({ status: 'pending' });

  const openLines = useMemo(() => filterOpenWorkflowLines(rawLines), [rawLines]);
  const demandDates = useMemo(() => filters.collectDemandDateKeys(openLines), [openLines, filters]);

  const demandLines = useMemo(
    () => filterDemandLinesByDateRange(openLines, filters.selectedDateFrom, filters.selectedDateTo),
    [openLines, filters.selectedDateFrom, filters.selectedDateTo],
  );

  const locationDemandLines = useMemo(
    () => filterDemandLinesByLocation(demandLines, filters.locationFilter),
    [demandLines, filters.locationFilter],
  );

  const byBrand = useMemo(() => buildBrandSummaries(locationDemandLines), [locationDemandLines]);
  const bySku = useMemo(() => buildSkuSummaries(locationDemandLines), [locationDemandLines]);
  const totals = useMemo(
    () => buildDemandTotals(locationDemandLines, bySku, byBrand),
    [locationDemandLines, bySku, byBrand],
  );
  const allReps = useMemo(() => collectSalesReps(locationDemandLines), [locationDemandLines]);

  const filteredLines = useMemo(() => {
    if (!repFilter) return locationDemandLines;
    return locationDemandLines.filter((row) => {
      const order = normalizeEmbeddedOrder(row.orders);
      return order?.salesperson_name === repFilter;
    });
  }, [locationDemandLines, repFilter]);

  const pendingItems = useMemo(
    () => filterPendingItemsByLocation(pendingItemsRaw, filters.locationFilter),
    [pendingItemsRaw, filters.locationFilter],
  );

  const pickAuditItems = useMemo(
    () => pendingItems.filter((item) => item.issue_category != null && item.reviewed_at == null),
    [pendingItems],
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
      .map(([dateKey, data]) => ({ dateKey, itemCount: data.itemCount, qtyPending: data.qtyPending }))
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

  const {
    stockForItemId,
    stockLoadingForItemId,
    busyCodeByItemId,
  } = useSupplyDemandLocationStock(locationDemandLines, pendingItems);

  const locationStock = useMemo<SupplyDemandLocationStockProps>(
    () => ({
      stockForItemId,
      stockLoadingForItemId,
      busyCodeForItemId: (itemId) => busyCodeByItemId.get(itemId) ?? null,
    }),
    [stockForItemId, stockLoadingForItemId, busyCodeByItemId],
  );

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['open-po-demand-lines'] });
    queryClient.invalidateQueries({ queryKey: ['pending-items'] });
    queryClient.invalidateQueries({ queryKey: ['stock_locationwise'] });
    queryClient.invalidateQueries({ queryKey: ['supply-demand-item-busy-codes'] });
  };

  const copyWithToast = async (text: string, id: string, successMessage: string) => {
    const ok = await copy(text, id);
    if (ok) toast.success(successMessage);
    else toast.error('Could not copy to clipboard');
  };

  const handleCopyAllBrands = () => {
    void copyWithToast(
      buildAllBrandCopy(byBrand),
      'copy-all-brands',
      `Copied ${formatNumber(byBrand.length)} brands for Excel`,
    );
  };

  const handleCopyBrand = (brand: (typeof byBrand)[number]) => {
    void copyWithToast(
      buildSingleBrandCopy(brand),
      `copy-brand-${brand.label}`,
      `Copied ${brand.label} rows for Excel`,
    );
  };

  const updateSearchParams = (updates: { tab?: TabId }) => {
    const next = new URLSearchParams(filters.searchParams);
    if (updates.tab) next.set('tab', updates.tab);
    filters.setSearchParams(next, { replace: true });
  };

  const openSkuDetail = (itemId: number, fromTab: 'brand' | 'sku') => {
    const next = new URLSearchParams();
    next.set('fromTab', fromTab);
    if (filters.selectedDateFrom) next.set('from', filters.selectedDateFrom);
    if (filters.selectedDateTo) next.set('to', filters.selectedDateTo);
    const warehouse = demandLocationFilterParam(filters.locationFilter);
    if (warehouse) next.set('warehouse', warehouse);
    navigate(`/admin/supply/sku/${itemId}?${next.toString()}`);
  };

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
      <div className="mx-auto max-w-6xl px-4 pb-10 pt-4 lg:px-6">
        <div className="mb-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="rounded-xl bg-[var(--bg-secondary)] p-2 text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
            aria-label="Back"
          >
            <ArrowLeftIcon size={22} weight="bold" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold text-[var(--content-primary)]">Pending purchase orders</h1>
            <p className="text-sm text-[var(--content-tertiary)]">
              Start with the total quantity to buy, then see the brand-wise split, then the item-level detail.
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

        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--bg-accent)] bg-[color-mix(in_srgb,var(--bg-accent-subtle)_78%,white)] px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
              Total Items To Purchase
            </p>
            <p className="mt-1 text-4xl font-bold text-[var(--content-primary)] tabular-nums sm:text-5xl">
              {formatNumber(totals.poPieces)}
            </p>
          </div>
          {totals.totalValue > 0 && (
            <div className="rounded-2xl border border-[color-mix(in_srgb,var(--content-positive)_30%,var(--border-subtle))] bg-[var(--bg-positive-subtle)] px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                Sales Loss
              </p>
              <p className="mt-1 text-4xl font-bold tabular-nums text-[var(--content-positive)] sm:text-5xl">
                {formatCurrency(totals.totalValue)}
              </p>
            </div>
          )}
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
        />

        <SupplyDemandAgeLegend />

        <div className="mt-4 flex flex-wrap gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-1">
          {(
            [
              ['brand', 'Brands', TagIcon],
              ['sku', 'Items', SquaresFourIcon],
              ['lines', 'Orders', ListBulletsIcon],
              ['pending', 'Queue', HourglassHighIcon],
              ['pick_issues', 'Pick issues', Flag],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => updateSearchParams({ tab: id })}
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
          {tab === 'brand' && (
            <BrandTab
              rows={byBrand}
              loading={linesLoading}
              error={linesError}
              activeRangeLabel={filters.activeRangeLabel}
              hasDateRange={filters.hasDateRange}
              onCopyAllBrands={handleCopyAllBrands}
              onCopyBrand={handleCopyBrand}
              onOpenSku={openSkuDetail}
              copiedId={copiedId}
            />
          )}
          {tab === 'sku' && (
            <SkuTab
              rows={bySku}
              loading={linesLoading}
              error={linesError}
              mode="admin"
              onOpenSku={openSkuDetail}
              locationStock={locationStock}
            />
          )}
          {tab === 'lines' && (
            <LinesTab
              lines={filteredLines}
              allLines={locationDemandLines}
              allReps={allReps}
              repFilter={repFilter}
              onRepFilter={setRepFilter}
              loading={linesLoading}
              error={linesError}
              mode="admin"
              locationStock={locationStock}
            />
          )}
          {tab === 'pending' && (
            <PendingTab
              items={pendingItems}
              loading={pendingLoading}
              pendingByDay={pendingByDay}
              pendingSummary={pendingSummary}
              locationStock={locationStock}
            />
          )}
          {tab === 'pick_issues' && (
            <PickIssuesTab items={pickAuditItems} loading={pendingLoading} />
          )}
        </div>
      </div>
    </div>
  );
}
