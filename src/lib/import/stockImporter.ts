import * as XLSX from 'xlsx';
import { supabase } from '../supabase/client';
import type { ImportProgress, ProgressCallback } from './itemImporter';

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
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  if (fallback === 18 && n > 0 && n < 1) return n * 100;
  return n;
}

function detectColumnIndices(headerRow: unknown[]) {
  const headers = (headerRow as unknown[]).map(c => String(c ?? '').trim().toLowerCase());
  const find = (...labels: string[]) => {
    const norm = labels.map(l => l.toLowerCase());
    // Pass 1: exact match (highest priority)
    const exact = headers.findIndex(h => norm.some(l => h === l));
    if (exact >= 0) return exact;
    // Pass 2: header contains the full label
    const contains = headers.findIndex(h => norm.some(l => h.includes(l)));
    if (contains >= 0) return contains;
    // Pass 3: label contains header (loosest)
    const reverse = headers.findIndex(h => norm.some(l => l.includes(h)));
    if (reverse >= 0) return reverse;
    return -1;
  };
  return {
    itemDetails: find('item details', 'item', 'name', 'description'),
    alias: find('alias', 'item code', 'code'),
    alias1: find('alias 1', 'alias1'),
    parentGroup: find('parent group', 'group', 'category'),
    cat: find('cat', 'item cat', 'item category'),
    rackNo: find('rack no', 'rack no.'),
    qty: find('qty', 'qty.'),
    gst: find('gst', 'gst%'),
    hsn: find('hsn'),
  };
}

function assignIfPresent(
  obj: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  if (value === null || value === undefined) return;
  // Avoid overwriting existing DB values with empty strings
  if (typeof value === 'string' && value.trim() === '') return;
  obj[key] = value;
}

export async function importStock(
  workbook: XLSX.WorkBook,
  fileName: string,
  headerRowIndex: number,
  onProgress: ProgressCallback,
): Promise<ImportProgress> {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const headerRow = raw[headerRowIndex] ?? [];
  const col = detectColumnIndices(headerRow);

  const dataStartIndex = headerRowIndex + 1;
  const dataRows = raw.slice(dataStartIndex).filter(
    row =>
      Array.isArray(row) &&
      row.some(c => c != null && String(c).trim() !== '') &&
      !hasVlookup(row),
  );

  const { data: existing } = await supabase.from('items').select('name');
  const existingNames = new Set((existing ?? []).map(r => r.name));

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
        const name = col.itemDetails >= 0 ? str(row[col.itemDetails]) : null;
        if (!name) return null;

        const record: Record<string, unknown> = {
          name,
          is_active: true,
          updated_at: new Date().toISOString(),
        };

        // Only assign optional fields if the column exists AND value is present.
        // This prevents wiping existing DB values when the stock sheet omits columns.
        if (col.alias >= 0) assignIfPresent(record, 'alias', str(row[col.alias]));
        if (col.alias1 >= 0) assignIfPresent(record, 'alias1', str(row[col.alias1]));
        if (col.parentGroup >= 0) assignIfPresent(record, 'parent_group', str(row[col.parentGroup]));
        if (col.cat >= 0) assignIfPresent(record, 'item_category', str(row[col.cat]));
        if (col.gst >= 0) assignIfPresent(record, 'gst_percent', num(row[col.gst], 18));
        if (col.hsn >= 0) assignIfPresent(record, 'hsn_code', str(row[col.hsn]));
        if (col.qty >= 0) assignIfPresent(record, 'stock_qty', num(row[col.qty], 0));

        if (col.rackNo >= 0) {
          const rackNoVal = str(row[col.rackNo]);
          if (rackNoVal != null && rackNoVal !== '') assignIfPresent(record, 'rack_no', rackNoVal);
        }

        return record;
      })
      .filter((r): r is Record<string, unknown> => r !== null);

    const batchNew = records.filter(r => !existingNames.has(r.name as string)).length;
    const batchUpdated = records.length - batchNew;
    records.forEach(r => existingNames.add(r.name as string));

    if (records.length > 0) {
      const { error } = await supabase.from('items').upsert(records, { onConflict: 'name' });
      if (error) {
        failedCount += records.length;
        records.forEach(r => existingNames.delete(r.name as string));
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
    file_type: 'items_stock',
    file_name: fileName,
    row_count: total,
    new_count: newCount,
    updated_count: updatedCount,
    status: 'completed',
  });

  console.log(`[Import items_stock] Total rows successfully imported: ${processed.toLocaleString()}`);
  if (failedCount > 0) {
    console.warn(`[Import items_stock] ${failedCount.toLocaleString()} rows failed (batches with errors)`);
  }
  return { processed, total, newCount, updatedCount, batchIndex: totalBatches, totalBatches, failedCount };
}
