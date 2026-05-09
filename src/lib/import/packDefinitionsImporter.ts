import * as XLSX from 'xlsx';
import { supabase } from '../supabase/client';
import type { ImportProgress, ProgressCallback } from './itemImporter';

interface ItemLookupRow {
  id: number;
  busy_code: number | null;
  name: string;
  alias: string | null;
  alias1: string | null;
}

interface PackSourceRow {
  itemName: string;
  partNo: string | null;
  innerPackQty: number | null;
  outerPackQty: number | null;
}

const BATCH_SIZE = 500;

function str(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  return s || null;
}

function packQty(val: unknown): number | null {
  if (val == null) return null;
  const raw = typeof val === 'string' ? val.replace(/,/g, '') : String(val);
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 1) return null;
  return Math.trunc(n);
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
}

function normalizeCode(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function detectColumnIndices(headerRow: unknown[]) {
  const headers = headerRow.map(c => String(c ?? '').trim().toLowerCase());
  const find = (...labels: string[]) => {
    const norm = labels.map(l => l.toLowerCase());
    const exact = headers.findIndex(h => norm.some(l => h === l));
    if (exact >= 0) return exact;
    return headers.findIndex(h => norm.some(l => h.includes(l)));
  };
  return {
    itemName: find('itemname', 'item name', 'name'),
    partNo: find('part no.', 'part no', 'partno', 'alias', 'code'),
    outerPackQty: find('mast.box', 'master box', 'outer box', 'outer_pack_qty'),
    innerPackQty: find('inner.box', 'inner box', 'inner_pack_qty'),
  };
}

async function fetchAllItemLookups(): Promise<ItemLookupRow[]> {
  const rows: ItemLookupRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('items')
      .select('id,busy_code,name,alias,alias1')
      .order('id', { ascending: true })
      .range(from, from + BATCH_SIZE - 1);

    if (error) throw error;
    rows.push(...((data ?? []) as ItemLookupRow[]));
    if (!data || data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }

  return rows;
}

function buildSourceRows(raw: unknown[][], headerRowIndex: number): PackSourceRow[] {
  const headerRow = raw[headerRowIndex] ?? [];
  const cols = detectColumnIndices(headerRow);
  const dataRows = raw.slice(headerRowIndex + 1);

  return dataRows
    .map((row) => {
      const itemName = cols.itemName >= 0 ? str(row[cols.itemName]) : null;
      if (!itemName) return null;
      const innerPackQty = cols.innerPackQty >= 0 ? packQty(row[cols.innerPackQty]) : null;
      const outerPackQty = cols.outerPackQty >= 0 ? packQty(row[cols.outerPackQty]) : null;
      if (!innerPackQty && !outerPackQty) return null;
      return {
        itemName,
        partNo: cols.partNo >= 0 ? str(row[cols.partNo]) : null,
        innerPackQty,
        outerPackQty,
      };
    })
    .filter((row): row is PackSourceRow => row !== null);
}

function mapRowsToBusyCodes(sourceRows: PackSourceRow[], items: ItemLookupRow[]) {
  const byExactName = new Map<string, ItemLookupRow>();
  const byNormalizedName = new Map<string, ItemLookupRow[]>();
  const byCode = new Map<string, ItemLookupRow[]>();

  for (const item of items) {
    if (item.name) byExactName.set(item.name.trim().toUpperCase(), item);

    const normalizedName = normalizeName(item.name);
    if (normalizedName) {
      const list = byNormalizedName.get(normalizedName) ?? [];
      list.push(item);
      byNormalizedName.set(normalizedName, list);
    }

    for (const code of [item.alias, item.alias1]) {
      const normalizedCode = normalizeCode(code);
      if (!normalizedCode) continue;
      const list = byCode.get(normalizedCode) ?? [];
      list.push(item);
      byCode.set(normalizedCode, list);
    }
  }

  const mapped: Array<Record<string, unknown>> = [];
  let unmatched = 0;
  let noBusyCode = 0;
  let ambiguous = 0;

  for (const source of sourceRows) {
    let match: ItemLookupRow | null = byExactName.get(source.itemName.trim().toUpperCase()) ?? null;

    if (!match) {
      const normalizedMatches = byNormalizedName.get(normalizeName(source.itemName)) ?? [];
      if (normalizedMatches.length === 1) match = normalizedMatches[0];
      else if (normalizedMatches.length > 1) {
        ambiguous += 1;
        continue;
      }
    }

    if (!match && source.partNo) {
      const codeMatches = byCode.get(normalizeCode(source.partNo)) ?? [];
      if (codeMatches.length === 1) match = codeMatches[0];
      else if (codeMatches.length > 1) {
        ambiguous += 1;
        continue;
      }
    }

    if (!match) {
      const oldNameMatches = byNormalizedName.get(normalizeName(`${source.itemName}_old`)) ?? [];
      if (oldNameMatches.length === 1) {
        const oldItem = oldNameMatches[0];
        const bridgedMatches = [oldItem.alias, oldItem.alias1]
          .flatMap((oldCode) => byCode.get(normalizeCode(oldCode)) ?? [])
          .filter((candidate) => candidate.id !== oldItem.id && candidate.busy_code != null);
        const uniqueMatches = Array.from(
          new Map(bridgedMatches.map((candidate) => [candidate.id, candidate])).values(),
        );
        if (uniqueMatches.length === 1) match = uniqueMatches[0];
        else if (uniqueMatches.length > 1) {
          ambiguous += 1;
          continue;
        }
      } else if (oldNameMatches.length > 1) {
        ambiguous += 1;
        continue;
      }
    }

    if (!match) {
      unmatched += 1;
      continue;
    }

    if (match.busy_code == null) {
      noBusyCode += 1;
      continue;
    }

    mapped.push({
      busy_code: match.busy_code,
      item_id: match.id,
      item_name: match.name,
      inner_pack_qty: source.innerPackQty,
      outer_pack_qty: source.outerPackQty,
    });
  }

  return { mapped, unmatched, noBusyCode, ambiguous };
}

export async function importPackDefinitions(
  workbook: XLSX.WorkBook,
  fileName: string,
  headerRowIndex: number,
  onProgress: ProgressCallback,
): Promise<ImportProgress> {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  const sourceRows = buildSourceRows(raw, headerRowIndex);
  const total = sourceRows.length;

  onProgress({
    processed: 0,
    total,
    newCount: 0,
    updatedCount: 0,
    batchIndex: 1,
    totalBatches: 1,
    failedCount: 0,
  });

  const items = await fetchAllItemLookups();
  const { mapped, unmatched, noBusyCode, ambiguous } = mapRowsToBusyCodes(sourceRows, items);

  const { data, error } = await supabase.rpc('upsert_item_pack_definitions', {
    p_rows: mapped,
    p_source_file: fileName,
  });

  if (error) throw error;

  const result = (data ?? {}) as {
    inserted?: number;
    updated?: number;
    skipped?: number;
    unmatched?: number;
  };
  const failedCount = unmatched + noBusyCode + ambiguous + (result.skipped ?? 0) + (result.unmatched ?? 0);
  const progress: ImportProgress = {
    processed: mapped.length,
    total,
    newCount: result.inserted ?? 0,
    updatedCount: result.updated ?? 0,
    batchIndex: 1,
    totalBatches: 1,
    failedCount,
  };

  onProgress(progress);

  await supabase.from('upload_log').insert({
    file_type: 'item_pack_definitions',
    file_name: fileName,
    row_count: total,
    new_count: progress.newCount,
    updated_count: progress.updatedCount,
    changes_summary: {
      mapped: mapped.length,
      failed_count: failedCount,
      unmatched,
      no_busy_code: noBusyCode,
      ambiguous,
      rpc_skipped: result.skipped ?? 0,
      rpc_unmatched: result.unmatched ?? 0,
    },
    status: 'completed',
  });

  return progress;
}
