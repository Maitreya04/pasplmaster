export type ParetoZone = 'A' | 'B' | 'C';

export interface ParetoPlanRow {
  rank: number;
  zone: ParetoZone;
  skuName: string;
  productGroup: string;
  labelCount: number;
}

function zoneFromRank(rank: number): ParetoZone {
  if (rank <= 10) return 'A';
  if (rank <= 40) return 'B';
  return 'C';
}

function skuTextFromCell(cell: Element): string {
  return (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Parse Lucas 80/20 Pareto label plan HTML (tables with rank, SKU, Labels columns).
 */
export function parseLucasParetoPlanHtml(html: string): ParetoPlanRow[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows: ParetoPlanRow[] = [];

  for (const tr of doc.querySelectorAll('table tbody tr')) {
    if (tr.classList.contains('total-row')) continue;

    const rankEl = tr.querySelector('td.rank');
    const skuEl = tr.querySelector('td.sku');
    const grpEl = tr.querySelector('td.grp');
    const labelsEl = tr.querySelector('.labels-big');
    if (!rankEl || !skuEl || !labelsEl) continue;

    const rank = Number.parseInt((rankEl.textContent ?? '').trim(), 10);
    const labelCount = Number.parseInt((labelsEl.textContent ?? '').trim(), 10);
    const skuName = skuTextFromCell(skuEl);
    if (!Number.isFinite(rank) || rank < 1 || !skuName) continue;
    if (!Number.isFinite(labelCount) || labelCount < 1) continue;

    rows.push({
      rank,
      zone: zoneFromRank(rank),
      skuName,
      productGroup: grpEl ? skuTextFromCell(grpEl) : '',
      labelCount,
    });
  }

  rows.sort((a, b) => a.rank - b.rank);
  return rows;
}

export function paretoPlanTotals(rows: ParetoPlanRow[]): {
  skuCount: number;
  labelCount: number;
  byZone: Record<ParetoZone, { skus: number; labels: number }>;
} {
  const byZone: Record<ParetoZone, { skus: number; labels: number }> = {
    A: { skus: 0, labels: 0 },
    B: { skus: 0, labels: 0 },
    C: { skus: 0, labels: 0 },
  };
  let labelCount = 0;
  for (const row of rows) {
    labelCount += row.labelCount;
    byZone[row.zone].skus += 1;
    byZone[row.zone].labels += row.labelCount;
  }
  return { skuCount: rows.length, labelCount, byZone };
}
