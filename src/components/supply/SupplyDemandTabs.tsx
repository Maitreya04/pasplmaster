import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserIcon, WarningCircle } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';
import { markPendingIssueReviewed } from '../../lib/billing/ensurePendingItem';
import {
  normalizeEmbeddedOrder,
  type OpenPoDemandLine,
} from '../../hooks/useOpenPoDemandLines';
import { useToast } from '../../context/ToastContext';
import type { PendingItem } from '../../types';
import {
  AgePill,
  AliasChipRow,
  CopyButton,
  EmptyBlock,
  MetricCard,
  SectionCard,
  ageDays,
  countLabel,
  demandLocationLabel,
  formatCurrency,
  formatNumber,
  formatShortDate,
  formatTimeAgo,
  groupLabel,
  lineBusyCode,
  linePoValue,
  pendingSourceLabel,
  type BrandSummary,
  type PendingDayRow,
  type SkuSummary,
  type SupplyDemandLocationStockProps,
  type SupplyDemandViewMode,
} from './supplyDemandShared';
import { LocationStockChips } from './LocationStockChips';

export function BrandTab({
  rows,
  loading,
  error,
  activeRangeLabel,
  hasDateRange,
  onCopyAllBrands,
  onCopyBrand,
  onOpenSku,
  copiedId,
}: {
  rows: BrandSummary[];
  loading: boolean;
  error: Error | null;
  activeRangeLabel: string;
  hasDateRange: boolean;
  onCopyAllBrands: () => void;
  onCopyBrand: (brand: BrandSummary) => void;
  onOpenSku: (itemId: number, fromTab: 'brand' | 'sku') => void;
  copiedId: string;
}) {
  if (loading) return <p className="text-sm text-[var(--content-tertiary)]">Loading brands...</p>;
  if (error) return <p className="text-sm text-[var(--content-negative)]">Could not load brand demand.</p>;
  if (rows.length === 0) {
    return <EmptyBlock text={hasDateRange ? `No purchase demand for ${activeRangeLabel}.` : 'No open purchase demand right now.'} />;
  }

  return (
    <>
      <SectionCard
        title="Brand-wise split"
        subtitle={
          hasDateRange
            ? `Showing brand-wise purchase demand for ${activeRangeLabel}.`
            : 'Use this view to see each brand total and which items make up that brand total.'
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--content-secondary)]">
            Copy all brand rows for a master sheet, or copy one brand for a focused supplier conversation.
          </p>
          <CopyButton
            label="Copy all brands"
            copiedLabel="Copied all brands"
            copied={copiedId === 'copy-all-brands'}
            onClick={onCopyAllBrands}
          />
        </div>
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-2">
        {rows.map((brand) => (
          <section
            key={brand.label}
            className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 sm:p-5"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-semibold text-[var(--content-primary)]">{brand.label}</h2>
                  {brand.oldestCreatedAt && <AgePill createdAt={brand.oldestCreatedAt} />}
                </div>
                <p className="mt-1 text-sm text-[var(--content-secondary)]">
                  {formatNumber(brand.totalPo)} qty to buy across {countLabel(brand.distinctSkus, 'item')} and {countLabel(brand.customerCount, 'customer')}
                </p>
              </div>
              <CopyButton
                label="Copy brand"
                copiedLabel="Copied brand"
                copied={copiedId === `copy-brand-${brand.label}`}
                onClick={() => onCopyBrand(brand)}
                subtle
              />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <MetricCard label="Qty To Buy" value={formatNumber(brand.totalPo)} hint="Main brand total" />
              <MetricCard label="Items" value={formatNumber(brand.distinctSkus)} hint="Distinct items in this brand" />
              <MetricCard label="Value" value={formatCurrency(brand.totalValue)} hint="Estimated buy value" tone="accent" />
              <MetricCard
                label="Old 14d+"
                value={formatNumber(brand.staleQty)}
                hint={countLabel(brand.staleLines, 'old line', 'old lines')}
                tone={brand.staleQty > 0 ? 'warning' : 'default'}
              />
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--border-subtle)]">
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 bg-[var(--bg-primary)] px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                <span>Item</span>
                <span>Qty</span>
                <span>Lines</span>
              </div>
              <div className="divide-y divide-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                {brand.skuRows.map((sku) => (
                  <button
                    key={sku.item_id}
                    type="button"
                    onClick={() => onOpenSku(sku.item_id, 'brand')}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto_auto] gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-[var(--bg-primary)]"
                  >
                    <div className="min-w-0">
                      <AliasChipRow alias1={sku.item_alias1} alias={sku.item_alias} className="mb-2" />
                      <p className="truncate font-medium text-[var(--content-primary)]">{sku.item_name}</p>
                      <p className="mt-2 text-xs text-[var(--content-tertiary)]">
                        {formatCurrency(sku.totalValue)} · {countLabel(sku.customerCount, 'customer')}
                      </p>
                    </div>
                    <span className="font-mono font-semibold text-[var(--content-primary)]">{formatNumber(sku.totalPo)}</span>
                    <span className="font-mono text-[var(--content-secondary)]">{formatNumber(sku.lineCount)}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

export function SkuTab({
  rows,
  loading,
  error,
  mode,
  onOpenSku,
  locationStock,
}: {
  rows: SkuSummary[];
  loading: boolean;
  error: Error | null;
  mode: SupplyDemandViewMode;
  onOpenSku: (itemId: number, fromTab: 'brand' | 'sku') => void;
  locationStock?: SupplyDemandLocationStockProps;
}) {
  if (loading) return <p className="text-sm text-[var(--content-tertiary)]">Loading items...</p>;
  if (error) return <p className="text-sm text-[var(--content-negative)]">Could not load item demand.</p>;
  if (rows.length === 0) return <EmptyBlock text="No open purchase demand right now." />;

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li
          key={row.item_id}
          className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-4"
        >
          <button
            type="button"
            onClick={() => onOpenSku(row.item_id, 'sku')}
            className="w-full text-left"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <AliasChipRow alias1={row.item_alias1} alias={row.item_alias} className="mb-2" />
                <p className="line-clamp-2 text-base font-semibold text-[var(--content-primary)]">{row.item_name}</p>
                {mode === 'admin' && (
                  <p className="mt-2 text-sm text-[var(--content-tertiary)]">{row.brandLabel}</p>
                )}
              </div>
              {row.oldestCreatedAt && <AgePill createdAt={row.oldestCreatedAt} />}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-[var(--content-secondary)]">
              <span>
                Qty to buy <span className="font-mono font-bold text-[var(--content-primary)]">{formatNumber(row.totalPo)}</span>
              </span>
              {mode === 'admin' && (
                <span>
                  Value <span className="font-mono font-semibold text-[var(--content-accent)]">{formatCurrency(row.totalValue)}</span>
                </span>
              )}
              <span>{countLabel(row.lineCount, 'order line')}</span>
              <span>{countLabel(row.customerCount, 'customer')}</span>
            </div>
            {locationStock && (
              <LocationStockChips
                stock={locationStock.stockForItemId(row.item_id)}
                busyCode={row.busy_code ?? locationStock.busyCodeForItemId(row.item_id)}
                loading={locationStock.stockLoadingForItemId(row.item_id)}
                className="mt-3"
              />
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function LinesTab({
  lines,
  allLines,
  allReps,
  repFilter,
  onRepFilter,
  loading,
  error,
  mode,
  locationStock,
}: {
  lines: OpenPoDemandLine[];
  allLines: OpenPoDemandLine[];
  allReps: string[];
  repFilter: string | null;
  onRepFilter: (rep: string | null) => void;
  loading: boolean;
  error: Error | null;
  mode: SupplyDemandViewMode;
  locationStock?: SupplyDemandLocationStockProps;
}) {
  if (loading) return <p className="text-sm text-[var(--content-tertiary)]">Loading lines...</p>;
  if (error) return <p className="text-sm text-[var(--content-negative)]">Could not load PO lines.</p>;
  if (allLines.length === 0) return <EmptyBlock text="No open purchase demand right now." />;

  return (
    <div className="space-y-3">
      {mode === 'admin' && allReps.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onRepFilter(null)}
            className={`flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-semibold transition-colors ${
              repFilter === null
                ? 'border border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                : 'border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            All reps
          </button>
          {allReps.map((rep) => (
            <button
              key={rep}
              type="button"
              onClick={() => onRepFilter(rep === repFilter ? null : rep)}
              className={`flex h-8 items-center gap-1 rounded-lg px-3 text-xs font-semibold transition-colors ${
                repFilter === rep
                  ? 'border border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                  : 'border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              <UserIcon size={11} />
              {rep}
            </button>
          ))}
        </div>
      )}

      {lines.length === 0 ? (
        <EmptyBlock text={mode === 'admin' ? 'No lines for this rep.' : 'No order lines right now.'} />
      ) : (
        <ul className="space-y-3">
          {lines.map((row) => {
            const order = normalizeEmbeddedOrder(row.orders);
            const poValue = linePoValue(row);
            return (
              <li
                key={row.id}
                className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-base font-semibold text-[var(--content-primary)]">{row.item_name}</p>
                    <p className="mt-1 font-mono text-xs text-[var(--content-tertiary)]">
                      {order?.order_number ?? '-'} · {order?.customer_name ?? '-'}
                    </p>
                  </div>
                  {order?.created_at && <AgePill createdAt={order.created_at} />}
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-sm text-[var(--content-secondary)]">
                  <span>
                    Qty to buy <span className="font-mono font-bold text-[var(--content-warning)]">{formatNumber(row.qty_po)}</span>
                  </span>
                  <span>Shippable {formatNumber(row.qty_shippable)}</span>
                  <span>Requested {formatNumber(row.qty_requested)}</span>
                  {mode === 'admin' && <span>{formatCurrency(poValue)}</span>}
                  {mode === 'admin' && (
                    <span className="rounded-md bg-[var(--bg-primary)] px-2 py-0.5">{groupLabel(row)}</span>
                  )}
                  {row.loss_source && (
                    <span className="rounded-md bg-[var(--bg-warning-subtle)] px-2 py-0.5 text-[var(--content-warning)]">
                      {pendingSourceLabel(row.loss_source)} loss
                    </span>
                  )}
                  <span className="rounded-md bg-[var(--bg-primary)] px-2 py-0.5">
                    {demandLocationLabel(row.stock_location_code ?? order?.stock_location_code)}
                  </span>
                  {mode === 'admin' && order?.salesperson_name && (
                    <span className="flex items-center gap-1">
                      <UserIcon size={11} />
                      {order.salesperson_name}
                    </span>
                  )}
                </div>

                {order?.created_at && (
                  <p className="mt-3 text-xs text-[var(--content-quaternary)]">
                    {formatShortDate(order.created_at)} · {formatTimeAgo(order.created_at)} · {order.workflow_status}
                  </p>
                )}

                {locationStock && (
                  <LocationStockChips
                    stock={locationStock.stockForItemId(row.item_id)}
                    busyCode={lineBusyCode(row) ?? locationStock.busyCodeForItemId(row.item_id)}
                    loading={locationStock.stockLoadingForItemId(row.item_id)}
                    className="mt-3"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function issueCategoryLabel(category: string | null | undefined): string {
  switch (category) {
    case 'out_of_stock':
      return 'Out of stock';
    case 'cant_find':
      return "Can't find";
    case 'wrong_part':
      return 'Wrong part';
    case 'damaged':
      return 'Damaged';
    case 'other':
      return 'Other';
    case 'unknown':
      return 'Unknown';
    default:
      return category ?? 'Issue';
  }
}

export function PickIssuesTab({
  items,
  loading,
}: {
  items: PendingItem[];
  loading: boolean;
}): React.JSX.Element {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { userName } = useAuth();
  const [reviewingId, setReviewingId] = useState<number | null>(null);

  const reviewMutation = useMutation({
    mutationFn: async (itemId: number) => {
      await markPendingIssueReviewed(itemId, userName ?? 'Warehouse');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-items'] });
      toast.success('Marked as reviewed');
      setReviewingId(null);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Could not mark reviewed');
      setReviewingId(null);
    },
  });

  if (loading) {
    return <p className="text-sm text-[var(--content-tertiary)]">Loading pick issues...</p>;
  }
  if (items.length === 0) {
    return <EmptyBlock text="No open pick issues awaiting warehouse review." />;
  }

  return (
    <>
      <SectionCard
        title="Warehouse pick audit"
        subtitle="Items flagged during picking and confirmed by billing. Mark reviewed after checking stock or rack location."
      >
        <p className="text-sm text-[var(--content-secondary)]">
          {countLabel(items.length, 'issue')} awaiting review
        </p>
      </SectionCard>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-3xl border border-[var(--border-warning)] bg-[var(--bg-secondary)] px-4 py-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[var(--bg-negative-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--content-negative)]">
                    {issueCategoryLabel(item.issue_category)}
                  </span>
                  <span className="rounded-full bg-[var(--bg-warning-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--content-warning)]">
                    {pendingSourceLabel(item.source)}
                  </span>
                </div>
                <p className="mt-2 text-base font-semibold text-[var(--content-primary)]">
                  {item.item_name}
                </p>
                <p className="mt-1 text-sm text-[var(--content-secondary)]">
                  {item.customer_name} ·{' '}
                  <span className="font-mono text-xs">{item.order_number}</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-sm text-[var(--content-secondary)]">
                  <span>
                    Qty{' '}
                    <span className="font-mono font-bold text-[var(--content-primary)]">
                      {formatNumber(item.qty_pending)}
                    </span>
                  </span>
                  <span className="rounded-md bg-[var(--bg-primary)] px-2 py-0.5">
                    {demandLocationLabel(item.stock_location_code)}
                  </span>
                  {item.created_by && <span>by {item.created_by}</span>}
                </div>
                {item.note && (
                  <p className="mt-2 text-xs text-[var(--content-tertiary)]">{item.note}</p>
                )}
              </div>
              <AgePill createdAt={item.created_at} />
            </div>
            <button
              type="button"
              disabled={reviewMutation.isPending && reviewingId === item.id}
              onClick={() => {
                setReviewingId(item.id);
                reviewMutation.mutate(item.id);
              }}
              className="mt-3 inline-flex h-9 items-center justify-center rounded-xl border border-[var(--border-positive)] bg-[var(--bg-positive-subtle)] px-4 text-sm font-semibold text-[var(--content-positive)] hover:opacity-95 disabled:opacity-50"
            >
              {reviewMutation.isPending && reviewingId === item.id
                ? 'Saving…'
                : 'Mark reviewed'}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function PendingTab({
  items,
  loading,
  pendingByDay,
  pendingSummary,
  locationStock,
}: {
  items: PendingItem[];
  loading: boolean;
  pendingByDay: PendingDayRow[];
  pendingSummary: {
    totalQty: number;
    todayCount: number;
    todayQty: number;
    oldestCreatedAt: string | null;
    sources: Array<{ source: PendingItem['source']; count: number; qty: number }>;
  };
  locationStock?: SupplyDemandLocationStockProps;
}) {
  if (loading) return <p className="text-sm text-[var(--content-tertiary)]">Loading pending queue...</p>;
  if (items.length === 0) return <EmptyBlock text="No pending items." />;

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard
          title="Queue summary"
          subtitle="Every open pending row from sales checkout, billing, or picking. Totals above already include these quantities without double-counting."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricCard label="Queue Records" value={formatNumber(items.length)} hint="Current tracking records" tone="warning" />
            <MetricCard label="Queue Qty" value={formatNumber(pendingSummary.totalQty)} hint="Quantity mentioned inside queue records" />
            <MetricCard
              label="Oldest Age"
              value={pendingSummary.oldestCreatedAt ? `${ageDays(pendingSummary.oldestCreatedAt)}d` : '0d'}
              hint={pendingSummary.oldestCreatedAt ? formatShortDate(pendingSummary.oldestCreatedAt) : 'No queue age'}
              tone={pendingSummary.oldestCreatedAt && ageDays(pendingSummary.oldestCreatedAt) >= 14 ? 'danger' : 'default'}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {pendingSummary.sources.map((source) => (
              <span
                key={source.source}
                className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-1 text-sm text-[var(--content-secondary)]"
              >
                {pendingSourceLabel(source.source)}: {countLabel(source.count, 'item')} / {formatNumber(source.qty)} qty
              </span>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Day-wise pending orders"
          subtitle="See how many pending records and quantity were added each day."
        >
          <div className="space-y-3">
            {pendingByDay.map((day) => (
              <div
                key={day.dateKey}
                className="flex items-center justify-between rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] p-4"
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--content-primary)]">{formatShortDate(day.dateKey)}</p>
                  <p className="text-xs text-[var(--content-tertiary)]">{countLabel(day.itemCount, 'item')} entered queue</p>
                </div>
                <p className="text-sm font-semibold text-[var(--content-primary)]">{formatNumber(day.qtyPending)} qty</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <ul className="space-y-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-[var(--content-primary)]">{item.customer_name}</p>
                  <span className="rounded-full bg-[var(--bg-warning-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--content-warning)]">
                    {pendingSourceLabel(item.source)}
                  </span>
                </div>
                <p className="mt-1 font-mono text-xs text-[var(--content-tertiary)]">{item.order_number}</p>
              </div>
              <AgePill createdAt={item.created_at} />
            </div>

            <p className="mt-1 text-sm text-[var(--content-secondary)]">{item.item_name}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-sm text-[var(--content-secondary)]">
              <span>
                Pending <span className="font-mono font-bold text-[var(--content-warning)]">{formatNumber(item.qty_pending)}</span>
              </span>
              <span className="rounded-md bg-[var(--bg-primary)] px-2 py-0.5">
                {demandLocationLabel(item.stock_location_code)}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-sm text-[var(--content-secondary)]">
              <span>
                Qty <span className="font-mono font-bold text-[var(--content-primary)]">{formatNumber(item.qty_pending)}</span>
              </span>
              {item.note && (
                <span className="inline-flex items-center gap-1 text-[var(--content-warning)]">
                  <WarningCircle size={14} weight="fill" />
                  {item.note}
                </span>
              )}
            </div>

            {locationStock && typeof item.item_id === 'number' && (
              <LocationStockChips
                stock={locationStock.stockForItemId(item.item_id)}
                busyCode={locationStock.busyCodeForItemId(item.item_id)}
                loading={locationStock.stockLoadingForItemId(item.item_id)}
                className="mt-3"
              />
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
