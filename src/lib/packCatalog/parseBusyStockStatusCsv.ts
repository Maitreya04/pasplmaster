export interface BusyStockStatusRow {
  lineIndex: number;
  partNumber: string;
  description: string;
  stockQty: number;
  group: string;
  category: string;
}

export interface BusyStockStatusParseResult {
  rows: BusyStockStatusRow[];
  skippedZeroOrNegative: number;
  skippedInvalid: number;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}

function headerIndex(headers: string[], ...candidates: string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate);
    if (idx >= 0) return idx;
  }
  return -1;
}

function parseStockQty(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const qty = Number(trimmed.replace(/,/g, ''));
  if (!Number.isFinite(qty)) return null;
  return qty;
}

/**
 * Parse Busy stock status CSV (Part Number, Description, Stock Qty, Group, …).
 * Rows with stock qty ≤ 0 are excluded from the result.
 */
export function parseBusyStockStatusCsv(text: string): BusyStockStatusParseResult {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    return { rows: [], skippedZeroOrNegative: 0, skippedInvalid: 0 };
  }

  const headers = parseCsvLine(lines[0]);
  const partIdx = headerIndex(headers, 'part number', 'part no', 'partnumber', 'sku', 'item code');
  const descIdx = headerIndex(headers, 'description', 'desc', 'item name', 'itemname', 'name');
  const qtyIdx = headerIndex(headers, 'stock qty', 'stock quantity', 'qty', 'quantity', 'stock');
  const groupIdx = headerIndex(headers, 'group', 'parent group', 'main group');
  const categoryIdx = headerIndex(headers, 'category', 'item category');

  if (partIdx < 0 || qtyIdx < 0) {
    throw new Error('Expected Part Number and Stock Qty columns in CSV header');
  }

  const rows: BusyStockStatusRow[] = [];
  let skippedZeroOrNegative = 0;
  let skippedInvalid = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const partNumber = (cells[partIdx] ?? '').trim();
    if (!partNumber) {
      skippedInvalid += 1;
      continue;
    }

    const qty = parseStockQty(cells[qtyIdx] ?? '');
    if (qty == null) {
      skippedInvalid += 1;
      continue;
    }
    if (qty <= 0) {
      skippedZeroOrNegative += 1;
      continue;
    }

    rows.push({
      lineIndex: i + 1,
      partNumber,
      description: descIdx >= 0 ? (cells[descIdx] ?? '').trim() : '',
      stockQty: Math.floor(qty),
      group: groupIdx >= 0 ? (cells[groupIdx] ?? '').trim() : '',
      category: categoryIdx >= 0 ? (cells[categoryIdx] ?? '').trim() : '',
    });
  }

  return { rows, skippedZeroOrNegative, skippedInvalid };
}

export function busyStockStatusTotals(rows: BusyStockStatusRow[]): {
  skuCount: number;
  labelCount: number;
  byGroup: Record<string, { skus: number; labels: number }>;
} {
  const byGroup: Record<string, { skus: number; labels: number }> = {};
  let labelCount = 0;

  for (const row of rows) {
    labelCount += row.stockQty;
    const key = row.group.trim() || 'Ungrouped';
    const bucket = byGroup[key] ?? { skus: 0, labels: 0 };
    bucket.skus += 1;
    bucket.labels += row.stockQty;
    byGroup[key] = bucket;
  }

  return { skuCount: rows.length, labelCount, byGroup };
}
