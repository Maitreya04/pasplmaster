import {
  OPEN_PO_WORKFLOW_STATUSES,
  normalizeEmbeddedOrder,
  type OpenPoDemandLine,
} from '../../hooks/useOpenPoDemandLines';
import {
  matchesDemandLocationFilter,
  resolveDemandLineLocation,
  resolvePendingItemLocation,
} from './openPoDemand';
import type { DemandLocationFilter } from './openPoDemand';
import type { PendingItem } from '../../types';

export function cleanDateParam(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

export function localDateKey(value: string): string {
  const d = new Date(value);
  return dateKeyFromDate(d);
}

export function dateKeyFromDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return dateKeyFromDate(d);
}

export function monthStart(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}

export function filterOpenWorkflowLines(lines: OpenPoDemandLine[]): OpenPoDemandLine[] {
  return lines.filter((row) => {
    const o = normalizeEmbeddedOrder(row.orders);
    return o && OPEN_PO_WORKFLOW_STATUSES.has(o.workflow_status);
  });
}

export function filterDemandLinesByDateRange(
  lines: OpenPoDemandLine[],
  selectedDateFrom: string,
  selectedDateTo: string,
): OpenPoDemandLine[] {
  if (!selectedDateFrom && !selectedDateTo) return lines;
  return lines.filter((row) => {
    const order = normalizeEmbeddedOrder(row.orders);
    if (!order?.created_at) return false;
    const orderDate = localDateKey(order.created_at);
    if (selectedDateFrom && orderDate < selectedDateFrom) return false;
    if (selectedDateTo && orderDate > selectedDateTo) return false;
    return true;
  });
}

export function filterDemandLinesByLocation(
  lines: OpenPoDemandLine[],
  locationFilter: DemandLocationFilter,
): OpenPoDemandLine[] {
  if (locationFilter === 'all') return lines;
  return lines.filter((row) =>
    matchesDemandLocationFilter(resolveDemandLineLocation(row), locationFilter),
  );
}

export function filterPendingItemsByLocation(
  items: PendingItem[],
  locationFilter: DemandLocationFilter,
): PendingItem[] {
  if (locationFilter === 'all') return items;
  return items.filter((item) =>
    matchesDemandLocationFilter(resolvePendingItemLocation(item), locationFilter),
  );
}

export function collectDemandDateKeys(lines: OpenPoDemandLine[]): string[] {
  const keys = new Set<string>();
  for (const row of lines) {
    const order = normalizeEmbeddedOrder(row.orders);
    if (order?.created_at) keys.add(localDateKey(order.created_at));
  }
  return [...keys].sort((a, b) => b.localeCompare(a));
}
