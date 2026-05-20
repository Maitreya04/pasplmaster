import * as XLSX from 'xlsx';
import { supabase } from '../supabase/client';

/** Normalize code for fuzzy alias match (same idea as itemImporter). */
export function normalizePurchasePartKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '').replace(/\//g, '');
}

/** OEM-style codes: ignore hyphens/spacing differences vs items.alias (PDF/OCR). */
export function normalizeAlphanumericPartKey(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface PurchasePoRawRow {
  rowIndex: number;
  partRaw: string;
  descriptionRaw: string;
  qtyOrdered: number;
}

export interface PurchasePoResolvedRow extends PurchasePoRawRow {
  resolvedBusyCode: number | null;
  resolvedItemId: number | null;
  resolvedItemName: string | null;
  warning: string | null;
}

/** Preview row with user-editable order qty (Excel + demand hints). */
export type PurchasePoPreviewRow = PurchasePoResolvedRow & {
  orderQty: number;
};

type ItemLookupRow = {
  id: number;
  name: string;
  busy_code: number | null;
  alias: string | null;
  alias1: string | null;
};

/** Part no cell — preserve codes Excel stored as numbers (no scientific notation). */
function partStr(val: unknown): string {
  if (val == null) return '';
  if (typeof val === 'number' && Number.isFinite(val)) {
    if (Number.isInteger(val)) return String(Math.trunc(val));
    return String(val).trim();
  }
  return String(val).trim();
}

/** Index item.name only when it is a single token (supplier part code), not a long description. */
export function looksLikeCatalogPartCode(s: string | null | undefined): boolean {
  const t = (s ?? '').trim();
  if (t.length < 3 || t.length > 48) return false;
  if (/\s/.test(t)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._\-]*$/.test(t);
}

function qtyNum(val: unknown): number {
  if (val == null) return 0;
  const raw = typeof val === 'string' ? val.replace(/,/g, '') : String(val);
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function findCol(headers: string[], predicates: ((h: string) => boolean)[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i] ?? '';
    if (predicates.some((p) => p(h))) return i;
  }
  return -1;
}

/** Header cell labels for supplier PO identifier columns (description, item name, alias, part no). */
export function isPurchasePoIdentifierHeader(h: string): boolean {
  const x = h.toLowerCase().trim();
  return (
    x === 'description' ||
    x.includes('item description') ||
    x === 'item description' ||
    x === 'item name' ||
    x === 'itemname' ||
    (x.includes('item') && x.includes('name') && !x.includes('code')) ||
    x === 'part no' ||
    x === 'partno' ||
    x.replace(/\s+/g, '') === 'partno' ||
    (x.includes('part') && x.includes('no')) ||
    x === 'busy code' ||
    x.replace(/\s+/g, '') === 'busycode' ||
    x === 'item code' ||
    (x.includes('item') && x.includes('code')) ||
    x === 'alias' ||
    x === 'alias 1' ||
    x.replace(/\s+/g, '') === 'alias1'
  );
}

/** Header cell labels for order quantity columns. */
export function isPurchasePoQtyHeader(h: string): boolean {
  const x = h.toLowerCase().trim();
  return (
    x === 'qty' ||
    x === 'quantity' ||
    x === 'order' ||
    x === 'ord' ||
    x.includes('qty') ||
    x.includes('qty to buy') ||
    x.includes('order qty') ||
    x.includes('qty to order')
  );
}

/** Supplier PO upload: identifier column + qty column; no Sales Price (avoids price-list clash). */
export function hasPurchasePoColumns(headers: string[]): boolean {
  const lowered = headers.map((h) => String(h ?? '').toLowerCase().trim());
  const hasIdentifier = lowered.some(isPurchasePoIdentifierHeader);
  const qtyCol = lowered.some(isPurchasePoQtyHeader);
  const hasSalesPrice = lowered.some((h) => /sales\s*price/i.test(h) || /^price$/i.test(h));
  return hasIdentifier && qtyCol && !hasSalesPrice;
}

function normalizeCatalogItemName(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Trailing supplier code in description text, e.g. `… DIESEL(C28)` or `… MODI (P-L29)`. */
export function extractSupplierPartFromDescription(description: string): string | null {
  const m = description.trim().match(/\(([^)]+)\)\s*$/);
  if (!m) return null;
  const code = m[1].trim();
  if (code.length < 2 || code.length > 32) return null;
  return code;
}

/** Column indices from header row (lowercased labels). */
export function detectPurchasePoColumns(headerRow: unknown[]): {
  partIdx: number;
  aliasIdx: number;
  alias1Idx: number;
  descIdx: number;
  qtyIdx: number;
} {
  const headers = (headerRow as unknown[]).map((c) => String(c ?? '').trim().toLowerCase());
  const partIdx = findCol(headers, [
    (h) => h === 'part no' || h === 'partno' || h.replace(/\s+/g, '') === 'partno',
    (h) => h.includes('part') && h.includes('no'),
    (h) => h === 'busy code' || h.replace(/\s+/g, '') === 'busycode',
    (h) => h === 'item code' || (h.includes('item') && h.includes('code')),
  ]);
  const aliasIdx = findCol(headers, [(h) => h === 'alias']);
  const alias1Idx = findCol(headers, [
    (h) => h === 'alias 1' || h === 'alias1' || h.replace(/\s+/g, '') === 'alias1',
  ]);
  const descIdx = findCol(headers, [
    (h) => h === 'description' || h.includes('item description') || h === 'item description',
    (h) => h === 'item name' || h === 'itemname' || (h.includes('item') && h.includes('name') && !h.includes('code')),
  ]);
  const qtyIdx = findCol(headers, [(h) => isPurchasePoQtyHeader(h)]);
  return { partIdx, aliasIdx, alias1Idx, descIdx, qtyIdx };
}

export function parsePurchasePoSheet(
  workbook: XLSX.WorkBook,
  headerRowIndex: number,
): PurchasePoRawRow[] {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  const headerRow = raw[headerRowIndex] ?? [];
  const { partIdx, aliasIdx, alias1Idx, descIdx, qtyIdx } = detectPurchasePoColumns(headerRow);
  const hasIdentifier = partIdx >= 0 || aliasIdx >= 0 || alias1Idx >= 0 || descIdx >= 0;
  if (!hasIdentifier || qtyIdx < 0) {
    throw new Error(
      'Missing identifier (Part no, Alias, Alias 1, or Description) or qty column (Qty, Order, ORD) in header row.',
    );
  }

  const cell = (row: unknown[], idx: number): string => (idx >= 0 ? partStr(row[idx]) : '');

  const rows: PurchasePoRawRow[] = [];
  for (let i = headerRowIndex + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!Array.isArray(row)) continue;
    const descriptionRaw = cell(row, descIdx);
    const partRaw =
      cell(row, partIdx) ||
      cell(row, aliasIdx) ||
      cell(row, alias1Idx) ||
      extractSupplierPartFromDescription(descriptionRaw) ||
      '';
    const q = qtyNum(row[qtyIdx]);
    if (!partRaw && !descriptionRaw && q === 0) continue;
    if (!partRaw && !descriptionRaw) continue;
    rows.push({
      rowIndex: i + 1,
      partRaw,
      descriptionRaw: descriptionRaw || partRaw,
      qtyOrdered: q,
    });
  }
  return rows;
}

