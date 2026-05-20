import type { ItemBarcodeResolveRow, ReceivingTriggeredBy, SupplierCodeStatus } from '../../types/receiving';

export interface ResolveSupplierInput {
  barcodeRows: ItemBarcodeResolveRow[];
  preferredSupplierType?: string | null;
  triggeredBy?: ReceivingTriggeredBy;
}

export interface ResolveSupplierResult {
  status: SupplierCodeStatus;
  code: string | null;
  selected: ItemBarcodeResolveRow | null;
  candidates: ItemBarcodeResolveRow[];
}

function normManufacturer(m: string | null | undefined): string {
  return m?.trim().toUpperCase() ?? '';
}

function mfrBoost(pref: string | null, mfr: string): number {
  if (!pref || !mfr) return 0;
  if (mfr === pref) return 2;
  if (mfr.includes(pref) || pref.includes(mfr)) return 1;
  return 0;
}

/** Prefer manufacturer match, then newest mapped_at. MULTIPLE if top score shared by >1 row. */
export function resolveSupplier(args: ResolveSupplierInput): ResolveSupplierResult {
  const { barcodeRows, preferredSupplierType } = args;
  const pref = normManufacturer(preferredSupplierType);

  if (barcodeRows.length === 0) {
    return { status: 'UNMAPPED', code: null, selected: null, candidates: [] };
  }

  const scored = barcodeRows.map((row) => {
    const mfr = normManufacturer(row.manufacturer);
    const boost = mfrBoost(pref || null, mfr);
    const ts = new Date(row.mapped_at).getTime();
    return { row, score: boost * 1e15 + ts };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]!.score;
  const winners = scored.filter((s) => s.score === top).map((s) => s.row);

  if (winners.length > 1) {
    const w0 = winners[0]!;
    return {
      status: 'MULTIPLE',
      code: w0.barcode_key || w0.barcode_raw,
      selected: w0,
      candidates: barcodeRows,
    };
  }

  const one = winners[0]!;
  return {
    status: 'MAPPED',
    code: one.barcode_key || one.barcode_raw,
    selected: one,
    candidates: barcodeRows,
  };
}

export function shouldBlockJobOnUnmapped(triggeredBy: ReceivingTriggeredBy, status: SupplierCodeStatus): boolean {
  return triggeredBy === 'INVOICE' && status !== 'MAPPED';
}
