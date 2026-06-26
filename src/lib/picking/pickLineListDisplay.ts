/** Shared display helpers for dense pick-line list rows. */

export interface PickLineListEntry {
  itemId: number;
  rackNo: string | null;
  partCode: string;
  itemName: string;
  targetQty: number;
  pickedQty?: number;
  uom: string;
  unitPrice?: number | null;
  status: 'pending' | 'now' | 'partial' | 'picked' | 'flagged' | 'skipped';
  flagReason?: string | null;
}

export interface RackLineGroup {
  rackKey: string;
  rackLabel: string;
  rows: PickLineListEntry[];
}

export function rackGroupKey(rackNo: string | null | undefined): string {
  const trimmed = (rackNo ?? '').trim();
  return trimmed.length > 0 ? trimmed.toUpperCase() : '__NO_RACK__';
}

export function rackGroupLabel(rackKey: string): string {
  return rackKey === '__NO_RACK__' ? '—' : rackKey;
}

/** Group consecutive rows that share the same rack (preserves pick walk order). */
export function groupPickLinesByRack(rows: PickLineListEntry[]): RackLineGroup[] {
  const groups: RackLineGroup[] = [];
  for (const row of rows) {
    const key = rackGroupKey(row.rackNo);
    const last = groups[groups.length - 1];
    if (last && last.rackKey === key) {
      last.rows.push(row);
    } else {
      groups.push({
        rackKey: key,
        rackLabel: rackGroupLabel(key),
        rows: [row],
      });
    }
  }
  return groups;
}

/** Truncate description at word boundary when possible. */
export function truncatePickDescription(text: string, maxLen = 28): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  const slice = trimmed.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.55) {
    return `${slice.slice(0, lastSpace).trimEnd()}…`;
  }
  return `${slice.trimEnd()}…`;
}

export function formatPickLineTotalPrice(
  targetQty: number,
  unitPrice: number | null | undefined,
): string | null {
  if (unitPrice == null || !Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  const total = Math.round(targetQty * unitPrice);
  if (total <= 0) return null;
  return `₹${total.toLocaleString('en-IN')}`;
}

export function orderItemUnitPrice(
  priceQuoted: number | null | undefined,
  priceSystem: number | null | undefined,
): number | null {
  const price = priceQuoted ?? priceSystem;
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  return price;
}
