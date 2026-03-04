import * as XLSX from 'xlsx';
import { supabase } from '../supabase/client';

export interface ImportProgress {
  processed: number;
  total: number;
  newCount: number;
  updatedCount: number;
  batchIndex: number;
  totalBatches: number;
  failedCount: number;
}

export type ProgressCallback = (progress: ImportProgress) => void;

const BATCH_SIZE = 500;

function hasVlookup(row: unknown[]): boolean {
  return row.some(cell => typeof cell === 'string' && cell.startsWith('=VLOOKUP'));
}

function str(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  return s || null;
}

function num(val: unknown, fallback: number): number {
  if (val == null) return fallback;
  // Strip commas so "1,075.00" from Excel parses correctly
  const raw = typeof val === 'string' ? val.replace(/,/g, '') : String(val);
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  // GST-style percentages stored as decimals (0.18 → 18)
  if (fallback === 18 && n > 0 && n < 1) return n * 100;
  return n;
}

/** Normalize code for matching: lowercase, remove spaces and slashes (e.g. "ASK/BJ/FBD/0025" and "ASKBDBAJBOX4SF" can match). */
function normalizeCode(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '').replace(/\//g, '');
}

/** Default column indices when header detection doesn't find a column (original spec). */
const DEFAULT_COLS = {
  name: 0,
  alias: 1,
  parent_group: 2,
  gst_percent: 3,
  hsn_code: 4,
  sales_price: 5,
  mrp: 6,
  alias1: 7,
  item_category: 8,
  main_group: 9,
} as const;

/** Find column index for a field by matching header labels (case-insensitive). Returns -1 if none match. */
function detectColumnIndices(headerRow: unknown[]): Record<keyof typeof DEFAULT_COLS, number> {
  const headers = (headerRow as unknown[]).map(c => String(c ?? '').trim().toLowerCase());
  const find = (...labels: string[]): number => {
    const idx = headers.findIndex(h => labels.some(l => h.includes(l) || l.includes(h)));
    return idx >= 0 ? idx : -1;
  };
  const orDefault = (found: number, def: number) => (found >= 0 ? found : def);
  return {
    name: orDefault(find('name', 'item description', 'description'), DEFAULT_COLS.name),
    alias: orDefault(find('alias', 'item code', 'code'), DEFAULT_COLS.alias),
    parent_group: orDefault(find('parent group', 'category', 'group'), DEFAULT_COLS.parent_group),
    gst_percent: orDefault(find('gst', 'gst %'), DEFAULT_COLS.gst_percent),
    hsn_code: orDefault(find('hsn', 'product id'), DEFAULT_COLS.hsn_code),
    sales_price: orDefault(find('sales price', 'price', 'sale price'), DEFAULT_COLS.sales_price),
    mrp: orDefault(find('mrp'), DEFAULT_COLS.mrp),
    alias1: orDefault(find('alias 1', 'alias1'), DEFAULT_COLS.alias1),
    item_category: orDefault(find('item cat', 'item category'), DEFAULT_COLS.item_category),
    main_group: orDefault(find('main group', 'item main grp', 'main grp'), DEFAULT_COLS.main_group),
  };
}

