import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeftIcon, ListBulletsIcon, UserIcon } from '@phosphor-icons/react';
import {
  OPEN_PO_WORKFLOW_STATUSES,
  normalizeEmbeddedItem,
  normalizeEmbeddedOrder,
  useOpenPoDemandLines,
} from '../../hooks/useOpenPoDemandLines';
import {
  demandLocationFilterLabel,
  matchesDemandLocationFilter,
  parseDemandLocationFilter,
  resolveDemandLineLocation,
} from '../../lib/purchase/openPoDemand';
import { cleanDateParam, localDateKey } from '../../lib/purchase/supplyDemandFilters';
import { matchesPartnerBrand } from '../../lib/purchase/partnerBrandMatch';
import {
  AgePill,
  AliasChip,
  MetricCard,
  countLabel,
  formatCurrency,
  formatDateRangeLabel,
  formatNumber,
  formatShortDate,
  formatTimeAgo,
  groupLabel,
  linePoValue,
  pendingSourceLabel,
  demandLocationLabel,
  type SupplyDemandViewMode,
} from './supplyDemandShared';

export type SupplyDemandSkuDetailViewProps = {
  mode: SupplyDemandViewMode;
  brandKeys?: string[];
  backPath: string;
};

export function SupplyDemandSkuDetailView({
  mode,
  brandKeys,
  backPath,
}: SupplyDemandSkuDetailViewProps) {
  const navigate = useNavigate();
  const { itemId: itemIdParam } = useParams();
  const [searchParams] = useSearchParams();
  const itemId = Number(itemIdParam);
  const legacyDate = cleanDateParam(searchParams.get('date'));
  const selectedDateFrom = cleanDateParam(searchParams.get('from')) || legacyDate;
  const selectedDateTo = cleanDateParam(searchParams.get('to')) || legacyDate;
  const locationFilter = parseDemandLocationFilter(searchParams.get('warehouse'));
  const activeRangeLabel = formatDateRangeLabel(selectedDateFrom, selectedDateTo);
  const activeLocationLabel = demandLocationFilterLabel(locationFilter);
  const hasDateRange = Boolean(selectedDateFrom || selectedDateTo);

  const { data: rawLines = [], isLoading, error } = useOpenPoDemandLines({ brandKeys });

  const skuLines = useMemo(() => {
    return rawLines.filter((row) => {
      const order = normalizeEmbeddedOrder(row.orders);
      if (!order || !OPEN_PO_WORKFLOW_STATUSES.has(order.workflow_status)) return false;
      if (!Number.isInteger(itemId) || row.item_id !== itemId) return false;
      if (brandKeys?.length && !matchesPartnerBrand(row, brandKeys)) return false;
      if (!matchesDemandLocationFilter(resolveDemandLineLocation(row), locationFilter)) return false;
      if (!selectedDateFrom && !selectedDateTo) return true;
      if (!order.created_at) return false;
      const orderDate = localDateKey(order.created_at);
      if (selectedDateFrom && orderDate < selectedDateFrom) return false;
      if (selectedDateTo && orderDate > selectedDateTo) return false;
      return true;
    });
  }, [rawLines, itemId, brandKeys, locationFilter, selectedDateFrom, selectedDateTo]);

  const summary = useMemo(() => {
    const orderIds = new Set<number>();
    const customers = new Set<string>();
    let totalPo = 0;
    let totalValue = 0;
    let oldestCreatedAt: string | null = null;

    for (const line of skuLines) {
      totalPo += line.qty_po;
      totalValue += linePoValue(line);
      orderIds.add(line.order_id);
      const order = normalizeEmbeddedOrder(line.orders);
      if (order?.customer_name) customers.add(order.customer_name);
      if (order?.created_at && (!oldestCreatedAt || order.created_at < oldestCreatedAt)) {
        oldestCreatedAt = order.created_at;
      }
    }

    return {
      totalPo,
      totalValue,
      orderCount: orderIds.size,
      customerCount: customers.size,
      oldestCreatedAt,
    };
  }, [skuLines]);

  const itemName = skuLines[0]?.item_name ?? 'SKU';
  const itemCodes = skuLines[0] ? normalizeEmbeddedItem(skuLines[0].items) : null;
  const brandLabel = skuLines[0] ? groupLabel(skuLines[0]) : null;

  const backToSummary = () => navigate(backPath);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 pb-10 pt-4 lg:px-6">
        <button
          type="button"
          onClick={backToSummary}
          className="inline-flex items-center gap-2 rounded-xl bg-[var(--bg-secondary)] px-3 py-2 text-sm font-semibold text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
        >
          <ArrowLeftIcon size={18} weight="bold" />
          Back
        </button>
        <p className="mt-4 text-sm text-[var(--content-negative)]">That SKU link is invalid.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pb-10 pt-4 lg:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={backToSummary}
          className="rounded-xl bg-[var(--bg-secondary)] p-2 text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
          aria-label="Back"
        >
          <ArrowLeftIcon size={22} weight="bold" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-[var(--content-primary)]">Pending order lines for SKU</h1>
          <p className="text-sm text-[var(--content-tertiary)]">
            {mode === 'partner'
              ? 'Customer and order detail for this item.'
              : 'Open every contributing line behind this purchase total.'}
          </p>
        </div>
      </div>

      <section className="mt-4 rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            {(itemCodes?.alias1 || itemCodes?.alias) && (
              <div className="mb-2 flex max-w-full flex-wrap gap-1.5">
                {itemCodes.alias1 && <AliasChip label="Alias 1" value={itemCodes.alias1} tone="primary" />}
                {itemCodes.alias && <AliasChip label="Alias" value={itemCodes.alias} />}
              </div>
            )}
            <p className="text-lg font-semibold text-[var(--content-primary)]">{itemName}</p>
            <p className="mt-2 text-sm text-[var(--content-tertiary)]">
              {brandLabel ?? 'Item detail'}
              {` · ${activeRangeLabel}`}
              {locationFilter !== 'all' ? ` · ${activeLocationLabel}` : ''}
            </p>
          </div>
          {summary.oldestCreatedAt && <AgePill createdAt={summary.oldestCreatedAt} />}
        </div>

        <div className="mt-4 rounded-2xl border border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] px-4 py-3 text-sm text-[var(--content-accent)]">
          Verified from <span className="font-semibold">{countLabel(skuLines.length, 'live order line')}</span> across{' '}
          <span className="font-semibold">{countLabel(summary.orderCount, 'order')}</span>.
        </div>

        <div className={`mt-4 grid gap-3 sm:grid-cols-2 ${mode === 'admin' ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
          <MetricCard
            label="Qty To Buy"
            value={formatNumber(summary.totalPo)}
            hint={mode === 'admin' ? 'This should match the summary row' : 'Total pending qty'}
          />
          <MetricCard label="Order Lines" value={formatNumber(skuLines.length)} hint="Contributing lines" />
          <MetricCard label="Customers" value={formatNumber(summary.customerCount)} hint="Distinct customers" />
          {mode === 'admin' && (
            <MetricCard
              label="Value"
              value={formatCurrency(summary.totalValue)}
              hint="Estimated buy value for these lines"
            />
          )}
        </div>
      </section>

      <section className="mt-4">
        {isLoading ? (
          <p className="text-sm text-[var(--content-tertiary)]">Loading matching order lines...</p>
        ) : error ? (
          <p className="text-sm text-[var(--content-negative)]">Could not load order lines for this SKU.</p>
        ) : skuLines.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border-subtle)] p-5 text-sm text-[var(--content-tertiary)]">
            No live pending order lines matched this SKU{hasDateRange ? ` for ${activeRangeLabel}` : ''}.
          </div>
        ) : (
          <ul className="space-y-3">
            {skuLines.map((line) => {
              const order = normalizeEmbeddedOrder(line.orders);
              const poValue = linePoValue(line);
              return (
                <li
                  key={line.id}
                  className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-xs text-[var(--content-tertiary)]">
                          {order?.order_number ?? 'Order unavailable'}
                        </p>
                        {mode === 'admin' && (
                          <span className="rounded-full bg-[var(--bg-primary)] px-2 py-0.5 text-xs text-[var(--content-secondary)]">
                            Line #{line.id}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-base font-semibold text-[var(--content-primary)]">
                        {order?.customer_name ?? 'Unknown customer'}
                      </p>
                    </div>
                    {order?.created_at && <AgePill createdAt={order.created_at} />}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-sm text-[var(--content-secondary)]">
                    <span>
                      Qty to buy{' '}
                      <span className="font-mono font-bold text-[var(--content-warning)]">
                        {formatNumber(line.qty_po)}
                      </span>
                    </span>
                    <span>Requested {formatNumber(line.qty_requested)}</span>
                    <span>Shippable {formatNumber(line.qty_shippable)}</span>
                    {mode === 'admin' && <span>{formatCurrency(poValue)}</span>}
                    {mode === 'admin' && (
                      <span className="rounded-md bg-[var(--bg-primary)] px-2 py-0.5">{groupLabel(line)}</span>
                    )}
                    {line.loss_source && (
                      <span className="rounded-md bg-[var(--bg-warning-subtle)] px-2 py-0.5 text-[var(--content-warning)]">
                        {pendingSourceLabel(line.loss_source)} loss
                      </span>
                    )}
                    <span className="rounded-md bg-[var(--bg-primary)] px-2 py-0.5">
                      {demandLocationLabel(line.stock_location_code ?? order?.stock_location_code)}
                    </span>
                    {mode === 'admin' && order?.salesperson_name && (
                      <span className="inline-flex items-center gap-1">
                        <UserIcon size={11} />
                        {order.salesperson_name}
                      </span>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--content-quaternary)]">
                    <span className="inline-flex items-center gap-1">
                      <ListBulletsIcon size={12} />
                      {order?.workflow_status ?? 'unknown'}
                    </span>
                    {order?.created_at && (
                      <span>
                        {formatShortDate(order.created_at)} · {formatTimeAgo(order.created_at)}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
