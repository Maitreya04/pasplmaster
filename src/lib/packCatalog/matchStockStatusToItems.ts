import type { Item } from '../../types';
import { itemPickCode } from '../../utils/itemCodes';
import type { BusyStockStatusRow } from './parseBusyStockStatusCsv';

export type StockStatusMatchStatus = 'ok' | 'unmatched' | 'ambiguous' | 'no_busy_code';

export interface MatchedStockStatusRow extends BusyStockStatusRow {
  item: Item | null;
  busyCode: number | null;
  matchStatus: StockStatusMatchStatus;
  /** Same as stockQty when match is ok — one piece label per counted unit. */
  labelCount: number;
}

function normalizeCatalogText(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

function buildItemLookupMaps(items: Item[]) {
  const byPickCode = new Map<string, Item[]>();
  const byNormalizedName = new Map<string, Item[]>();

  for (const item of items) {
    if (item.is_active === false) continue;

    for (const code of [item.alias1, item.alias, itemPickCode(item)]) {
      const key = code?.trim().toUpperCase();
      if (!key) continue;
      const bucket = byPickCode.get(key) ?? [];
      if (!bucket.some((it) => it.id === item.id)) bucket.push(item);
      byPickCode.set(key, bucket);
    }

    const norm = normalizeCatalogText(item.name);
    if (norm) {
      const bucket = byNormalizedName.get(norm) ?? [];
      bucket.push(item);
      byNormalizedName.set(norm, bucket);
    }
  }

  return { byPickCode, byNormalizedName };
}

function resolveBusyCode(item: Item): number | null {
  const bc = Number(item.busy_code);
  if (!Number.isFinite(bc) || bc <= 0) return null;
  return bc;
}

function resolveFromCandidates(
  row: BusyStockStatusRow,
  candidates: Item[],
): MatchedStockStatusRow {
  const withBusy = candidates.filter((it) => resolveBusyCode(it) != null);
  if (withBusy.length === 1) {
    const item = withBusy[0];
    return {
      ...row,
      item,
      busyCode: resolveBusyCode(item),
      matchStatus: 'ok',
      labelCount: row.stockQty,
    };
  }
  if (withBusy.length > 1) {
    return { ...row, item: null, busyCode: null, matchStatus: 'ambiguous', labelCount: 0 };
  }
  if (candidates.length === 1) {
    return {
      ...row,
      item: candidates[0],
      busyCode: null,
      matchStatus: 'no_busy_code',
      labelCount: 0,
    };
  }
  if (candidates.length > 1) {
    return { ...row, item: null, busyCode: null, matchStatus: 'ambiguous', labelCount: 0 };
  }
  return { ...row, item: null, busyCode: null, matchStatus: 'unmatched', labelCount: 0 };
}

function resolveStockRow(
  row: BusyStockStatusRow,
  maps: ReturnType<typeof buildItemLookupMaps>,
): MatchedStockStatusRow {
  const partKey = row.partNumber.trim().toUpperCase();
  const byCode = maps.byPickCode.get(partKey);
  if (byCode?.length) return resolveFromCandidates(row, byCode);

  if (row.description.trim()) {
    const byName = maps.byNormalizedName.get(normalizeCatalogText(row.description)) ?? [];
    if (byName.length) return resolveFromCandidates(row, byName);
  }

  return { ...row, item: null, busyCode: null, matchStatus: 'unmatched', labelCount: 0 };
}

export function matchStockStatusToItems(
  stockRows: BusyStockStatusRow[],
  items: Item[],
): MatchedStockStatusRow[] {
  const maps = buildItemLookupMaps(items);
  return stockRows.map((row) => resolveStockRow(row, maps));
}

export function stockStatusMatchSummary(rows: MatchedStockStatusRow[]): {
  ok: number;
  unmatched: number;
  ambiguous: number;
  noBusyCode: number;
  printableLabels: number;
} {
  let ok = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let noBusyCode = 0;
  let printableLabels = 0;

  for (const row of rows) {
    if (row.matchStatus === 'ok') {
      ok += 1;
      printableLabels += row.labelCount;
    } else if (row.matchStatus === 'unmatched') unmatched += 1;
    else if (row.matchStatus === 'ambiguous') ambiguous += 1;
    else noBusyCode += 1;
  }

  return { ok, unmatched, ambiguous, noBusyCode, printableLabels };
}
