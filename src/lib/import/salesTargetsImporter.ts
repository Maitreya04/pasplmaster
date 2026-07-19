import * as XLSX from 'xlsx';
import { supabase } from '../supabase/client';
import type { ImportProgress, ProgressCallback } from './itemImporter';
import { normalizeSalesTargetProductGroup } from './salesTargetNormalization';

// 4WF: Excel header -> display name
const NAME_MAP_4WF: Record<string, string> = {
  SATISHJI: 'Satish',
  HEMANTJI: 'Hemant',
  MANKARJI: 'Mankar',
  RAJUJI: 'Raju',
  GUDDU: 'Guddu',
  REHAN: 'Rehan',
  MANISH: 'Manish',
  HARDEEPJI: 'Hardeep',
  MAHENDRA: 'Mahendra Rajput',
  DEEPAK: 'Deepak Sharma',
  VINOD: 'Vinod',
  AWASTHIJI: 'Awasthi',
};

// 2W people (for category assignment when on combined sheet)
const PEOPLE_2W = new Set(['Mahendra Rajput', 'Deepak Sharma', 'Vinod', 'Awasthi']);

// 2Wf sheet (separate sheet): column index -> display name
const COL_TO_NAME_2WF: Record<number, string> = {
  1: 'Mankar',
  3: 'Mahendra Rajput',
  5: 'Deepak Sharma',
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

function financialYearCells(label: string): Set<string> {
  const normalized = label.trim();
  const short = normalized.replace(/^(?:19|20)(\d{2})-/, '$1-');
  return new Set([normalized, short]);
}

function parse4WFSheet(
  sheet: XLSX.WorkSheet,
  financialYearLabel: string,
): Array<{ salesperson_name: string; product_group: string; annual_target_lakhs: number }> {
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (raw.length < 3) return [];

  const row1 = (raw[0] ?? []) as unknown[];
  const row2 = (raw[1] ?? []) as unknown[];
  const targets: Array<{ salesperson_name: string; product_group: string; annual_target_lakhs: number }> = [];

  // Row 1 has salesperson names and row 2 selects the active financial year.
  const colToName: Record<number, string> = {};
  const acceptedYearCells = financialYearCells(financialYearLabel);
  let lastSalesperson: string | null = null;
  for (let c = 1; c < Math.max(row1.length, row2.length); c++) {
    const header = str(row1[c]);
    if (header) {
      const key = header.toUpperCase().replace(/\s+/g, '');
      // Ignore TOTAL columns (these are per-row totals across all salespeople)
      if (key.startsWith('TOTAL')) {
        lastSalesperson = null;
      } else {
        const displayName = NAME_MAP_4WF[key];
        if (displayName) lastSalesperson = displayName;
      }
    }
    const yearVal = str(row2[c]);
    if (yearVal && acceptedYearCells.has(yearVal) && lastSalesperson) {
      colToName[c] = lastSalesperson;
    }
  }

  for (let r = 2; r < raw.length; r++) {
    const row = (raw[r] ?? []) as unknown[];
    const productGroupRaw = str(row[0]);
    if (!productGroupRaw) continue;
    const pgNorm = productGroupRaw.toUpperCase().replace(/\s+/g, ' ').trim();
    // Skip any total rows like "TOTAL", "TOTAL 4W", "TOTAL 2W"
    if (pgNorm === 'TOTAL' || pgNorm.startsWith('TOTAL ')) continue;

    for (const [colStr, salespersonName] of Object.entries(colToName)) {
      const col = parseInt(colStr, 10);
      const val = parseNum(row[col]);
      if (val == null || val === 0) continue;
      // Excel values are already ANNUAL targets in lakhs
      targets.push({
        salesperson_name: salespersonName,
        product_group: normalizeSalesTargetProductGroup(productGroupRaw),
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
    const productGroupRaw = str(row[0]);
    if (!productGroupRaw) continue;
    const pgNorm = productGroupRaw.toUpperCase().replace(/\s+/g, ' ').trim();
    // Skip any total rows like "TOTAL", "TOTAL 4W", "TOTAL 2W"
    if (pgNorm === 'TOTAL' || pgNorm.startsWith('TOTAL ')) continue;

    for (const [colStr, salespersonName] of Object.entries(COL_TO_NAME_2WF)) {
      const col = parseInt(colStr, 10);
      const val = parseNum(row[col]);
      if (val == null || val === 0) continue;
      // Excel values are already ANNUAL targets in lakhs
      targets.push({
        salesperson_name: salespersonName,
        product_group: normalizeSalesTargetProductGroup(productGroupRaw),
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
    annual_target_lakhs: number;
    category: string | null;
  }> = [];

  const { data: financialYearRows, error: fyError } = await supabase.rpc('get_active_financial_year');
  if (fyError) throw fyError;
  const activeFinancialYear = Array.isArray(financialYearRows) ? financialYearRows[0] : null;
  const financialYearLabel = activeFinancialYear?.label as string | undefined;
  if (!financialYearLabel) {
    throw new Error('No active financial year is configured.');
  }

  const sheet4WF = getSheet(workbook, '4WF');
  const sheet2Wf = getSheet(workbook, '2Wf');

  if (sheet4WF) {
    const from4WF = parse4WFSheet(sheet4WF, financialYearLabel);
    for (const t of from4WF) {
      records.push({
        ...t,
        category: null,
      });
    }
  }

  if (sheet2Wf) {
    const from2Wf = parse2WfSheet(sheet2Wf);
    for (const t of from2Wf) {
      records.push({
        ...t,
        category: '2W',
      });
    }
  }

  // CSV or single-sheet combined 4W+2W: use first sheet when no 4WF/2Wf sheets
  if (!sheet4WF && !sheet2Wf) {
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (firstSheet) {
      const fromCombined = parse4WFSheet(firstSheet, financialYearLabel);
      for (const t of fromCombined) {
        records.push({
          ...t,
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
    throw new Error(`No ${financialYearLabel} target columns were found in this workbook.`);
  }

  // Combine rows that normalize to the same Busy segment.
  const seen = new Map<string, (typeof records)[0]>();
  for (const r of records) {
    const key = `${r.salesperson_name}|${r.product_group}`;
    const existing = seen.get(key);
    seen.set(key, existing
      ? { ...existing, annual_target_lakhs: existing.annual_target_lakhs + r.annual_target_lakhs }
      : r);
  }
  const deduped = Array.from(seen.values());

  const { data: rpcResult, error } = await supabase.rpc('admin_upsert_sales_targets', {
    p_financial_year_label: financialYearLabel,
    p_rows: deduped,
    p_file_name: fileName,
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

  if (!rpcResult?.success) {
    const unmatched = Array.isArray(rpcResult?.unmatched_rows)
      ? rpcResult.unmatched_rows
      : [];
    const names = Array.from(
      new Set(
        unmatched
          .map((row: { salesperson_name?: unknown }) => String(row.salesperson_name ?? '').trim())
          .filter(Boolean),
      ),
    );
    const message =
      rpcResult?.error === 'unmatched_salespeople'
        ? `Sales target import blocked. Match these salespeople in User Management first: ${names.join(', ')}`
        : String(rpcResult?.error ?? 'Sales target import failed');

    await supabase.from('upload_log').insert({
      file_type: 'sales_targets',
      file_name: fileName,
      row_count: deduped.length,
      status: 'failed',
      error_message: message,
    });
    throw new Error(message);
  }

  const { data: mappingResult, error: mappingError } = await supabase.rpc(
    'admin_reconcile_sales_target_mappings',
    { p_financial_year_label: financialYearLabel },
  );
  if (mappingError) throw mappingError;
  if (!mappingResult?.success) {
    throw new Error(String(mappingResult?.refresh?.error ?? 'Sales category mapping refresh failed'));
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
