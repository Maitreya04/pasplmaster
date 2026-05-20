import type { PurchaseLookupMaps } from '../import/purchasePoImporter';
import { resolvePurchasePartForInvoiceLine } from '../import/purchasePoImporter';
import type { PurchaseOrderLineRow } from '../../types/purchase';
import type { ExtractedInvoiceLine } from './invoiceExtract';

export interface InvoiceDraftRow {
  line_no: number;
  part_no_raw: string;
  description_raw: string;
  qty_billed: number;
  rate_per_ea: number | null;
  busy_code: number | null;
  purchase_order_line_id: number | null;
  /** Matched `items.name` when supplier code maps via busy_code / alias / alias1 (or fuzzy OCR). */
  resolved_item_name: string | null;
  /** Non-blocking hint (e.g. fuzzy OCR, matched via description). */
  resolution_warning: string | null;
}

/** Map OCR lines to catalog busy codes (same rules as Excel PO) and optionally to existing PO lines by busy_code. */
export function buildInvoiceDraftRows(
  extracted: ExtractedInvoiceLine[],
  maps: PurchaseLookupMaps,
  poLines: PurchaseOrderLineRow[],
): InvoiceDraftRow[] {
  const poByBusy = new Map<number, PurchaseOrderLineRow>();
  for (const pl of poLines) {
    poByBusy.set(Number(pl.busy_code), pl);
  }

  return extracted.map((row, i) => {
    const partRaw = row.part_no?.trim() ?? '';
    const desc = row.description?.trim() ?? '';
    const res = resolvePurchasePartForInvoiceLine(partRaw, desc, maps);
    const poLine = res.busyCode != null ? poByBusy.get(res.busyCode) ?? null : null;
    return {
      line_no: i + 1,
      part_no_raw: partRaw || desc.slice(0, 80),
      description_raw: desc || partRaw,
      qty_billed: row.qty,
      rate_per_ea: row.rate_per_ea,
      busy_code: res.busyCode,
      purchase_order_line_id: poLine?.id ?? null,
      resolved_item_name: res.itemName,
      resolution_warning: res.warning,
    };
  });
}
