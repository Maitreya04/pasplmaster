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
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  // GST-style percentages stored as decimals (0.18 → 18)
  if (fallback === 18 && n > 0 && n < 1) return n * 100;
  return n;
}

export async function importItems(
  workbook: XLSX.WorkBook,
  fileName: string,
  headerRowIndex: number,
  onProgress: ProgressCallback,
): Promise<ImportProgress> {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const dataStartIndex = headerRowIndex + 1;
  const dataRows = raw.slice(dataStartIndex).filter(
    row =>
      Array.isArray(row) &&
      row.some(c => c != null && String(c).trim() !== '') &&
      !hasVlookup(row),
  );

  // Pre-fetch existing names so we can count new vs updated
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
        const name = str(row[0]);
        if (!name) return null;
        return {
          name,
          alias: str(row[1]),
          parent_group: str(row[2]),
          gst_percent: num(row[3], 18),
          hsn_code: str(row[4]),
          sales_price: num(row[5], 0),
          mrp: num(row[6], 0),
          alias1: str(row[7]),
          item_category: str(row[8]),
          main_group: str(row[9]),
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
