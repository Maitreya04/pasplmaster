import * as XLSX from 'xlsx';

export type DetectedFileType = 'items_price' | 'items_stock' | 'customers' | 'sales_plan' | 'unknown';

export interface DetectionResult {
  type: DetectedFileType;
  label: string;
  rowCount: number;
  headerRowIndex: number;
}

function getStringRow(data: unknown[][], rowIndex: number): string[] {
  if (rowIndex >= data.length || !Array.isArray(data[rowIndex])) return [];
  return (data[rowIndex] as unknown[]).map(c => String(c ?? '').trim());
}

function countDataRows(data: unknown[][], startRow: number): number {
  return data.slice(startRow).filter(
    r => Array.isArray(r) && r.some(c => c != null && String(c).trim() !== ''),
  ).length;
}

export function detectFileType(workbook: XLSX.WorkBook): DetectionResult {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Items / price file: scan first 10 rows for one that has both 'Name' and 'Sales Price'
  const scanLimit = Math.min(10, data.length);
  for (let i = 0; i < scanLimit; i++) {
    const row = getStringRow(data, i);
    if (row.includes('Name') && row.includes('Sales Price')) {
      return {
        type: 'items_price',
        label: 'Items / Price List',
        rowCount: countDataRows(data, i + 1),
        headerRowIndex: i,
      };
    }
    if (row.includes('Item Details') && row.includes('Rack No.')) {
      return {
        type: 'items_stock',
        label: 'Stock List',
        rowCount: countDataRows(data, i + 1),
        headerRowIndex: i,
      };
    }
  }

  // Customer file: row 1 (index 0) has 'Name' + 'Parent Group'
  const row1 = getStringRow(data, 0);
  if (row1.includes('Name') && row1.includes('Parent Group')) {
    return { type: 'customers', label: 'Customer List', rowCount: countDataRows(data, 1), headerRowIndex: 0 };
  }

  // Sales plan: first 5 rows contain "SATISHJI" or "Item Group" with multiple salesperson names
  const salesPlanNames = ['SATISHJI', 'HEMANTJI', 'MANKARJI', 'RAJUJI', 'GUDDU', 'REHAN', 'MANISH', 'HARDEEPJI'];
  const scan5 = Math.min(5, data.length);
  for (let i = 0; i < scan5; i++) {
    const row = getStringRow(data, i);
    const rowUpper = row.map(c => c.toUpperCase());
    if (rowUpper.some(c => c.includes('SATISHJI'))) {
      return { type: 'sales_plan', label: 'Sales Plan / Targets', rowCount: 0, headerRowIndex: -1 };
    }
    if (rowUpper.some(c => c.includes('ITEM GROUP'))) {
      const matchCount = salesPlanNames.filter(n => rowUpper.some(c => c.includes(n))).length;
      if (matchCount >= 2) {
        return { type: 'sales_plan', label: 'Sales Plan / Targets', rowCount: 0, headerRowIndex: -1 };
      }
    }
  }

  // Sales plan fallback: workbook has 4WF or 2Wf sheet
  const sheetNamesLower = workbook.SheetNames.map(s => s.toLowerCase());
  if (sheetNamesLower.includes('4wf') || sheetNamesLower.includes('2wf')) {
    return { type: 'sales_plan', label: 'Sales Plan / Targets', rowCount: 0, headerRowIndex: -1 };
  }

  return { type: 'unknown', label: 'Unknown file format', rowCount: 0, headerRowIndex: -1 };
}
