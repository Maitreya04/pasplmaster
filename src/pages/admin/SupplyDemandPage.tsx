import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  Check,
  Copy,
  HourglassHighIcon,
  ListBulletsIcon,
  SquaresFourIcon,
  TagIcon,
  UserIcon,
  WarningCircle,
} from '@phosphor-icons/react';
import { usePendingItems } from '../../hooks/usePendingItems';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { useToast } from '../../context/ToastContext';
import {
  useOpenPoDemandLines,
  OPEN_PO_WORKFLOW_STATUSES,
  normalizeEmbeddedOrder,
  normalizeEmbeddedItem,
  type OpenPoDemandLine,
} from '../../hooks/useOpenPoDemandLines';
import { formatCurrency, formatShortDate, formatTimeAgo } from '../../utils/formatters';
import type { PendingItem } from '../../types';

type TabId = 'brand' | 'sku' | 'lines' | 'pending';

type BrandSkuRow = {
  item_id: number;
  item_name: string;
  item_alias: string | null;
  item_alias1: string | null;
  totalPo: number;
  totalValue: number;
  lineCount: number;
  customerCount: number;
  oldestCreatedAt: string | null;
};

type BrandSummary = {
  label: string;
  totalPo: number;
  totalValue: number;
  lineCount: number;
  distinctSkus: number;
  customerCount: number;
  staleQty: number;
  staleLines: number;
  oldestCreatedAt: string | null;
  skuRows: BrandSkuRow[];
};

type SkuSummary = {
  item_id: number;
  item_name: string;
  item_alias: string | null;
  item_alias1: string | null;
  brandLabel: string;
  totalPo: number;
  totalValue: number;
  lineCount: number;
  customerCount: number;
  oldestCreatedAt: string | null;
};

type PendingDayRow = {
  dateKey: string;
  itemCount: number;
  qtyPending: number;
};

