import type { OrderItem } from '../types';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Same rule as New Order search rows: `alias1 ?? alias`, with snapshot fallback. */
export function orderItemProductCode(item: OrderItem): string {
  const a1 = item.catalog_alias1?.trim();
  const ca = item.catalog_alias?.trim();
  const frozen = item.item_alias?.trim();
  if (a1) return a1;
  if (ca) return ca;
  return frozen ?? '';
}

/**
 * Catalog `item_name` often repeats the product code as a leading token.
 * Strip using alias1, then catalog alias, then frozen line alias (same order as
 * `orderItemProductCode`).
 */
export function orderItemDisplayName(item: OrderItem): string {
  const name = item.item_name.trim();
  for (const code of [
    item.catalog_alias1?.trim(),
    item.catalog_alias?.trim(),
    item.item_alias?.trim(),
  ].filter((c): c is string => Boolean(c && c.length > 0))) {
    const re = new RegExp(`^${escapeRegExp(code)}\\s+`, 'i');
    const stripped = name.replace(re, '').trim();
    if (stripped.length > 0) return stripped;
  }
  return name;
}

/** One line for messages: code + description (matches New Order semantics). */
export function orderLineLabel(item: OrderItem): string {
  const code = orderItemProductCode(item);
  const name = orderItemDisplayName(item);
  return code ? `${code} ${name}` : name;
}

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

export function formatCurrency(n: number | null | undefined): string {
  if (n == null || n <= 0) return '—';
  return currencyFormatter.format(n);
}

export function formatCurrencyRaw(n: number): string {
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function formatTimestamp(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatShortDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatOverdueDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