export async function importItems(
  workbook: XLSX.WorkBook,
  fileName: string,
  headerRowIndex: number,
  onProgress: ProgressCallback,
): Promise<ImportProgress> {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const headerRow = raw[headerRowIndex] ?? [];
  const cols = detectColumnIndices(headerRow);

  const dataStartIndex = headerRowIndex + 1;
  const dataRows = raw.slice(dataStartIndex).filter(
    row =>
      Array.isArray(row) &&
      row.some(c => c != null && String(c).trim() !== '') &&
      !hasVlookup(row),
  );

  // Pre-fetch existing items so we can match by name, alias, or alias1 (so price updates apply to the right row when the file uses a different name)
  const { data: existingItems } = await supabase
    .from('items')
    .select('name, alias, alias1');
  const existingList = existingItems ?? [];
  const existingNames = new Set(existingList.map(r => r.name));
  const nameByAlias = new Map<string, string>();
  const nameByAlias1 = new Map<string, string>();
  const nameByNormalizedCode = new Map<string, string>();
  for (const r of existingList) {
    if (r.alias) {
      nameByAlias.set(r.alias.trim(), r.name);
      nameByNormalizedCode.set(normalizeCode(r.alias), r.name);
    }
    if (r.alias1) {
      nameByAlias1.set(r.alias1.trim(), r.name);
      nameByNormalizedCode.set(normalizeCode(r.alias1), r.name);
    }
  }

  const total = dataRows.length;
  const totalBatches = Math.ceil(total / BATCH_SIZE);
  let processed = 0;
  let newCount = 0;
  let updatedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
    const batchIndex = Math.floor(i / BATCH_SIZE) + 1;
    const batch = dataRows.slice(i, i + BATCH_SIZE);
    const records = batch
      .map(row => {
        const name = str(row[cols.name]);
        if (!name) return null;
        const alias = str(row[cols.alias]);
        const alias1 = str(row[cols.alias1]);
        // Resolve canonical name: if file name matches an existing row, use it; else if file alias/alias1 matches an existing item (exact or normalized), update that row so price applies when the file uses a shorter/different name or different code format (e.g. "ASK/BJ/FBD/0025" vs "ASKBDBAJBOX4SF")
        let canonicalName = name;
        if (!existingNames.has(name)) {
          if (alias1 && nameByAlias1.has(alias1)) canonicalName = nameByAlias1.get(alias1)!;
          else if (alias && nameByAlias.has(alias)) canonicalName = nameByAlias.get(alias)!;
          else if (alias1 && nameByNormalizedCode.has(normalizeCode(alias1))) canonicalName = nameByNormalizedCode.get(normalizeCode(alias1))!;
          else if (alias && nameByNormalizedCode.has(normalizeCode(alias))) canonicalName = nameByNormalizedCode.get(normalizeCode(alias))!;
        }
        return {
          name: canonicalName,
          alias: alias,
          parent_group: str(row[cols.parent_group]),
          gst_percent: num(row[cols.gst_percent], 18),
          hsn_code: str(row[cols.hsn_code]),
          sales_price: num(row[cols.sales_price], 0),
          mrp: num(row[cols.mrp], 0),
          alias1: alias1,
          item_category: str(row[cols.item_category]),
          main_group: str(row[cols.main_group]),
          is_active: true,
          updated_at: new Date().toISOString(),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const batchNew = records.filter(r => !existingNames.has(r.name)).length;
    const batchUpdated = records.length - batchNew;
    records.forEach(r => existingNames.add(r.name));

    if (records.length > 0) {
      const { error } = await supabase.from('items').upsert(records, { onConflict: 'name' });
      if (error) {
        failedCount += records.length;
        records.forEach(r => existingNames.delete(r.name));
        onProgress({
          processed,
          total,
          newCount,
          updatedCount,
          batchIndex,
          totalBatches,
          failedCount,
        });
        continue;
      }
    }

    processed += batch.length;
    newCount += batchNew;
    updatedCount += batchUpdated;
    onProgress({ processed, total, newCount, updatedCount, batchIndex, totalBatches, failedCount });
  }

  await supabase.from('upload_log').insert({
    file_type: 'items_price',
    file_name: fileName,
    row_count: total,
    new_count: newCount,
    updated_count: updatedCount,
    status: 'completed',
  });

  console.log(`[Import items_price] Total rows successfully imported: ${processed.toLocaleString()}`);
  if (failedCount > 0) {
    console.warn(`[Import items_price] ${failedCount.toLocaleString()} rows failed (batches with errors)`);
  }
  return { processed, total, newCount, updatedCount, batchIndex: totalBatches, totalBatches, failedCount };
}
