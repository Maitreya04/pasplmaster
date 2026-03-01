import * as XLSX from 'xlsx';
import { supabase } from '../supabase/client';
import type { ImportProgress, ProgressCallback } from './itemImporter';

const BATCH_SIZE = 500;

const VEHICLE_WORDS = new Set(['2', '3', '4', 'wh', 'wheeler', 'wheelers', 'two', 'three', 'four']);

function extractCity(parentGroup: string | null): string | null {
  if (!parentGroup) return null;
  const words = parentGroup.trim().split(/\s+/);
  if (words.length <= 1) return words[0] || null;
  if (VEHICLE_WORDS.has(words[1].toLowerCase())) return words[0];
  return `${words[0]} ${words[1]}`;
}

function hasVlookup(row: unknown[]): boolean {
  return row.some(cell => typeof cell === 'string' && cell.startsWith('=VLOOKUP'));
}

function str(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  return s || null;
}

export async function importCustomers(
  workbook: XLSX.WorkBook,
  fileName: string,
  onProgress: ProgressCallback,
): Promise<ImportProgress> {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Customer file: header at Excel row 1 (index 0), data from row 2 (index 1)
  const header = (raw[0] as unknown[]).map(c => String(c ?? '').trim());
  const col = {
    name: header.indexOf('Name'),
    address: header.indexOf('Address'),
    parentGroup: header.indexOf('Parent Group'),
    mobile: header.indexOf('Mobile'),
    salesman: header.indexOf('Salesman'),
    gstin: header.indexOf('GSTIN'),
  };

  const dataRows = raw.slice(1).filter(
    row =>
      Array.isArray(row) &&
      row.some(c => c != null && String(c).trim() !== '') &&
      !hasVlookup(row),
  );

  const { data: existing } = await supabase.from('customers').select('name');
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
        const name = col.name >= 0 ? str(row[col.name]) : null;
        if (!name) return null;

        const parentGroup = col.parentGroup >= 0 ? str(row[col.parentGroup]) : null;

        return {
          name,
          address: col.address >= 0 ? str(row[col.address]) : null,
          parent_group: parentGroup,
          city: extractCity(parentGroup),
          mobile: col.mobile >= 0 ? str(row[col.mobile]) : null,
          salesman: col.salesman >= 0 ? str(row[col.salesman]) : null,
          gstin: col.gstin >= 0 ? str(row[col.gstin]) : null,
          is_active: true,
          updated_at: new Date().toISOString(),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const batchNew = records.filter(r => !existingNames.has(r.name)).length;
    const batchUpdated = records.length - batchNew;
    records.forEach(r => existingNames.add(r.name));

    if (records.length > 0) {
      const { error } = await supabase.from('customers').upsert(records, { onConflict: 'name' });
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
    file_type: 'customers',
    file_name: fileName,
    row_count: total,
    new_count: newCount,
    updated_count: updatedCount,
    status: 'completed',
  });

  console.log(`[Import customers] Total rows successfully imported: ${processed.toLocaleString()}`);
  if (failedCount > 0) {
    console.warn(`[Import customers] ${failedCount.toLocaleString()} rows failed (batches with errors)`);
  }
  return { processed, total, newCount, updatedCount, batchIndex: totalBatches, totalBatches, failedCount };
}
