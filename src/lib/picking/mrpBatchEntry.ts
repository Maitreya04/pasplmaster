export type PickMrpBatchValidation =
  | {
      ok: true;
      price: number;
      qty: number;
    }
  | {
      ok: false;
      error: string;
    };

function parseWholeNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
}

export function validatePickMrpBatchInput(options: {
  priceInput: string;
  qtyInput: string;
  remainingQty: number;
}): PickMrpBatchValidation {
  const price = parseWholeNumber(options.priceInput);
  if (price == null || price <= 0) {
    return { ok: false, error: 'Enter the price printed on the label.' };
  }

  const qty = parseWholeNumber(options.qtyInput);
  if (qty == null || qty <= 0) {
    return { ok: false, error: 'Enter how many pieces you picked at this price.' };
  }

  if (qty > options.remainingQty) {
    return { ok: false, error: `Only ${options.remainingQty} pcs left on this line.` };
  }

  return { ok: true, price, qty };
}