const LOOKUP_PAGE_SIZE = 1000;

/** Paginate full catalog — PostgREST defaults to 1000 rows; partial fetch misses most aliases. */
export async function fetchAllItemsForPurchaseLookup(): Promise<ItemLookupRow[]> {
  const rows: ItemLookupRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('items')
      .select('id,name,busy_code,alias,alias1')
      .order('id', { ascending: true })
      .range(from, from + LOOKUP_PAGE_SIZE - 1);

    if (error) throw error;
    const page = (data ?? []) as ItemLookupRow[];
    rows.push(...page);
    if (page.length < LOOKUP_PAGE_SIZE) break;
    from += LOOKUP_PAGE_SIZE;
  }

  return rows;
}

export type PurchaseLookupMaps = {
  byBusy: Map<number, ItemLookupRow>;
  byAliasNorm: Map<string, ItemLookupRow>;
  /** Uppercase A–Z / 0–9 only; first alias wins on collision. */
  byAliasAlpha: Map<string, ItemLookupRow>;
  byExactName: Map<string, ItemLookupRow>;
  byNormalizedName: Map<string, ItemLookupRow[]>;
  items: ItemLookupRow[];
};

export function buildLookupMaps(items: ItemLookupRow[]): PurchaseLookupMaps {
  const byBusy = new Map<number, ItemLookupRow>();
  const byAliasNorm = new Map<string, ItemLookupRow>();
  const byAliasAlpha = new Map<string, ItemLookupRow>();
  const byExactName = new Map<string, ItemLookupRow>();
  const byNormalizedName = new Map<string, ItemLookupRow[]>();

  const registerAlpha = (raw: string | null | undefined, it: ItemLookupRow) => {
    const k = normalizeAlphanumericPartKey(raw ?? '');
    if (k.length < 4) return;
    if (!byAliasAlpha.has(k)) byAliasAlpha.set(k, it);
  };

  const registerPartKey = (raw: string | null | undefined, it: ItemLookupRow) => {
    const trimmed = raw?.trim();
    if (!trimmed) return;
    const key = normalizePurchasePartKey(trimmed);
    if (!byAliasNorm.has(key)) byAliasNorm.set(key, it);
    registerAlpha(trimmed, it);
  };

  for (const it of items) {
    if (it.busy_code != null && Number(it.busy_code) > 0) {
      byBusy.set(Number(it.busy_code), it);
    }
    registerPartKey(it.alias, it);
    registerPartKey(it.alias1, it);
    if (looksLikeCatalogPartCode(it.name)) {
      registerPartKey(it.name, it);
    }
    const name = it.name?.trim();
    if (name) {
      byExactName.set(name.toUpperCase(), it);
      const norm = normalizeCatalogItemName(name);
      const list = byNormalizedName.get(norm) ?? [];
      list.push(it);
      byNormalizedName.set(norm, list);
    }
  }
  return { byBusy, byAliasNorm, byAliasAlpha, byExactName, byNormalizedName, items };
}

