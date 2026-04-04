import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  PackageIcon,
  SquaresFourIcon,
  TagIcon,
  ListBulletsIcon,
  HourglassHighIcon,
  CurrencyInrIcon,
  UserIcon,
} from '@phosphor-icons/react';
import { usePendingItems } from '../../hooks/usePendingItems';
import {
  useOpenPoDemandLines,
  OPEN_PO_WORKFLOW_STATUSES,
  normalizeEmbeddedOrder,
  normalizeEmbeddedItem,
  type OpenPoDemandLine,
} from '../../hooks/useOpenPoDemandLines';
import { formatCurrency, formatShortDate, formatTimeAgo } from '../../utils/formatters';
import type { PendingItem } from '../../types';

type TabId = 'sku' | 'brand' | 'lines' | 'pending';

// ── Age helpers ──────────────────────────────────────────────────────────────

function ageDays(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
}

type AgeBand = {
  days: number;
  label: string;
  pillClass: string;
};

function getAgeBand(createdAt: string): AgeBand {
  const days = ageDays(createdAt);
  if (days < 7)
    return {
      days,
      label: `${days}d`,
      pillClass:
        'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border border-[color-mix(in_srgb,var(--content-positive)_20%,transparent)]',
    };
  if (days < 14)
    return {
      days,
      label: `${days}d`,
      pillClass:
        'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] border border-[color-mix(in_srgb,var(--content-warning)_20%,transparent)]',
    };
  return {
    days,
    label: `${days}d`,
    pillClass:
      'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] border border-[color-mix(in_srgb,var(--content-negative)_20%,transparent)]',
  };
}

