import type { PackCatalogRow } from './buildPackCatalogRows';

const TEMPLATE_HEADERS = [
  'ItemGrp',
  'ItemmainGrp',
  'Itemname',
  'Part No.',
  'MAST.BOX',
  'INNER.BOX',
  'Individual',
] as const;

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function individualCsvToken(sellUnit: string | null | undefined): string {
  if (sellUnit === 'BOTH') return '1';
  if (sellUnit === 'PACK') return '0';
  return '';
}

export function packCatalogTemplateCsv(): string {
  return `${TEMPLATE_HEADERS.join(',')}\n`;
}

export function exportPackCatalogRowsCsv(rows: PackCatalogRow[]): string {
  const lines = [TEMPLATE_HEADERS.join(',')];
  for (const row of rows) {
    const parent = row.item.parent_group?.trim() ?? '';
    const main = row.item.main_group?.trim() ?? '';
    const partNo = row.item.alias1?.trim() || row.item.alias?.trim() || '';
    const cells = [
      parent || row.brand,
      main || row.brand,
      row.item.name,
      partNo,
      row.outerQty != null ? String(row.outerQty) : '',
      row.innerQty != null ? String(row.innerQty) : '',
      individualCsvToken(row.sellUnit),
    ].map((c) => csvEscape(c));
    lines.push(cells.join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Human summary for import result */
export function formatImportSummary(progress: {
  newCount: number;
  updatedCount: number;
  failedCount: number;
  processed: number;
  total: number;
  skippedNoPackQty?: number;
  fileRowCount?: number;
}): string {
  const saved = progress.updatedCount + progress.newCount;
  const parts = [`Saved ${saved} pack size${saved === 1 ? '' : 's'} from file`];
  if (progress.failedCount > 0) {
    parts.push(`${progress.failedCount} not matched to catalog`);
  }
  if (progress.skippedNoPackQty && progress.skippedNoPackQty > 0) {
    parts.push(
      `${progress.skippedNoPackQty} rows had empty MAST.BOX and INNER.BOX — edit those in the table`,
    );
  }
  return parts.join(' · ');
}