export async function fetchPurchaseLookupMaps(): Promise<PurchaseLookupMaps> {
  const items = await fetchAllItemsForPurchaseLookup();
  return buildLookupMaps(items);
}

export type PurchasePartMatchHow =
  | 'busy_numeric'
  | 'alias_normalized'
  | 'alias_alphanumeric'
  | 'name_code'
  | 'item_name'
  | 'fuzzy_ocr'
  | 'description_token';

export type PurchasePartResolution = {
  busyCode: number | null;
  itemId: number | null;
  itemName: string | null;
  warning: string | null;
  matchHow?: PurchasePartMatchHow;
};

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/**
 * When OCR corrupts long OEM codes vs items.alias / alias1: pick the single best catalog row within edit distance.
 * Skipped unless norm length ≥ 10; requires a unique winner among items.
 */
function resolveFuzzyUniqueOcr(normAlpha: string, items: ItemLookupRow[]): ItemLookupRow | null {
  if (normAlpha.length < 10) return null;
  const maxDist = normAlpha.length <= 18 ? 2 : 3;
  let minD = Infinity;
  const atMin: ItemLookupRow[] = [];

  for (const it of items) {
    let itemMin = Infinity;
    for (const al of [it.alias, it.alias1]) {
      const raw = al?.trim();
      if (!raw) continue;
      const na = normalizeAlphanumericPartKey(raw);
      if (na.length < 10) continue;
      if (Math.abs(na.length - normAlpha.length) > maxDist) continue;
      const d = levenshtein(normAlpha, na);
      if (d <= maxDist) itemMin = Math.min(itemMin, d);
    }
    if (itemMin <= maxDist && itemMin < Infinity) {
      if (itemMin < minD) {
        minD = itemMin;
        atMin.length = 0;
        atMin.push(it);
      } else if (itemMin === minD) {
        atMin.push(it);
      }
    }
  }

  const winners = new Map<number, ItemLookupRow>();
  for (const it of atMin) {
    const bc = Number(it.busy_code);
    if (Number.isFinite(bc) && bc > 0) winners.set(bc, it);
  }
  if (winners.size !== 1) return null;
  return [...winners.values()][0];
}