function isTabId(value: string | null): value is TabId {
  return value === 'brand' || value === 'sku' || value === 'lines' || value === 'pending';
}

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
  if (days < 7) {
    return {
      days,
      label: `${days}d`,
      pillClass:
        'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)] border border-[color-mix(in_srgb,var(--content-positive)_20%,transparent)]',
    };
  }
  if (days < 14) {
    return {
      days,
      label: `${days}d`,
      pillClass:
        'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)] border border-[color-mix(in_srgb,var(--content-warning)_20%,transparent)]',
    };
  }
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
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-ds-micro font-bold tabular-nums ${band.pillClass}`}>
      {band.label}
    </span>
  );
}

function groupLabel(line: OpenPoDemandLine): string {
  const it = normalizeEmbeddedItem(line.items);
  const g = it?.main_group?.trim();
  if (g) return g;
  const p = it?.parent_group?.trim();
  if (p) return p;
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
  return dateKeyFromDate(d);
}

function dateKeyFromDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return dateKeyFromDate(d);
}

function monthStart(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
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

function isToday(value: string): boolean {
  return localDateKey(value) === localDateKey(new Date().toISOString());
}

function toTabSeparated(rows: Array<Array<string | number>>): string {
  return rows.map((row) => row.join('\t')).join('\n');
}

function buildAllBrandCopy(rows: BrandSummary[]): string {
  return toTabSeparated([
    ['Brand', 'Description', 'Alias 1', 'Alias', 'Qty'],
    ...rows.flatMap((brand) =>
      brand.skuRows.map((sku) => [
        brand.label,
        sku.item_name,
        sku.item_alias1 ?? '',
        sku.item_alias ?? '',
        sku.totalPo,
      ]),
    ),
  ]);
}

function buildSingleBrandCopy(brand: BrandSummary): string {
  return toTabSeparated([
    ['Description', 'Alias 1', 'Alias', 'Qty'],
    ...brand.skuRows.map((sku) => [
      sku.item_name,
      sku.item_alias1 ?? '',
      sku.item_alias ?? '',
      sku.totalPo,
    ]),
  ]);
}

function CopyButton({
  label,
  copiedLabel,
  copied,
  onClick,
  subtle = false,
}: {
  label: string;
  copiedLabel: string;
  copied: boolean;
  onClick: () => void;
  subtle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition-colors ${
        subtle
          ? 'border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]'
          : 'border border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)] hover:opacity-90'
      }`}
    >
      {copied ? <Check size={16} weight="bold" /> : <Copy size={16} weight="bold" />}
      {copied ? copiedLabel : label}
    </button>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'default' | 'accent' | 'warning' | 'danger';
}) {
  const toneClass =
    tone === 'accent'
      ? 'bg-[var(--bg-accent-subtle)] border-[var(--bg-accent)]'
      : tone === 'warning'
        ? 'bg-[var(--bg-warning-subtle)] border-[color-mix(in_srgb,var(--border-warning)_35%,var(--border-subtle))]'
        : tone === 'danger'
          ? 'bg-[var(--bg-negative-subtle)] border-[color-mix(in_srgb,var(--content-negative)_25%,var(--border-subtle))]'
          : 'bg-[var(--bg-secondary)] border-[var(--border-subtle)]';

  return (
    <div className={`min-w-0 rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--content-tertiary)]">{label}</p>
      <p className="mt-2 min-w-0 break-words text-[clamp(1.75rem,2.3vw,2rem)] font-bold leading-tight text-[var(--content-primary)] tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-[var(--content-secondary)]">{hint}</p>
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 sm:p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-[var(--content-primary)]">{title}</h2>
        <p className="mt-1 text-sm text-[var(--content-tertiary)]">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return <p className="rounded-2xl border border-dashed border-[var(--border-subtle)] p-5 text-sm text-[var(--content-tertiary)]">{text}</p>;
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

function AliasChipRow({
  alias1,
  alias,
  className = 'mt-2',
}: {
  alias1: string | null;
  alias: string | null;
  className?: string;
}) {
  if (!alias1 && !alias) return null;
  return (
    <div className={`flex max-w-full flex-wrap gap-1.5 ${className}`}>
      {alias1 && <AliasChip label="Alias 1" value={alias1} tone="primary" />}
      {alias && <AliasChip label="Alias" value={alias} />}
    </div>
  );
}

export default function SupplyDemandPage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { copy, copiedId } = useCopyToClipboard();

  const [repFilter, setRepFilter] = useState<string | null>(null);
  const tab = isTabId(searchParams.get('tab')) ? searchParams.get('tab') : 'brand';
  const legacyDate = cleanDateParam(searchParams.get('date'));
  const selectedDateFrom = cleanDateParam(searchParams.get('from')) || legacyDate;
  const selectedDateTo = cleanDateParam(searchParams.get('to')) || legacyDate;
  const activeRangeLabel = formatDateRangeLabel(selectedDateFrom, selectedDateTo);
  const hasDateRange = Boolean(selectedDateFrom || selectedDateTo);
  const [draftDateFrom, setDraftDateFrom] = useState(selectedDateFrom);
  const [draftDateTo, setDraftDateTo] = useState(selectedDateTo);
  const todayKey = useMemo(() => dateKeyFromDate(new Date()), []);
  const dateRangeInvalid = Boolean(draftDateFrom && draftDateTo && draftDateFrom > draftDateTo);

  const { data: rawLines = [], isLoading: linesLoading, error: linesError } = useOpenPoDemandLines();
  const { data: pendingItemsRaw = [], isLoading: pendingLoading } = usePendingItems({ status: 'pending' });

  useEffect(() => {
    setDraftDateFrom(selectedDateFrom);
    setDraftDateTo(selectedDateTo);
  }, [selectedDateFrom, selectedDateTo]);

  const openLines = useMemo(() => {
    return rawLines.filter((row) => {
      const o = normalizeEmbeddedOrder(row.orders);
      return o && OPEN_PO_WORKFLOW_STATUSES.has(o.workflow_status);
    });
  }, [rawLines]);

  const demandDates = useMemo(() => {
    const keys = new Set<string>();
    for (const row of openLines) {
      const order = normalizeEmbeddedOrder(row.orders);
      if (order?.created_at) keys.add(localDateKey(order.created_at));
    }
    return [...keys].sort((a, b) => b.localeCompare(a));
  }, [openLines]);

  const demandLines = useMemo(() => {
    if (!selectedDateFrom && !selectedDateTo) return openLines;
    return openLines.filter((row) => {
      const order = normalizeEmbeddedOrder(row.orders);
      if (!order?.created_at) return false;
      const orderDate = localDateKey(order.created_at);
      if (selectedDateFrom && orderDate < selectedDateFrom) return false;
      if (selectedDateTo && orderDate > selectedDateTo) return false;
      return true;
    });
  }, [openLines, selectedDateFrom, selectedDateTo]);

  const byBrand = useMemo<BrandSummary[]>(() => {
    const brandMap = new Map<
      string,
      {
        label: string;
        totalPo: number;
        totalValue: number;
        lineCount: number;
        customers: Set<string>;
        oldestCreatedAt: string | null;
        staleQty: number;
        staleLines: number;
        skuMap: Map<
          number,
          {
            item_id: number;
            item_name: string;
            item_alias: string | null;
            item_alias1: string | null;
            totalPo: number;
            totalValue: number;
            lineCount: number;
            customers: Set<string>;
            oldestCreatedAt: string | null;
          }
        >;
      }
    >();

    for (const row of demandLines) {
      const order = normalizeEmbeddedOrder(row.orders);
      const label = groupLabel(row);
      const brand = brandMap.get(label) ?? {
        label,
        totalPo: 0,
        totalValue: 0,
        lineCount: 0,
        customers: new Set<string>(),
        oldestCreatedAt: null,
        staleQty: 0,
        staleLines: 0,
        skuMap: new Map(),
      };

      brand.totalPo += row.qty_po;
      brand.totalValue += linePoValue(row);
      brand.lineCount += 1;
      if (order?.customer_name) brand.customers.add(order.customer_name);
      if (order?.created_at) {
        if (!brand.oldestCreatedAt || order.created_at < brand.oldestCreatedAt) {
          brand.oldestCreatedAt = order.created_at;
        }
        if (ageDays(order.created_at) >= 14) {
          brand.staleQty += row.qty_po;
          brand.staleLines += 1;
        }
      }

      const sku = brand.skuMap.get(row.item_id) ?? {
        item_id: row.item_id,
        item_name: row.item_name,
        item_alias: normalizeEmbeddedItem(row.items)?.alias ?? null,
        item_alias1: normalizeEmbeddedItem(row.items)?.alias1 ?? null,
        totalPo: 0,
        totalValue: 0,
        lineCount: 0,
        customers: new Set<string>(),
        oldestCreatedAt: null,
      };
      sku.totalPo += row.qty_po;
      sku.totalValue += linePoValue(row);
      sku.lineCount += 1;
      if (order?.customer_name) sku.customers.add(order.customer_name);
      if (order?.created_at) {
        if (!sku.oldestCreatedAt || order.created_at < sku.oldestCreatedAt) {
          sku.oldestCreatedAt = order.created_at;
        }
      }
      brand.skuMap.set(row.item_id, sku);
      brandMap.set(label, brand);
    }

    return [...brandMap.values()]
      .map((brand) => ({
        label: brand.label,
        totalPo: brand.totalPo,
        totalValue: brand.totalValue,
        lineCount: brand.lineCount,
        distinctSkus: brand.skuMap.size,
        customerCount: brand.customers.size,
        staleQty: brand.staleQty,
        staleLines: brand.staleLines,
        oldestCreatedAt: brand.oldestCreatedAt,
        skuRows: [...brand.skuMap.values()]
          .map((sku) => ({
            item_id: sku.item_id,
            item_name: sku.item_name,
            item_alias: sku.item_alias,
            item_alias1: sku.item_alias1,
            totalPo: sku.totalPo,
            totalValue: sku.totalValue,
            lineCount: sku.lineCount,
            customerCount: sku.customers.size,
            oldestCreatedAt: sku.oldestCreatedAt,
          }))
          .sort((a, b) => b.totalPo - a.totalPo),
      }))
      .sort((a, b) => b.totalPo - a.totalPo);
  }, [demandLines]);

  const bySku = useMemo<SkuSummary[]>(() => {
    const skuMap = new Map<
      number,
      {
        item_id: number;
        item_name: string;
        item_alias: string | null;
        item_alias1: string | null;
        brandLabel: string;
        totalPo: number;
        totalValue: number;
        lineCount: number;
        customers: Set<string>;
        oldestCreatedAt: string | null;
      }
    >();

    for (const row of demandLines) {
      const order = normalizeEmbeddedOrder(row.orders);
      const prev = skuMap.get(row.item_id) ?? {
        item_id: row.item_id,
        item_name: row.item_name,
        item_alias: normalizeEmbeddedItem(row.items)?.alias ?? null,
        item_alias1: normalizeEmbeddedItem(row.items)?.alias1 ?? null,
        brandLabel: groupLabel(row),
        totalPo: 0,
        totalValue: 0,
        lineCount: 0,
        customers: new Set<string>(),
        oldestCreatedAt: null,
      };

      prev.totalPo += row.qty_po;
      prev.totalValue += linePoValue(row);
      prev.lineCount += 1;
      if (order?.customer_name) prev.customers.add(order.customer_name);
      if (order?.created_at) {
        if (!prev.oldestCreatedAt || order.created_at < prev.oldestCreatedAt) {
          prev.oldestCreatedAt = order.created_at;
        }
      }
      skuMap.set(row.item_id, prev);
    }

    return [...skuMap.values()]
      .map((sku) => ({
        item_id: sku.item_id,
        item_name: sku.item_name,
        item_alias: sku.item_alias,
        item_alias1: sku.item_alias1,
        brandLabel: sku.brandLabel,
        totalPo: sku.totalPo,
        totalValue: sku.totalValue,
        lineCount: sku.lineCount,
        customerCount: sku.customers.size,
        oldestCreatedAt: sku.oldestCreatedAt,
      }))
      .sort((a, b) => b.totalPo - a.totalPo);
  }, [demandLines]);

  const totals = useMemo(() => {
    let poPieces = 0;
    let totalValue = 0;
    const orderIds = new Set<number>();
    const customers = new Set<string>();

    for (const row of demandLines) {
      poPieces += row.qty_po;
      totalValue += linePoValue(row);
      orderIds.add(row.order_id);
      const order = normalizeEmbeddedOrder(row.orders);
      if (order?.customer_name) customers.add(order.customer_name);
    }

    return {
      lineCount: demandLines.length,
      poPieces,
      skuCount: bySku.length,
      brandCount: byBrand.length,
      orderCount: orderIds.size,
      customerCount: customers.size,
      totalValue,
    };
  }, [demandLines, byBrand.length, bySku.length]);

  const allReps = useMemo(() => {
    const names = new Set<string>();
    for (const row of demandLines) {
      const order = normalizeEmbeddedOrder(row.orders);
      if (order?.salesperson_name) names.add(order.salesperson_name);
    }
    return [...names].sort();
  }, [demandLines]);

  const filteredLines = useMemo(() => {
    if (!repFilter) return demandLines;
    return demandLines.filter((row) => {
      const order = normalizeEmbeddedOrder(row.orders);
      return order?.salesperson_name === repFilter;
    });
  }, [demandLines, repFilter]);

  const pendingItems = useMemo(
    () => pendingItemsRaw.filter((item) => item.source !== 'sales'),
    [pendingItemsRaw],
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
    const todayQty = todayItems.reduce((sum, item) => sum + item.qty_pending, 0);
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
      todayQty,
      oldestCreatedAt,
      sources: [...sourceMap.entries()].map(([source, data]) => ({ source, ...data })),
    };
  }, [pendingItems]);

  const totalPurchaseQty = totals.poPieces;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['open-po-demand-lines'] });
    queryClient.invalidateQueries({ queryKey: ['pending-items'] });
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

  const handleCopyBrand = (brand: BrandSummary) => {
    void copyWithToast(
      buildSingleBrandCopy(brand),
      `copy-brand-${brand.label}`,
      `Copied ${brand.label} rows for Excel`,
    );
  };

  const updateSearchParams = (updates: { tab?: TabId }) => {
    const next = new URLSearchParams(searchParams);
    if (updates.tab) next.set('tab', updates.tab);
    setSearchParams(next, { replace: true });
  };

  const applyDateRange = (from: string, to: string) => {
    if (from && to && from > to) return;
    const next = new URLSearchParams(searchParams);
    next.delete('date');
    if (from) next.set('from', from);
    else next.delete('from');
    if (to) next.set('to', to);
    else next.delete('to');
    setSearchParams(next, { replace: true });
  };

  const clearDateRange = () => {
    setDraftDateFrom('');
    setDraftDateTo('');
    applyDateRange('', '');
  };

  const applyPresetRange = (from: string, to: string) => {
    setDraftDateFrom(from);
    setDraftDateTo(to);
    applyDateRange(from, to);
  };

  const openSkuDetail = (itemId: number, fromTab: 'brand' | 'sku') => {
    const next = new URLSearchParams();
    next.set('fromTab', fromTab);
    if (selectedDateFrom) next.set('from', selectedDateFrom);
    if (selectedDateTo) next.set('to', selectedDateTo);
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
            <p className="text-sm text-[var(--content-tertiary)]">Start with the total quantity to buy, then see the brand-wise split, then the item-level detail.</p>
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
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">Total Items To Purchase</p>
            <p className="mt-1 text-4xl font-bold text-[var(--content-primary)] tabular-nums sm:text-5xl">
              {formatNumber(totalPurchaseQty)}
            </p>
          </div>
          {totals.totalValue > 0 && (
            <div className="rounded-2xl border border-[color-mix(in_srgb,var(--content-positive)_30%,var(--border-subtle))] bg-[var(--bg-positive-subtle)] px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">Sales Loss</p>
              <p className="mt-1 text-4xl font-bold tabular-nums text-[var(--content-positive)] sm:text-5xl">
                {formatCurrency(totals.totalValue)}
              </p>
            </div>
          )}
        </section>

        <section className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--content-primary)]">Order date range</p>
                <p className="mt-1 text-sm text-[var(--content-tertiary)]">
                  Filter pending demand by when orders were created.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
                    hasDateRange
                      ? 'border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--content-secondary)]'
                  }`}
                >
                  {activeRangeLabel}
                </span>
                {hasDateRange && (
                  <button
                    type="button"
                    onClick={clearDateRange}
                    className="inline-flex h-8 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-xs font-semibold text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                    From
                  </span>
                  <input
                    type="date"
                    value={draftDateFrom}
                    onChange={(event) => setDraftDateFrom(event.target.value)}
                    className="h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--content-primary)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">
                    To
                  </span>
                  <input
                    type="date"
                    value={draftDateTo}
                    onChange={(event) => setDraftDateTo(event.target.value)}
                    className="h-11 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--content-primary)]"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => applyDateRange(draftDateFrom, draftDateTo)}
                disabled={dateRangeInvalid}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] px-4 text-sm font-semibold text-[var(--content-accent)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Apply
              </button>
            </div>

            {dateRangeInvalid && (
              <p className="text-sm text-[var(--content-negative)]">Start date must be before end date.</p>
            )}

            <div className="flex flex-wrap gap-2">
              {[
                ['Today', todayKey, todayKey],
                ['Yesterday', addDays(todayKey, -1), addDays(todayKey, -1)],
                ['Last 7 days', addDays(todayKey, -6), todayKey],
                ['This month', monthStart(todayKey), todayKey],
              ].map(([label, from, to]) => {
                const active = selectedDateFrom === from && selectedDateTo === to;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => applyPresetRange(from, to)}
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                      active
                        ? 'border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {demandDates.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--content-tertiary)]">Recent order dates</p>
                <div className="flex flex-wrap gap-2">
                  {demandDates.slice(0, 7).map((dateKey) => {
                    const active = selectedDateFrom === dateKey && selectedDateTo === dateKey;
                    return (
                      <button
                        key={dateKey}
                        type="button"
                        onClick={() => applyPresetRange(dateKey, dateKey)}
                        className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                          active
                            ? 'border-[var(--bg-accent)] bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]'
                        }`}
                      >
                        {formatShortDate(dateKey)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--content-secondary)]">
          <span className="font-semibold text-[var(--content-primary)]">{activeRangeLabel}</span>
          <span>{countLabel(totals.skuCount, 'item')}</span>
          <span>{countLabel(totals.brandCount, 'brand')}</span>
          <span>{countLabel(totals.orderCount, 'order')}</span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 font-ds-micro text-[var(--content-quaternary)]">
          <span>Age:</span>
          <span className="inline-flex items-center gap-1 rounded-md border border-[color-mix(in_srgb,var(--content-positive)_20%,transparent)] bg-[var(--bg-positive-subtle)] px-1.5 py-0.5 font-bold text-[var(--content-positive)]">
            &lt;7d fresh
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-[color-mix(in_srgb,var(--content-warning)_20%,transparent)] bg-[var(--bg-warning-subtle)] px-1.5 py-0.5 font-bold text-[var(--content-warning)]">
            7-14d warm
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-[color-mix(in_srgb,var(--content-negative)_20%,transparent)] bg-[var(--bg-negative-subtle)] px-1.5 py-0.5 font-bold text-[var(--content-negative)]">
            14d+ stale
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-1">
          {(
            [
              ['brand', 'Brands', TagIcon],
              ['sku', 'Items', SquaresFourIcon],
              ['lines', 'Orders', ListBulletsIcon],
              ['pending', 'Queue', HourglassHighIcon],
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
              activeRangeLabel={activeRangeLabel}
              hasDateRange={hasDateRange}
              onCopyAllBrands={handleCopyAllBrands}
              onCopyBrand={handleCopyBrand}
              onOpenSku={openSkuDetail}
              copiedId={copiedId}
            />
          )}
          {tab === 'sku' && <SkuTab rows={bySku} loading={linesLoading} error={linesError} onOpenSku={openSkuDetail} />}
          {tab === 'lines' && (
            <LinesTab
              lines={filteredLines}
              allLines={demandLines}
              allReps={allReps}
              repFilter={repFilter}
              onRepFilter={setRepFilter}
              loading={linesLoading}
              error={linesError}
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
    </div>
  );
}

function BrandTab({
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
    return <EmptyBlock text={hasDateRange ? `No purchase demand for ${activeRangeLabel}.` : 'No open PO demand on active orders.'} />;
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

function SkuTab({
  rows,
  loading,
  error,
  onOpenSku,
}: {
  rows: SkuSummary[];
  loading: boolean;
  error: Error | null;
  onOpenSku: (itemId: number, fromTab: 'brand' | 'sku') => void;
}) {
  if (loading) return <p className="text-sm text-[var(--content-tertiary)]">Loading items...</p>;
  if (error) return <p className="text-sm text-[var(--content-negative)]">Could not load item demand.</p>;
  if (rows.length === 0) return <EmptyBlock text="No open PO demand on active orders." />;

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
                <p className="mt-2 text-sm text-[var(--content-tertiary)]">{row.brandLabel}</p>
              </div>
              {row.oldestCreatedAt && <AgePill createdAt={row.oldestCreatedAt} />}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-[var(--content-secondary)]">
              <span>
                Qty to buy <span className="font-mono font-bold text-[var(--content-primary)]">{formatNumber(row.totalPo)}</span>
              </span>
              <span>
                Value <span className="font-mono font-semibold text-[var(--content-accent)]">{formatCurrency(row.totalValue)}</span>
              </span>
              <span>{countLabel(row.lineCount, 'order line')}</span>
              <span>{countLabel(row.customerCount, 'customer')}</span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

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
  if (loading) return <p className="text-sm text-[var(--content-tertiary)]">Loading lines...</p>;
  if (error) return <p className="text-sm text-[var(--content-negative)]">Could not load PO lines.</p>;
  if (allLines.length === 0) return <EmptyBlock text="No open PO demand on active orders." />;

  return (
    <div className="space-y-3">
      {allReps.length > 1 && (
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
        <EmptyBlock text="No lines for this rep." />
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
                  <span>{formatCurrency(poValue)}</span>
                  <span className="rounded-md bg-[var(--bg-primary)] px-2 py-0.5">{groupLabel(row)}</span>
                  {order?.salesperson_name && (
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function pendingSourceLabel(source: PendingItem['source']): string {
  if (source === 'billing') return 'Billing';
  if (source === 'picking') return 'Picking';
  return 'Sales';
}

function PendingTab({
  items,
  loading,
  pendingByDay,
  pendingSummary,
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
}) {
  if (loading) return <p className="text-sm text-[var(--content-tertiary)]">Loading pending queue...</p>;
  if (items.length === 0) return <EmptyBlock text="No pending items." />;

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard
          title="Queue summary"
          subtitle="This is the operational follow-up list for billing and picking only. Sales mirror rows are excluded so the qty stays consistent with the main purchase total."
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

            <p className="mt-3 text-sm text-[var(--content-secondary)]">{item.item_name}</p>

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
          </li>
        ))}
      </ul>
    </>
  );
}
