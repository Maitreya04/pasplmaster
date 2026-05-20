import type { PackCatalogRow } from './buildPackCatalogRows';

export interface PackCatalogFilters {
  query: string;
  brand: string | null;
  incompleteOnly: boolean;
  hasRackOnly: boolean;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export function filterPackCatalogRows(
  rows: PackCatalogRow[],
  filters: PackCatalogFilters,
): PackCatalogRow[] {
  const q = normalize(filters.query);

  return rows.filter((row) => {
    if (filters.brand && row.brand !== filters.brand) return false;
    if (filters.incompleteOnly && row.status !== 'incomplete') return false;
    if (filters.hasRackOnly && !row.item.rack_no?.trim()) return false;

    if (!q) return true;

    const haystack = [
      row.alias1Display,
      row.pickCode,
      row.item.alias,
      row.item.name,
      row.item.rack_no,
      row.brand,
      row.busyCode != null ? String(row.busyCode) : '',
    ]
      .filter(Boolean)
      .map((v) => normalize(String(v)));

    return haystack.some((h) => h.includes(q));
  });
}

export function sortPackCatalogRows(rows: PackCatalogRow[]): PackCatalogRow[] {
  return [...rows].sort((a, b) => {
    const rackA = (a.item.rack_no ?? '').trim();
    const rackB = (b.item.rack_no ?? '').trim();
    if (!rackA && rackB) return 1;
    if (rackA && !rackB) return -1;
    const rackCmp = rackA.localeCompare(rackB, undefined, { numeric: true });
    if (rackCmp !== 0) return rackCmp;
    return a.alias1Display.localeCompare(b.alias1Display, undefined, { numeric: true });
  });
}