function resolutionFromItem(
  it: ItemLookupRow | undefined,
  matchHow: PurchasePartMatchHow,
  partLabel: string,
): PurchasePartResolution {
  if (!it) {
    return { busyCode: null, itemId: null, itemName: null, warning: `No item match for "${partLabel}"` };
  }
  const bc = it.busy_code != null ? Number(it.busy_code) : NaN;
  if (!Number.isFinite(bc) || bc <= 0) {
    return {
      busyCode: null,
      itemId: it.id,
      itemName: it.name,
      warning: `Found "${it.name}" in catalog but busy code is missing — set busy_code on the item`,
      matchHow,
    };
  }
  return {
    busyCode: bc,
    itemId: it.id,
    itemName: it.name,
    warning: null,
    matchHow,
  };
}

/** Resolve against busy_code, alias, alias1, code-style name (normalized + alphanumeric + cautious OCR fuzzy). */
export function resolvePurchasePartToItem(partRaw: string, maps: PurchaseLookupMaps): PurchasePartResolution {
  const trimmed = partRaw.trim();
  if (!trimmed) {
    return { busyCode: null, itemId: null, itemName: null, warning: 'Empty part number' };
  }

  const { byBusy, byAliasNorm, byAliasAlpha, items } = maps;

  const asNum = Number(trimmed.replace(/,/g, ''));
  if (Number.isFinite(asNum) && asNum > 0) {
    return resolutionFromItem(byBusy.get(asNum), 'busy_numeric', trimmed);
  }

  const norm = normalizePurchasePartKey(trimmed);
  const byAlias = byAliasNorm.get(norm);
  if (byAlias) {
    const matchHow: PurchasePartMatchHow =
      looksLikeCatalogPartCode(byAlias.name) && normalizePurchasePartKey(byAlias.name) === norm
        ? 'name_code'
        : 'alias_normalized';
    return resolutionFromItem(byAlias, matchHow, trimmed);
  }

  const alpha = normalizeAlphanumericPartKey(trimmed);
  if (alpha.length >= 4) {
    const hitA = byAliasAlpha.get(alpha);
    if (hitA) {
      return resolutionFromItem(hitA, 'alias_alphanumeric', trimmed);
    }
  }

  if (alpha.length >= 10) {
    const fuzzyHit = resolveFuzzyUniqueOcr(alpha, items);
    if (fuzzyHit) {
      const base = resolutionFromItem(fuzzyHit, 'fuzzy_ocr', trimmed);
      if (base.busyCode != null) {
        return { ...base, warning: 'OCR fuzzy match to catalog — verify busy code' };
      }
      return base;
    }
  }

  return {
    busyCode: null,
    itemId: null,
    itemName: null,
    warning: `No item match for "${trimmed}"`,
  };
}

function splitInvoiceDescriptionTokens(desc: string): string[] {
  const parts = desc
    .split(/[\s\-_/,.]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const k = normalizePurchasePartKey(p);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(p);
    }
  }
  return out;
}

/** Match supplier sheet text to `items.name` (exact, then normalized unique). */
function resolveByCatalogItemName(label: string, maps: PurchaseLookupMaps): PurchasePartResolution | null {
  const trimmed = label.trim();
  if (!trimmed) return null;

  const exact = maps.byExactName.get(trimmed.toUpperCase());
  if (exact) return resolutionFromItem(exact, 'item_name', trimmed);

  const candidates = maps.byNormalizedName.get(normalizeCatalogItemName(trimmed)) ?? [];
  const withBusy = candidates.filter((it) => {
    const bc = Number(it.busy_code);
    return Number.isFinite(bc) && bc > 0;
  });
  if (withBusy.length === 1) return resolutionFromItem(withBusy[0], 'item_name', trimmed);
  if (withBusy.length > 1) {
    return {
      busyCode: null,
      itemId: null,
      itemName: null,
      warning: `Multiple catalog items match name "${trimmed}" — use Part no or Alias column`,
      matchHow: 'item_name',
    };
  }
  return null;
}

