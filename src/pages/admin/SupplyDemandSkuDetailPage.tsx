import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeftIcon, ListBulletsIcon, UserIcon } from '@phosphor-icons/react';
import {
  OPEN_PO_WORKFLOW_STATUSES,
  normalizeEmbeddedItem,
  normalizeEmbeddedOrder,
  useOpenPoDemandLines,
  type OpenPoDemandLine,
} from '../../hooks/useOpenPoDemandLines';
import { formatCurrency, formatShortDate, formatTimeAgo } from '../../utils/formatters';

function ageDays(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
}

type AgeBand = {
  label: string;
  pillClass: string;
};

function getAgeBand(createdAt: string): AgeBand {
  const days = ageDays(createdAt);
  if (days < 7) {
    return {
      label: `${days}d`,
      pillClass:
        'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border border-[color-mix(in_srgb,var(--content-positive)_20%,transparent)]',
    };
  }
  if (days < 14) {
    return {
      label: `${days}d`,
      pillClass:
        'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] border border-[color-mix(in_srgb,var(--content-warning)_20%,transparent)]',
    };
  }
  return {
    label: `${days}d`,
    pillClass:
      'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] border border-[color-mix(in_srgb,var(--content-negative)_20%,transparent)]',
  };
}

function AgePill({ createdAt }: { createdAt: string }) {
  const band = getAgeBand(createdAt);
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-ds-micro font-bold tabular-nums ${band.pillClass}`}>
      {band.label}
    </span>
  );
}

function groupLabel(line: OpenPoDemandLine): string {
  const item = normalizeEmbeddedItem(line.items);
  const main = item?.main_group?.trim();
  if (main) return main;
  const parent = item?.parent_group?.trim();
  if (parent) return parent;
  return 'Ungrouped';
}

function linePoValue(line: OpenPoDemandLine): number {
  return line.qty_po * (line.price_quoted ?? line.price_system ?? 0);
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-IN');
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

function localDateKey(value: string): string {
  const d = new Date(value);
  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function cleanDateParam(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function formatDateRangeLabel(from: string, to: string): string {
  if (from && to && from === to) return formatShortDate(from);
  if (from && to) return `${formatShortDate(from)} - ${formatShortDate(to)}`;
  if (from) return `From ${formatShortDate(from)}`;
  if (to) return `Until ${formatShortDate(to)}`;
  return 'All active pending orders';
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--content-tertiary)]">{label}</p>
      <p className="mt-2 text-[clamp(1.5rem,2.2vw,1.85rem)] font-bold leading-tight text-[var(--content-primary)] tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-[var(--content-secondary)]">{hint}</p>
    </div>
  );
}

function AliasChip({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'primary' | 'neutral';
}) {
  const toneClass =
    tone === 'primary'
      ? {
          shell: 'border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)]',
          label: 'border-[color-mix(in_srgb,var(--bg-accent)_35%,transparent)] text-[var(--content-accent)]',
          value: 'text-[var(--content-primary)]',
        }
      : {
          shell: 'border-[var(--border-subtle)] bg-[var(--bg-primary)]',
          label: 'border-[var(--border-subtle)] text-[var(--content-tertiary)]',
          value: 'text-[var(--content-secondary)]',
        };

  return (
    <span className={`inline-flex min-w-0 max-w-full items-stretch overflow-hidden rounded-lg border text-[11px] leading-none ${toneClass.shell}`}>
      <span className={`shrink-0 border-r px-1.5 py-1 font-sans font-bold uppercase tracking-[0.08em] ${toneClass.label}`}>
        {label}
      </span>
      <span className={`min-w-0 truncate px-2 py-1 font-mono font-semibold ${toneClass.value}`}>{value}</span>
    </span>
  );
}

export default function SupplyDemandSkuDetailPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { itemId: itemIdParam } = useParams();
  const [searchParams] = useSearchParams();
  const itemId = Number(itemIdParam);
  const legacyDate = cleanDateParam(searchParams.get('date'));
  const selectedDateFrom = cleanDateParam(searchParams.get('from')) || legacyDate;
  const selectedDateTo = cleanDateParam(searchParams.get('to')) || legacyDate;
  const activeRangeLabel = formatDateRangeLabel(selectedDateFrom, selectedDateTo);
  const hasDateRange = Boolean(selectedDateFrom || selectedDateTo);
  const fromTab = searchParams.get('fromTab') === 'sku' ? 'sku' : 'brand';

  const { data: rawLines = [], isLoading, error } = useOpenPoDemandLines();

  const openLines = useMemo(
    () =>
      rawLines.filter((row) => {
        const order = normalizeEmbeddedOrder(row.orders);
        return order && OPEN_PO_WORKFLOW_STATUSES.has(order.workflow_status);
      }),
    [rawLines],
  );

  const skuLines = useMemo(
    () =>
      openLines.filter((row) => {
        if (!Number.isInteger(itemId) || row.item_id !== itemId) return false;
        if (!selectedDateFrom && !selectedDateTo) return true;
        const order = normalizeEmbeddedOrder(row.orders);
        if (!order?.created_at) return false;
        const orderDate = localDateKey(order.created_at);
        if (selectedDateFrom && orderDate < selectedDateFrom) return false;
        if (selectedDateTo && orderDate > selectedDateTo) return false;
        return true;
      }),
    [itemId, openLines, selectedDateFrom, selectedDateTo],
  );

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

  const backToSummary = () => {
    const next = new URLSearchParams();
    next.set('tab', fromTab);
    if (selectedDateFrom) next.set('from', selectedDateFrom);
    if (selectedDateTo) next.set('to', selectedDateTo);
    navigate(`/admin/supply?${next.toString()}`);
  };

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return (
      <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
        <div className="mx-auto max-w-5xl px-4 pb-10 pt-4 lg:px-6">
          <button
            type="button"
            onClick={backToSummary}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--bg-secondary)] px-3 py-2 text-sm font-semibold text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
          >
            <ArrowLeftIcon size={18} weight="bold" />
            Back to supply summary
          </button>
          <p className="mt-4 text-sm text-[var(--content-negative)]">That SKU link is invalid.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
      <div className="mx-auto max-w-5xl px-4 pb-10 pt-4 lg:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={backToSummary}
            className="rounded-xl bg-[var(--bg-secondary)] p-2 text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
            aria-label="Back to supply summary"
          >
            <ArrowLeftIcon size={22} weight="bold" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold text-[var(--content-primary)]">Pending order lines for SKU</h1>
            <p className="text-sm text-[var(--content-tertiary)]">Open every contributing line behind this purchase total so you can verify the number with confidence.</p>
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
              </p>
            </div>
            {summary.oldestCreatedAt && <AgePill createdAt={summary.oldestCreatedAt} />}
          </div>

          <div className="mt-4 rounded-2xl border border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] px-4 py-3 text-sm text-[var(--content-accent)]">
            Verified from <span className="font-semibold">{countLabel(skuLines.length, 'live order line')}</span> across{' '}
            <span className="font-semibold">{countLabel(summary.orderCount, 'order')}</span>.
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Qty To Buy" value={formatNumber(summary.totalPo)} hint="This should match the summary row" />
            <MetricCard label="Order Lines" value={formatNumber(skuLines.length)} hint="All contributing lines for this SKU" />
            <MetricCard label="Customers" value={formatNumber(summary.customerCount)} hint="Distinct customers in these lines" />
            <MetricCard label="Value" value={formatCurrency(summary.totalValue)} hint="Estimated buy value for these lines" />
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
                          <span className="rounded-full bg-[var(--bg-primary)] px-2 py-0.5 text-xs text-[var(--content-secondary)]">
                            Line #{line.id}
                          </span>
                        </div>
                        <p className="mt-1 text-base font-semibold text-[var(--content-primary)]">
                          {order?.customer_name ?? 'Unknown customer'}
                        </p>
                      </div>
                      {order?.created_at && <AgePill createdAt={order.created_at} />}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-sm text-[var(--content-secondary)]">
                      <span>
                        Qty to buy <span className="font-mono font-bold text-[var(--content-warning)]">{formatNumber(line.qty_po)}</span>
                      </span>
                      <span>Requested {formatNumber(line.qty_requested)}</span>
                      <span>Shippable {formatNumber(line.qty_shippable)}</span>
                      <span>{formatCurrency(poValue)}</span>
                      <span className="rounded-md bg-[var(--bg-primary)] px-2 py-0.5">{groupLabel(line)}</span>
                      {order?.salesperson_name && (
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
    </div>
  );
}
