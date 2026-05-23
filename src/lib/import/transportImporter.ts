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

function normalizeGstin(val: string | null): string | null {
  if (!val) return null;
  const normalized = val.replace(/\s+/g, '').toUpperCase();
  return normalized || null;
}

function detectColumns(header: string[]): { name: number; gstin: number } {
  const lower = header.map(h => h.toLowerCase());
  const nameIndex = (() => {
    const explicit = [
      'transporter name',
      'transport name',
      'transporter',
      'transport',
      'name',
    ];
    for (const label of explicit) {
      const idx = lower.indexOf(label);
      if (idx >= 0) return idx;
    }
    return 0;
  })();
  const gstinIndex = (() => {
    const labels = ['gstin', 'gst no.', 'gst no', 'gst number', 'gst'];
    for (const label of labels) {
      const idx = lower.indexOf(label);
      if (idx >= 0) return idx;
    }
    return header.length > 1 ? 1 : -1;
  })();
  return { name: nameIndex, gstin: gstinIndex };
}

export async function importTransports(
  workbook: XLSX.WorkBook,
  fileName: string,
  headerRowIndex: number,
  onProgress: ProgressCallback,
): Promise<ImportProgress> {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  const hasHeader = headerRowIndex >= 0;
  const header = hasHeader
    ? ((raw[headerRowIndex] as unknown[] | undefined)?.map(c => String(c ?? '').trim()) ?? [])
    : [];
  const col = hasHeader ? detectColumns(header) : { name: 0, gstin: 1 };

  const dataStartIndex = hasHeader ? headerRowIndex + 1 : 0;
  const dataRows = raw.slice(dataStartIndex).filter(
    row =>
      Array.isArray(row) &&
      row.some(c => c != null && String(c).trim() !== '') &&
      !hasVlookup(row),
  );

  const { data: existing } = await supabase
    .from('transports')
    .select('name')
    .returns<{ name: string }[]>();
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

        const gstinRaw = col.gstin >= 0 ? str(row[col.gstin]) : null;
        const record: Record<string, unknown> = {
          name,
          is_active: true,
        };
        if (gstinRaw) record.gstin = normalizeGstin(gstinRaw);
        return record;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const batchNew = records.filter(r => !existingNames.has(r.name as string)).length;
    const batchUpdated = records.length - batchNew;
    records.forEach(r => existingNames.add(r.name as string));

    if (records.length > 0) {
      const { error } = await supabase.from('transports').upsert(records, { onConflict: 'name' });
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
    file_type: 'transports',
    file_name: fileName,
    row_count: total,
    new_count: newCount,
    updated_count: updatedCount,
    status: 'completed',
  });

  if (failedCount > 0) {
    console.warn(`[Import transports] ${failedCount.toLocaleString()} rows failed (batches with errors)`);
  }
  return { processed, total, newCount, updatedCount, batchIndex: totalBatches, totalBatches, failedCount };
}
