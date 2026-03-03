import * as XLSX from 'xlsx';
import { supabase } from '../supabase/client';
import type { ImportProgress, ProgressCallback } from './itemImporter';

const BATCH_SIZE = 500;

type CustomerTopItemKey = string; // `${customer_name}|${item_name}`
type SalespersonTopCustomerKey = string; // `${salesperson_name}|${customer_name}`

interface CustomerTopItemAgg {
  customer_name: string;
  item_name: string;
  total_qty: number;
  order_count: number;
  avg_qty: number;
  most_common_qty: number | null;
  last_ordered: string | null; // ISO date (YYYY-MM-DD)
  qtyCounts: Map<number, number>;
}

interface SalespersonTopCustomerAgg {
  salesperson_name: string;
  customer_name: string;
  total_value: number;
  last_order_date: string | null; // ISO date
  dates: Set<string>; // unique order dates for order_count
}

function toStr(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  return s || null;
}

function toNumber(val: unknown): number | null {
  if (val == null) return null;
  const n = Number(String(val).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function parseExcelDate(val: unknown): string | null {
  if (val == null) return null;

  if (typeof val === 'number') {
    const parsed = XLSX.SSF.parse_date_code(val);
    if (!parsed) return null;
    const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    return d.toISOString().slice(0, 10);
  }

  const s = String(val).trim();
  if (!s) return null;

  // Try native Date parsing as a fallback for string dates
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
  }

  return null;
}

function maxDate(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a >= b ? a : b;
}

function findCol(header: string[], candidates: string[]): number {
  const lower = header.map(h => h.toLowerCase());
  for (const name of candidates) {
    const target = name.toLowerCase();
    // 1) Exact match
    const exactIdx = lower.indexOf(target);
    if (exactIdx !== -1) return exactIdx;
    // 2) Substring / fuzzy match
    for (let i = 0; i < lower.length; i++) {
      const col = lower[i];
      if (!col) continue;
      if (col.includes(target) || target.includes(col)) return i;
    }
  }
  return -1;
}

export async function importSalesHistory(
  workbook: XLSX.WorkBook,
  fileName: string,
  onProgress: ProgressCallback,
): Promise<ImportProgress> {
  const customerAgg = new Map<CustomerTopItemKey, CustomerTopItemAgg>();
  const salespersonAgg = new Map<SalespersonTopCustomerKey, SalespersonTopCustomerAgg>();

  let sourceRowCount = 0;

  // Process all sheets
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    if (raw.length < 2) continue;

    const header = (raw[0] as unknown[]).map(c => String(c ?? '').trim());

    const colVchDate = findCol(header, ['VchDate', 'Vch Date', 'Voucher Date']);
    const colParty = findCol(header, ['Party', 'Party Name', 'Customer', 'Customer Name']);
    const colSalesman = findCol(header, ['Salesman', 'Sales Person', 'Salesperson']);
    const colItem = findCol(header, ['Itemname', 'Item Name', 'Item', 'Product', 'Stock Item']);
    const colQty = findCol(header, ['Qty', 'Qty.', 'Quantity']);
    const colAmount = findCol(header, ['Taxableamt', 'Taxable Amount', 'Amount', 'Value', 'Total', 'Net Amount']);

    if (colVchDate < 0 || colParty < 0 || colSalesman < 0 || colItem < 0 || colQty < 0 || colAmount < 0) {
      // Not a sales history-style sheet, skip
      continue;
    }

    for (let r = 1; r < raw.length; r++) {
      const row = raw[r] as unknown[];
      if (!Array.isArray(row)) continue;
      if (!row.some(c => c != null && String(c).trim() !== '')) continue;

      const vchDate = parseExcelDate(row[colVchDate]);
      const party = toStr(row[colParty]);
      const salesman = toStr(row[colSalesman]);
      const itemName = toStr(row[colItem]);
      const qtyVal = toNumber(row[colQty]);
      const amtVal = toNumber(row[colAmount]);

      if (!party || !salesman || !itemName || qtyVal == null || amtVal == null) continue;
      if (qtyVal <= 0) continue; // skip returns / non-positive quantities

      sourceRowCount += 1;

      // --- customer_top_items aggregation ---
      const custKey = `${party}|${itemName}`;
      let custAgg = customerAgg.get(custKey);
      if (!custAgg) {
        custAgg = {
          customer_name: party,
          item_name: itemName,
          total_qty: 0,
          order_count: 0,
          avg_qty: 0,
          most_common_qty: null,
          last_ordered: null,
          qtyCounts: new Map<number, number>(),
        };
        customerAgg.set(custKey, custAgg);
      }

      custAgg.total_qty += qtyVal;
      custAgg.order_count += 1;
      custAgg.avg_qty = custAgg.total_qty / custAgg.order_count;
      custAgg.last_ordered = maxDate(custAgg.last_ordered, vchDate);

      if (custAgg.order_count <= 10) {
        const prev = custAgg.qtyCounts.get(qtyVal) ?? 0;
        custAgg.qtyCounts.set(qtyVal, prev + 1);
        let bestQty = qtyVal;
        let bestCount = 0;
        for (const [q, c] of custAgg.qtyCounts.entries()) {
          if (c > bestCount) {
            bestCount = c;
            bestQty = q;
          }
        }
        custAgg.most_common_qty = bestQty;
      } else if (custAgg.most_common_qty == null) {
        custAgg.most_common_qty = qtyVal;
      }

      // --- salesperson_top_customers aggregation ---
      const spKey = `${salesman}|${party}`;
      let spAgg = salespersonAgg.get(spKey);
      if (!spAgg) {
        spAgg = {
          salesperson_name: salesman,
          customer_name: party,
          total_value: 0,
          last_order_date: null,
          dates: new Set<string>(),
        };
        salespersonAgg.set(spKey, spAgg);
      }

      spAgg.total_value += amtVal;
      if (vchDate) {
        spAgg.dates.add(vchDate);
        spAgg.last_order_date = maxDate(spAgg.last_order_date, vchDate);
      }
    }
  }

  const customerRecords = Array.from(customerAgg.values()).map(a => ({
    customer_name: a.customer_name,
    item_name: a.item_name,
    total_qty: a.total_qty,
    order_count: a.order_count,
    avg_qty: a.avg_qty,
    most_common_qty: a.most_common_qty,
    last_ordered: a.last_ordered,
    updated_at: new Date().toISOString(),
  }));

  const salespersonRecords = Array.from(salespersonAgg.values()).map(a => ({
    salesperson_name: a.salesperson_name,
    customer_name: a.customer_name,
    order_count: a.dates.size,
    total_value: a.total_value,
    last_order_date: a.last_order_date,
    updated_at: new Date().toISOString(),
  }));

  const totalBatches =
    Math.ceil(customerRecords.length / BATCH_SIZE) + Math.ceil(salespersonRecords.length / BATCH_SIZE);

  let processedBatches = 0;
  let failedCount = 0;

  onProgress({
    processed: 0,
    total: sourceRowCount,
    newCount: 0,
    updatedCount: 0,
    batchIndex: 0,
    totalBatches,
    failedCount: 0,
  });

  // Helper to update progress after each logical batch
  const updateProgress = () => {
    processedBatches += 1;
    onProgress({
      processed: sourceRowCount, // all source rows have been read; we track batch progress via batchIndex
      total: sourceRowCount,
      newCount: 0,
      updatedCount: 0,
      batchIndex: processedBatches,
      totalBatches,
      failedCount,
    });
  };

  // Upsert customer_top_items in batches
  for (let i = 0; i < customerRecords.length; i += BATCH_SIZE) {
    const batch = customerRecords.slice(i, i + BATCH_SIZE);
    if (batch.length === 0) continue;
    const { error } = await supabase
      .from('customer_top_items')
      .upsert(batch, { onConflict: 'customer_name,item_name' });
    if (error) {
      failedCount += batch.length;
    }
    updateProgress();
  }

  // Upsert salesperson_top_customers in batches
  for (let i = 0; i < salespersonRecords.length; i += BATCH_SIZE) {
    const batch = salespersonRecords.slice(i, i + BATCH_SIZE);
    if (batch.length === 0) continue;
    const { error } = await supabase
      .from('salesperson_top_customers')
      .upsert(batch, { onConflict: 'salesperson_name,customer_name' });
    if (error) {
      failedCount += batch.length;
    }
    updateProgress();
  }

  await supabase.from('upload_log').insert({
    file_type: 'sales_history',
    file_name: fileName,
    row_count: sourceRowCount,
    new_count: 0,
    updated_count: 0,
    status: failedCount > 0 ? 'completed_with_errors' : 'completed',
  });

  return {
    processed: sourceRowCount,
    total: sourceRowCount,
    newCount: 0,
    updatedCount: 0,
    batchIndex: totalBatches,
    totalBatches,
    failedCount,
  };
}