/**
 * Invoice lines: try supplier part code first, then full description, then description tokens.
 * Uses same catalog rules as Excel PO import (`items.busy_code`, `alias`, `alias1`, `name`).
 */
export function resolvePurchasePartForInvoiceLine(
  partRaw: string,
  descriptionRaw: string,
  maps: PurchaseLookupMaps,
): PurchasePartResolution {
  const pr = partRaw.trim();
  const dr = descriptionRaw.trim();

  if (pr) {
    const r = resolvePurchasePartToItem(pr, maps);
    if (r.busyCode != null) return r;
  }

  if (dr) {
    const parenCode = extractSupplierPartFromDescription(dr);
    if (parenCode) {
      const rParen = resolvePurchasePartToItem(parenCode, maps);
      if (rParen.busyCode != null) {
        return {
          ...rParen,
          matchHow: 'description_token',
          warning: rParen.warning ?? 'Matched code in parentheses — verify',
        };
      }
    }

    const r = resolvePurchasePartToItem(dr, maps);
    if (r.busyCode != null) {
      if (!pr) return r;
      return {
        ...r,
        matchHow: 'description_token',
        warning: r.warning ?? 'Matched from description — verify supplier part code',
      };
    }

    const byName = resolveByCatalogItemName(dr, maps);
    if (byName?.busyCode != null) {
      return {
        ...byName,
        warning: byName.warning ?? 'Matched catalog item name — verify',
      };
    }
    if (byName?.warning) return byName;

    for (const tok of splitInvoiceDescriptionTokens(dr)) {
      const r2 = resolvePurchasePartToItem(tok, maps);
      if (r2.busyCode != null) {
        return {
          busyCode: r2.busyCode,
          itemId: r2.itemId,
          itemName: r2.itemName,
          warning:
            r2.matchHow === 'fuzzy_ocr'
              ? 'Matched description token (fuzzy OCR) — verify'
              : 'Matched catalog via description token — verify',
          matchHow: 'description_token',
        };
      }
    }
  }

  return {
    busyCode: null,
    itemId: null,
    itemName: null,
    warning: pr ? `No catalog match for part "${pr}"` : dr ? 'No catalog match for description' : 'No part or description',
  };
}

export async function createBusyCodeResolver(): Promise<(partRaw: string) => number | null> {
  const maps = await fetchPurchaseLookupMaps();
  return (partRaw: string) => resolvePurchasePartToItem(partRaw, maps).busyCode;
}

/** Parse workbook rows and resolve busy codes against catalog (client-side). */
export async function resolvePurchasePoRows(rawRows: PurchasePoRawRow[]): Promise<PurchasePoResolvedRow[]> {
  if (rawRows.length === 0) return [];
  const maps = await fetchPurchaseLookupMaps();
  return rawRows.map((r) => {
    const { busyCode, itemId, itemName, warning } = resolvePurchasePartForInvoiceLine(
      r.partRaw,
      r.descriptionRaw,
      maps,
    );
    const desc = itemName && !r.descriptionRaw?.trim() ? itemName : r.descriptionRaw;
    return {
      ...r,
      descriptionRaw: desc,
      resolvedBusyCode: busyCode,
      resolvedItemId: itemId,
      resolvedItemName: itemName,
      warning,
    };
  });
}

/** Apply Excel qty, else open sales PO demand hint per busy code. */
export function buildPurchasePoPreviewRows(
  resolved: PurchasePoResolvedRow[],
  suggestedQtyByBusyCode: Map<number, number>,
): PurchasePoPreviewRow[] {
  return resolved.map((r) => {
    const suggested =
      r.resolvedBusyCode != null ? suggestedQtyByBusyCode.get(r.resolvedBusyCode) ?? 0 : 0;
    const orderQty = r.qtyOrdered > 0 ? r.qtyOrdered : suggested > 0 ? suggested : 0;
    return { ...r, orderQty };
  });
}
