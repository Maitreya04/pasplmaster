import { Check, Copy } from '@phosphor-icons/react';
import {
  normalizeEmbeddedItem,
  type OpenPoDemandLine,
} from '../../hooks/useOpenPoDemandLines';
import { demandLineBrandKey } from '../../lib/purchase/partnerBrandMatch';
import { stockLocationLabel } from '../../hooks/useLocationwiseStock';
import { formatCurrency, formatShortDate, formatTimeAgo } from '../../utils/formatters';
import type { PendingItem, StockLocationCode } from '../../types';

export type BrandSkuRow = {
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

export type BrandSummary = {
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

export type SkuSummary = {
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

export type PendingDayRow = {
  dateKey: string;
  itemCount: number;
  qtyPending: number;
};

export type SupplyDemandViewMode = 'admin' | 'partner';

export function ageDays(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
}

type AgeBand = {
  days: number;
  label: string;
  pillClass: string;
};

export function getAgeBand(createdAt: string): AgeBand {
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

export function AgePill({ createdAt }: { createdAt: string }) {
  const band = getAgeBand(createdAt);
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-ds-micro font-bold tabular-nums ${band.pillClass}`}>
      {band.label}
    </span>
  );
}

export function groupLabel(line: OpenPoDemandLine): string {
  return demandLineBrandKey(line);
}

export function linePoValue(line: OpenPoDemandLine): number {
  return line.qty_po * (line.price_quoted ?? line.price_system ?? 0);
}

export function formatNumber(n: number): string {
  return n.toLocaleString('en-IN');
}

export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

export function formatDateRangeLabel(from: string, to: string): string {
  if (from && to && from === to) return formatShortDate(from);
  if (from && to) return `${formatShortDate(from)} - ${formatShortDate(to)}`;
  if (from) return `From ${formatShortDate(from)}`;
  if (to) return `Until ${formatShortDate(to)}`;
  return 'All open purchase demand';
}

export function isToday(value: string): boolean {
  const d = new Date(value);
  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`;
  return `${yyyy}-${mm}-${dd}` === todayKey;
}

export function toTabSeparated(rows: Array<Array<string | number>>): string {
  return rows.map((row) => row.join('\t')).join('\n');
}

export function buildAllBrandCopy(rows: BrandSummary[]): string {
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

export function buildSingleBrandCopy(brand: BrandSummary): string {
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

export function CopyButton({
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

export function MetricCard({
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

export function SectionCard({
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

export function EmptyBlock({ text }: { text: string }) {
  return <p className="rounded-2xl border border-dashed border-[var(--border-subtle)] p-5 text-sm text-[var(--content-tertiary)]">{text}</p>;
}

export function AliasChip({
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

export function AliasChipRow({
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

export function pendingSourceLabel(source: PendingItem['source']): string {
  if (source === 'billing') return 'Billing';
  if (source === 'picking') return 'Picking';
  return 'Sales';
}

export function demandLocationLabel(code: StockLocationCode | null | undefined): string {
  return stockLocationLabel(code === 'jabalpur' ? 'jabalpur' : 'main_store');
}

export function normalizeItemEmbed(line: OpenPoDemandLine) {
  return normalizeEmbeddedItem(line.items);
}

export { formatCurrency, formatShortDate, formatTimeAgo };
