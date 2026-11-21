/** Types and helpers for supplier invoice line drafts (manual / Excel flows). */

export interface ExtractedInvoiceLine {
  /** Supplier part / item code (for matching); optional if description suffices. */
  part_no: string | null;
  description: string | null;
  /** Billed quantity to receive (eaches). */
  qty: number;
  /** Supplier billing rate per unit before GST — never MRP / list / retail price. */
  rate_per_ea: number | null;
}

export interface ExtractedSupplierInvoice {
  invoice_number: string | null;
  invoice_date: string | null;
  lines: ExtractedInvoiceLine[];
}

function emptyToNull(s: string | undefined | null): string | null {
  const t = (s ?? '').trim();
  return t.length === 0 ? null : t;
}

/** Drop invalid rows, strip noise, remove exact duplicates. */
export function sanitizeExtractedInvoiceLines(lines: ExtractedInvoiceLine[]): ExtractedInvoiceLine[] {
  const seen = new Set<string>();
  const out: ExtractedInvoiceLine[] = [];

  for (const l of lines) {
    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const part_no = emptyToNull(l.part_no);
    const description = emptyToNull(l.description);
    if (!part_no && !description) continue;

    let rate_per_ea =
      l.rate_per_ea != null && Number.isFinite(Number(l.rate_per_ea)) ? Number(l.rate_per_ea) : null;
    if (rate_per_ea != null && rate_per_ea < 0) rate_per_ea = null;

    const dedupeKey = `${(part_no ?? '').toUpperCase()}|${(description ?? '').slice(0, 120)}|${qty}|${rate_per_ea ?? ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    out.push({
      part_no,
      description,
      qty,
      rate_per_ea,
    });
  }

  return out;
}
