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

export async function importStock(
  workbook: XLSX.WorkBook,
  fileName: string,
  headerRowIndex: number,
  onProgress: ProgressCallback,
): Promise<ImportProgress> {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const header = (raw[headerRowIndex] as unknown[]).map(c => String(c ?? '').trim());
  const col = {
    itemDetails: header.indexOf('Item Details'),
    alias: header.indexOf('Alias'),
    alias1: header.indexOf('Alias 1'),
    parentGroup: header.indexOf('Parent Group'),
    cat: header.indexOf('Cat'),
    rackNo: header.indexOf('Rack No.'),
    qty: header.indexOf('Qty.'),
    gst: header.indexOf('GST%'),
    hsn: header.indexOf('HSN'),
  };

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

        const rackNoVal = col.rackNo >= 0 ? str(row[col.rackNo]) : null;

        const record: Record<string, unknown> = {
          name,
          alias: col.alias >= 0 ? str(row[col.alias]) : null,
          alias1: col.alias1 >= 0 ? str(row[col.alias1]) : null,
          parent_group: col.parentGroup >= 0 ? str(row[col.parentGroup]) : null,
          item_category: col.cat >= 0 ? str(row[col.cat]) : null,
          stock_qty: col.qty >= 0 ? num(row[col.qty], 0) : 0,
          gst_percent: col.gst >= 0 ? num(row[col.gst], 18) : 18,
          hsn_code: col.hsn >= 0 ? str(row[col.hsn]) : null,
          is_active: true,
          updated_at: new Date().toISOString(),
        };
        if (rackNoVal != null && rackNoVal !== '') {
          record.rack_no = rackNoVal;
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
