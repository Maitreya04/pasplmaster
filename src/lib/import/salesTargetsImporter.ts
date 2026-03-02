import * as XLSX from 'xlsx';
import { supabase } from '../supabase/client';
import type { ImportProgress, ProgressCallback } from './itemImporter';

const YEAR = '2025-26';

// 4WF: Excel header -> display name
const NAME_MAP_4WF: Record<string, string> = {
  SATISHJI: 'Satish',
  HEMANTJI: 'Hemant',
  MANKARJI: 'Mankar',
  RAJUJI: 'Raju Ji',
  GUDDU: 'Guddu',
  REHAN: 'Rehan Multani',
  MANISH: 'Manish Sharma',
  HARDEEPJI: 'Hardeep Singh',
  MAHENDRA: 'Mahendra Rajput',
  DEEPAK: 'Deepak',
  VINOD: 'Vinod',
  AWASTHIJI: 'Anand Awasthi',
};

// 2W people (for category assignment when on combined sheet)
const PEOPLE_2W = new Set(['Mahendra Rajput', 'Deepak', 'Vinod', 'Anand Awasthi']);

// 2Wf sheet (separate sheet): column index -> display name
const COL_TO_NAME_2WF: Record<number, string> = {
  1: 'Mankar',
  3: 'Mahendra Rajput',
  5: 'Deepak',
  7: 'Vinod',
  9: 'Anand Awasthi',
};

function str(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  return s || null;
}