function AgePill({ createdAt }: { createdAt: string }) {
  const band = getAgeBand(createdAt);
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${band.pillClass}`}>
      {band.label}
    </span>
  );
}

// ── Grouping helpers ─────────────────────────────────────────────────────────

function groupLabel(line: OpenPoDemandLine): string {
  const it = normalizeEmbeddedItem(line.items);
  const g = it?.main_group?.trim();
  if (g) return g;
  const p = it?.parent_group?.trim();
  if (p) return p;
  return '— Ungrouped';
}

function linePoValue(line: OpenPoDemandLine): number {
  return line.qty_po * (line.price_quoted ?? 0);
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SupplyDemandPage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabId>('sku');
  const [repFilter, setRepFilter] = useState<string | null>(null);

  const { data: rawLines = [], isLoading: linesLoading, error: linesError } = useOpenPoDemandLines();
  const { data: pendingItems = [], isLoading: pendingLoading } = usePendingItems({ status: 'pending' });

  const openLines = useMemo(() => {
    return rawLines.filter((row) => {
      const o = normalizeEmbeddedOrder(row.orders);
      return o && OPEN_PO_WORKFLOW_STATUSES.has(o.workflow_status);
    });
  }, [rawLines]);

  // SKU aggregation — adds totalValue + oldestCreatedAt
  const bySku = useMemo(() => {
    const m = new Map<
      number,
      {
        item_id: number;
        item_name: string;
        totalPo: number;
        totalValue: number;
        lineCount: number;
        customers: Set<string>;
        oldestCreatedAt: string | null;
      }
    >();
    for (const row of openLines) {
      const o = normalizeEmbeddedOrder(row.orders);
      const prev = m.get(row.item_id) ?? {
        item_id: row.item_id,
        item_name: row.item_name,
        totalPo: 0,
        totalValue: 0,
        lineCount: 0,
        customers: new Set<string>(),
        oldestCreatedAt: null,
      };
      prev.totalPo += row.qty_po;
      prev.totalValue += linePoValue(row);
      prev.lineCount += 1;
      if (o?.customer_name) prev.customers.add(o.customer_name);
      if (o?.created_at) {
        if (!prev.oldestCreatedAt || o.created_at < prev.oldestCreatedAt)
          prev.oldestCreatedAt = o.created_at;
      }
      m.set(row.item_id, prev);
    }
    return [...m.values()].sort((a, b) => b.totalPo - a.totalPo);
  }, [openLines]);

  // Brand aggregation — adds totalValue + oldestCreatedAt
  const byBrand = useMemo(() => {
    const m = new Map<
      string,
      { label: string; totalPo: number; totalValue: number; lineCount: number; skuCount: Set<number>; oldestCreatedAt: string | null }
    >();
    for (const row of openLines) {
      const o = normalizeEmbeddedOrder(row.orders);
      const label = groupLabel(row);
      const prev = m.get(label) ?? {
        label,
        totalPo: 0,
        totalValue: 0,
        lineCount: 0,
        skuCount: new Set<number>(),
        oldestCreatedAt: null,
      };
      prev.totalPo += row.qty_po;
      prev.totalValue += linePoValue(row);
      prev.lineCount += 1;
      prev.skuCount.add(row.item_id);
      if (o?.created_at) {
        if (!prev.oldestCreatedAt || o.created_at < prev.oldestCreatedAt)
          prev.oldestCreatedAt = o.created_at;
      }
      m.set(label, prev);
    }
    return [...m.values()]
      .map((r) => ({ ...r, distinctSkus: r.skuCount.size }))
      .sort((a, b) => b.totalPo - a.totalPo);
  }, [openLines]);

  // Summary totals
  const totals = useMemo(() => {
    let poPieces = 0;
    let totalValue = 0;
    for (const row of openLines) {
      poPieces += row.qty_po;
      totalValue += linePoValue(row);
    }
    return { lineCount: openLines.length, poPieces, skuCount: bySku.length, totalValue };
  }, [openLines, bySku.length]);

  // Unique reps for Lines tab filter
  const allReps = useMemo(() => {
    const names = new Set<string>();
    for (const row of openLines) {
      const o = normalizeEmbeddedOrder(row.orders);
      if (o?.salesperson_name) names.add(o.salesperson_name);
    }
    return [...names].sort();
  }, [openLines]);

  const filteredLines = useMemo(() => {
    if (!repFilter) return openLines;
    return openLines.filter((row) => {
      const o = normalizeEmbeddedOrder(row.orders);
      return o?.salesperson_name === repFilter;
    });
  }, [openLines, repFilter]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['open-po-demand-lines'] });
    queryClient.invalidateQueries({ queryKey: ['pending-items'] });
  };

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
      <div className="p-4 lg:px-6 max-w-3xl mx-auto pb-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <button
            type="button"
            onClick={() => navigate('/admin')}
            className="p-2 rounded-xl bg-[var(--bg-secondary)] text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
            aria-label="Back"
          >
            <ArrowLeftIcon size={22} weight="bold" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-[var(--content-primary)] truncate">Supply cockpit</h1>
            <p className="text-xs text-[var(--content-tertiary)]">PO demand & pending queue</p>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="p-2 rounded-xl bg-[var(--bg-secondary)] text-[var(--content-secondary)] hover:text-[var(--content-primary)]"
            aria-label="Refresh"
          >
            <ArrowsClockwiseIcon size={22} weight="bold" />
          </button>
        </div>

        {/* Summary metrics */}
        <div className="flex flex-wrap gap-2 mt-4">
          <div className="inline-flex items-center gap-2 h-9 px-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-opaque)] text-sm">
            <PackageIcon size={16} className="text-[var(--content-tertiary)]" />
            <span className="font-mono font-semibold">{totals.poPieces}</span>
            <span className="text-[var(--content-tertiary)]">PO pcs</span>
          </div>
          <div className="inline-flex items-center gap-2 h-9 px-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-opaque)] text-sm">
            <span className="font-mono font-semibold">{totals.lineCount}</span>
            <span className="text-[var(--content-tertiary)]">lines</span>
          </div>
          <div className="inline-flex items-center gap-2 h-9 px-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-opaque)] text-sm">
            <span className="font-mono font-semibold">{totals.skuCount}</span>
            <span className="text-[var(--content-tertiary)]">SKUs</span>
          </div>
          {totals.totalValue > 0 && (
            <div className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-[var(--bg-accent-subtle)] border border-[var(--bg-accent)] text-sm">
              <CurrencyInrIcon size={14} className="text-[var(--content-accent)]" />
              <span className="font-mono font-semibold text-[var(--content-accent)]">
                {formatCurrency(totals.totalValue)}
              </span>
              <span className="text-[var(--content-accent)] opacity-70">at risk</span>
            </div>
          )}
          <div className="inline-flex items-center gap-2 h-9 px-3 rounded-xl bg-[var(--bg-warning-subtle)] border border-[color-mix(in_srgb,var(--border-warning)_35%,var(--border-subtle))] text-sm">
            <HourglassHighIcon size={16} className="text-[var(--content-warning)]" />
            <span className="font-mono font-semibold">{pendingItems.length}</span>
            <span className="text-[var(--content-warning)]">pending</span>
          </div>
        </div>

        {/* Age legend */}
        <div className="mt-3 flex items-center gap-2 text-[10px] text-[var(--content-quaternary)]">
          <span>Age:</span>
          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border border-[color-mix(in_srgb,var(--content-positive)_20%,transparent)] font-bold">
            &lt;7d fresh
          </span>
          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] border border-[color-mix(in_srgb,var(--content-warning)_20%,transparent)] font-bold">
            7–14d warm
          </span>
          <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 bg-[var(--bg-negative-subtle)] text-[var(--content-negative)] border border-[color-mix(in_srgb,var(--content-negative)_20%,transparent)] font-bold">
            14d+ stale
          </span>
        </div>

        {/* Tabs */}
        <div className="mt-4 flex flex-wrap gap-1 p-1 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)]">
          {(
            [
              ['sku', 'By SKU', SquaresFourIcon],
              ['brand', 'By brand', TagIcon],
              ['lines', 'Open lines', ListBulletsIcon],
              ['pending', 'Pending', HourglassHighIcon],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex-1 min-w-[6.5rem] flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs font-semibold transition-colors ${
                tab === id
                  ? 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] border border-[var(--bg-accent)]'
                  : 'text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              <Icon size={16} weight={tab === id ? 'fill' : 'regular'} />
              {label}
            </button>
          ))}
        </div>

        <div className="mt-6 space-y-3">
          {tab === 'sku' && <SkuTab rows={bySku} loading={linesLoading} error={linesError} />}
          {tab === 'brand' && <BrandTab rows={byBrand} loading={linesLoading} error={linesError} />}
          {tab === 'lines' && (
            <LinesTab
              lines={filteredLines}
              allLines={openLines}
              allReps={allReps}
              repFilter={repFilter}
              onRepFilter={setRepFilter}
              loading={linesLoading}
              error={linesError}
            />
          )}
          {tab === 'pending' && <PendingTab items={pendingItems} loading={pendingLoading} />}
        </div>
      </div>
    </div>
  );
}

// ── SKU tab ───────────────────────────────────────────────────────────────────

function SkuTab({
  rows,
  loading,
  error,
}: {
  rows: {
    item_id: number;
    item_name: string;
    totalPo: number;
    totalValue: number;
    lineCount: number;
    customers: Set<string>;
    oldestCreatedAt: string | null;
  }[];
  loading: boolean;
  error: Error | null;
}) {
  if (loading) return <p className="text-sm text-[var(--content-tertiary)]">Loading…</p>;
  if (error) return <p className="text-sm text-[var(--content-negative)]">Could not load PO lines</p>;
  if (rows.length === 0)
    return <p className="text-sm text-[var(--content-tertiary)]">No open PO demand on active orders.</p>;

  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li
          key={r.item_id}
          className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-[var(--content-primary)] text-sm line-clamp-2 flex-1">{r.item_name}</p>
            {r.oldestCreatedAt && <AgePill createdAt={r.oldestCreatedAt} />}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--content-secondary)]">
            <span>
              PO qty:{' '}
              <span className="font-mono font-bold text-[var(--content-primary)]">{r.totalPo}</span>
            </span>
            {r.totalValue > 0 && (
              <span>
                Value:{' '}
                <span className="font-mono font-semibold text-[var(--content-accent)]">
                  {formatCurrency(r.totalValue)}
                </span>
              </span>
            )}
            <span>
              {r.lineCount} order line{r.lineCount === 1 ? '' : 's'}
            </span>
            <span>
              {r.customers.size} customer{r.customers.size === 1 ? '' : 's'}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Brand tab ─────────────────────────────────────────────────────────────────

function BrandTab({
  rows,
  loading,
  error,
}: {
  rows: {
    label: string;
    totalPo: number;
    totalValue: number;
    lineCount: number;
    distinctSkus: number;
    oldestCreatedAt: string | null;
  }[];
  loading: boolean;
  error: Error | null;
}) {
  if (loading) return <p className="text-sm text-[var(--content-tertiary)]">Loading…</p>;
  if (error) return <p className="text-sm text-[var(--content-negative)]">Could not load PO lines</p>;
  if (rows.length === 0)
    return <p className="text-sm text-[var(--content-tertiary)]">No open PO demand on active orders.</p>;

  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li
          key={r.label}
          className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-[var(--content-primary)] text-sm">{r.label}</p>
            {r.oldestCreatedAt && <AgePill createdAt={r.oldestCreatedAt} />}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--content-secondary)]">
            <span>
              PO qty:{' '}
              <span className="font-mono font-bold text-[var(--content-primary)]">{r.totalPo}</span>
            </span>
            {r.totalValue > 0 && (
              <span>
                Value:{' '}
                <span className="font-mono font-semibold text-[var(--content-accent)]">
                  {formatCurrency(r.totalValue)}
                </span>
              </span>
            )}
            <span>
              {r.distinctSkus} SKU{r.distinctSkus === 1 ? '' : 's'}
            </span>
            <span>
              {r.lineCount} line{r.lineCount === 1 ? '' : 's'}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Lines tab ─────────────────────────────────────────────────────────────────

function LinesTab({
  lines,
  allLines,
  allReps,
  repFilter,
  onRepFilter,
  loading,
  error,
}: {
  lines: OpenPoDemandLine[];
  allLines: OpenPoDemandLine[];
  allReps: string[];
  repFilter: string | null;
  onRepFilter: (rep: string | null) => void;
  loading: boolean;
  error: Error | null;
}) {
  if (loading) return <p className="text-sm text-[var(--content-tertiary)]">Loading…</p>;
  if (error) return <p className="text-sm text-[var(--content-negative)]">Could not load PO lines</p>;
  if (allLines.length === 0)
    return <p className="text-sm text-[var(--content-tertiary)]">No open PO demand on active orders.</p>;

  return (
    <div className="space-y-3">
      {/* Salesperson filter chips */}
      {allReps.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onRepFilter(null)}
            className={`flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-semibold transition-colors ${
              repFilter === null
                ? 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] border border-[var(--bg-accent)]'
                : 'bg-[var(--bg-secondary)] text-[var(--content-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)]'
            }`}
          >
            All reps
          </button>
          {allReps.map((rep) => (
            <button
              key={rep}
              type="button"
              onClick={() => onRepFilter(rep === repFilter ? null : rep)}
              className={`flex items-center gap-1 h-7 px-2.5 rounded-lg text-xs font-semibold transition-colors ${
                repFilter === rep
                  ? 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] border border-[var(--bg-accent)]'
                  : 'bg-[var(--bg-secondary)] text-[var(--content-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)]'
              }`}
            >
              <UserIcon size={11} />
              {rep}
            </button>
          ))}
        </div>
      )}

      {lines.length === 0 ? (
        <p className="text-sm text-[var(--content-tertiary)]">No lines for this rep.</p>
      ) : (
        <ul className="space-y-2">
          {lines.map((row) => {
            const o = normalizeEmbeddedOrder(row.orders);
            const poValue = linePoValue(row);
            return (
              <li
                key={row.id}
                className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-sm text-[var(--content-primary)] line-clamp-2 flex-1">
                    {row.item_name}
                  </p>
                  {o?.created_at && <AgePill createdAt={o.created_at} />}
                </div>
                <p className="text-xs text-[var(--content-tertiary)] mt-1 font-mono">
                  {o?.order_number ?? '—'} · {o?.customer_name ?? '—'}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--content-secondary)]">
                  <span>
                    PO{' '}
                    <span className="font-mono font-bold text-[var(--content-warning)]">{row.qty_po}</span>
                  </span>
                  {poValue > 0 && (
                    <span>
                      <span className="font-mono font-semibold text-[var(--content-accent)]">
                        {formatCurrency(poValue)}
                      </span>
                    </span>
                  )}
                  <span>
                    Ship <span className="font-mono">{row.qty_shippable}</span>
                  </span>
                  <span className="rounded-md bg-[var(--bg-tertiary)] px-2 py-0.5">{o?.workflow_status}</span>
                  {o?.salesperson_name && (
                    <span className="flex items-center gap-1">
                      <UserIcon size={10} />
                      {o.salesperson_name}
                    </span>
                  )}
                </div>
                {o?.created_at && (
                  <p className="text-[10px] text-[var(--content-quaternary)] mt-2">
                    {formatShortDate(o.created_at)} · {formatTimeAgo(o.created_at)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Pending tab ───────────────────────────────────────────────────────────────

function pendingSourceLabel(source: PendingItem['source']): string {
  if (source === 'billing') return 'Billing';
  if (source === 'picking') return 'Picking';
  return 'Sales (PO)';
}

function PendingTab({ items, loading }: { items: PendingItem[]; loading: boolean }) {
  if (loading) return <p className="text-sm text-[var(--content-tertiary)]">Loading…</p>;
  if (items.length === 0)
    return <p className="text-sm text-[var(--content-tertiary)]">No pending items.</p>;

  return (
    <ul className="space-y-2">
      {items.map((pi) => (
        <li
          key={pi.id}
          className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-sm text-[var(--content-primary)]">{pi.customer_name}</p>
            <AgePill createdAt={pi.created_at} />
          </div>
          <p className="text-xs text-[var(--content-tertiary)] font-mono mt-0.5">{pi.order_number}</p>
          <p className="text-sm text-[var(--content-secondary)] mt-2 line-clamp-2">{pi.item_name}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="text-[var(--content-secondary)]">
              Qty <span className="font-mono font-bold">{pi.qty_pending}</span>
            </span>
            <span className="rounded-md bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] px-2 py-0.5 font-semibold">
              {pendingSourceLabel(pi.source)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
