import type { Item } from '../../types';
import type { ParetoPlanRow } from './parseLucasParetoPlan';

export type ParetoMatchStatus = 'ok' | 'unmatched' | 'ambiguous' | 'no_busy_code';

export interface MatchedParetoPlanRow extends ParetoPlanRow {
  item: Item | null;
  busyCode: number | null;
  matchStatus: ParetoMatchStatus;
}

function normalizeCatalogItemName(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

function buildItemLookupMaps(items: Item[]) {
  const byExactName = new Map<string, Item>();
  const byNormalizedName = new Map<string, Item[]>();

  for (const item of items) {
    if (item.is_active === false) continue;
    const exact = item.name.trim().toUpperCase();
    if (exact) byExactName.set(exact, item);

    const norm = normalizeCatalogItemName(item.name);
    const bucket = byNormalizedName.get(norm) ?? [];
    bucket.push(item);
    byNormalizedName.set(norm, bucket);
  }

  return { byExactName, byNormalizedName };
}

function resolvePlanRow(
  row: ParetoPlanRow,
  maps: ReturnType<typeof buildItemLookupMaps>,
): MatchedParetoPlanRow {
  const trimmed = row.skuName.trim();
  const exact = maps.byExactName.get(trimmed.toUpperCase());
  if (exact) {
    const bc = Number(exact.busy_code);
    if (!Number.isFinite(bc) || bc <= 0) {
      return { ...row, item: exact, busyCode: null, matchStatus: 'no_busy_code' };
    }
    return { ...row, item: exact, busyCode: bc, matchStatus: 'ok' };
  }

  const candidates = maps.byNormalizedName.get(normalizeCatalogItemName(trimmed)) ?? [];
  const withBusy = candidates.filter((it) => {
    const bc = Number(it.busy_code);
    return Number.isFinite(bc) && bc > 0;
  });

  if (withBusy.length === 1) {
    const item = withBusy[0];
    return { ...row, item, busyCode: Number(item.busy_code), matchStatus: 'ok' };
  }
  if (withBusy.length > 1) {
    return { ...row, item: null, busyCode: null, matchStatus: 'ambiguous' };
  }
  if (candidates.length > 0) {
    return { ...row, item: candidates[0], busyCode: null, matchStatus: 'no_busy_code' };
  }

  return { ...row, item: null, busyCode: null, matchStatus: 'unmatched' };
}

export function matchParetoPlanToItems(
  planRows: ParetoPlanRow[],
  items: Item[],
): MatchedParetoPlanRow[] {
  const maps = buildItemLookupMaps(items);
  return planRows.map((row) => resolvePlanRow(row, maps));
}

export function paretoMatchSummary(rows: MatchedParetoPlanRow[]): {
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