function parseNum(val: unknown): number | null {
  if (val == null) return null;
  const s = String(val).trim().replace(/\s+/g, ' ');
  if (!s) return null;
  // Skip placeholder like " - " or " -  " (dash with spaces)
  if (/^-\s*$/.test(s) || s === '-') return null;
  if (s.toLowerCase().includes('k')) return null; // skip quantity values
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getSheet(workbook: XLSX.WorkBook, name: string): XLSX.WorkSheet | null {
  const exact = workbook.Sheets[name];
  if (exact) return exact;
  const lower = name.toLowerCase();
  for (const sheetName of workbook.SheetNames) {
    if (sheetName.toLowerCase() === lower) return workbook.Sheets[sheetName];
  }
  return null;
}

function parse4WFSheet(sheet: XLSX.WorkSheet): Array<{ salesperson_name: string; product_group: string; annual_target_lakhs: number }> {
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (raw.length < 3) return [];

  const row1 = (raw[0] ?? []) as unknown[];
  const row2 = (raw[1] ?? []) as unknown[];
  const targets: Array<{ salesperson_name: string; product_group: string; annual_target_lakhs: number }> = [];

  // Row 1 has salesperson names; row 2 has years (24-25, 25-26). Each person has 2 cols.
  // Build col index -> salesperson_name for cols where row2 = "25-26"
  const colToName: Record<number, string> = {};
  let lastSalesperson: string | null = null;
  for (let c = 1; c < Math.max(row1.length, row2.length); c++) {
    const header = str(row1[c]);
    if (header) {
      const key = header.toUpperCase().replace(/\s+/g, '');
      const displayName = NAME_MAP_4WF[key];
      if (displayName) lastSalesperson = displayName;
    }
    const yearVal = str(row2[c]);
    const is2526 = yearVal === '25-26' || yearVal === '2025-26';
    if (is2526 && lastSalesperson) colToName[c] = lastSalesperson;
  }

  for (let r = 2; r < raw.length; r++) {
    const row = (raw[r] ?? []) as unknown[];
    const productGroup = str(row[0]);
    if (!productGroup || productGroup.toUpperCase() === 'TOTAL') continue;

    for (const [colStr, salespersonName] of Object.entries(colToName)) {
      const col = parseInt(colStr, 10);
      const val = parseNum(row[col]);
      if (val == null || val === 0) continue;
      targets.push({
        salesperson_name: salespersonName,
        product_group: productGroup,
        annual_target_lakhs: val,
      });
    }
  }
  return targets;
}

function parse2WfSheet(sheet: XLSX.WorkSheet): Array<{ salesperson_name: string; product_group: string; annual_target_lakhs: number }> {
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (raw.length < 2) return [];

  const targets: Array<{ salesperson_name: string; product_group: string; annual_target_lakhs: number }> = [];

  for (let r = 1; r < raw.length; r++) {
    const row = (raw[r] ?? []) as unknown[];
    const productGroup = str(row[0]);
    if (!productGroup || productGroup.toUpperCase() === 'TOTAL') continue;

    for (const [colStr, salespersonName] of Object.entries(COL_TO_NAME_2WF)) {
      const col = parseInt(colStr, 10);
      const val = parseNum(row[col]);
      if (val == null || val === 0) continue;
      targets.push({
        salesperson_name: salespersonName,
        product_group: productGroup,
        annual_target_lakhs: val,
      });
    }
  }
  return targets;
}

export async function importSalesTargets(
  workbook: XLSX.WorkBook,
  fileName: string,
  onProgress: ProgressCallback,
): Promise<ImportProgress> {
  const records: Array<{
    salesperson_name: string;
    product_group: string;
    year: string;
    annual_target_lakhs: number;
    category: string | null;
  }> = [];

  const sheet4WF = getSheet(workbook, '4WF');
  const sheet2Wf = getSheet(workbook, '2Wf');

  if (sheet4WF) {
    const from4WF = parse4WFSheet(sheet4WF);
    for (const t of from4WF) {
      records.push({
        ...t,
        year: YEAR,
        category: null,
      });
    }
  }

  if (sheet2Wf) {
    const from2Wf = parse2WfSheet(sheet2Wf);
    for (const t of from2Wf) {
      records.push({
        ...t,
        year: YEAR,
        category: '2W',
      });
    }
  }

  // CSV or single-sheet combined 4W+2W: use first sheet when no 4WF/2Wf sheets
  if (!sheet4WF && !sheet2Wf) {
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (firstSheet) {
      const fromCombined = parse4WFSheet(firstSheet);
      for (const t of fromCombined) {
        records.push({
          ...t,
          year: YEAR,
          category: PEOPLE_2W.has(t.salesperson_name) ? '2W' : null,
        });
      }
    }
  }

  const total = records.length;
  onProgress({
    processed: 0,
    total,
    newCount: 0,
    updatedCount: 0,
    batchIndex: 0,
    totalBatches: 1,
    failedCount: 0,
  });

  if (records.length === 0) {
    await supabase.from('upload_log').insert({
      file_type: 'sales_targets',
      file_name: fileName,
      row_count: 0,
      new_count: 0,
      updated_count: 0,
      status: 'completed',
    });
    return {
      processed: 0,
      total: 0,
      newCount: 0,
      updatedCount: 0,
      batchIndex: 1,
      totalBatches: 1,
      failedCount: 0,
    };
  }

  // Deduplicate by (salesperson_name, product_group, year) — last wins
  const seen = new Map<string, (typeof records)[0]>();
  for (const r of records) {
    const key = `${r.salesperson_name}|${r.product_group}|${r.year}`;
    seen.set(key, r);
  }
  const deduped = Array.from(seen.values());

  const rowsWithMeta = deduped.map(r => ({
    ...r,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('sales_targets')
    .upsert(rowsWithMeta, {
      onConflict: 'salesperson_name,product_group,year',
    });

  if (error) {
    await supabase.from('upload_log').insert({
      file_type: 'sales_targets',
      file_name: fileName,
      row_count: deduped.length,
      status: 'failed',
      error_message: error.message,
    });
    throw new Error(error.message);
  }

  await supabase.from('upload_log').insert({
    file_type: 'sales_targets',
    file_name: fileName,
    row_count: deduped.length,
    new_count: deduped.length,
    updated_count: 0,
    status: 'completed',
  });

  onProgress({
    processed: deduped.length,
    total: deduped.length,
    newCount: deduped.length,
    updatedCount: 0,
    batchIndex: 1,
    totalBatches: 1,
    failedCount: 0,
  });

  return {
    processed: deduped.length,
    total: deduped.length,
    newCount: deduped.length,
    updatedCount: 0,
    batchIndex: 1,
    totalBatches: 1,
    failedCount: 0,
  };
}
