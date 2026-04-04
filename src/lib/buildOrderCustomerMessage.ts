export type OrderCustomerShareLine = {
  name: string;
  qtyRequested: number;
  qtyShip: number;
  qtyPo: number;
};

const MAX_MESSAGE_CHARS = 3800;

/** Digits only for wa.me (no +). */
export function digitsOnlyMobile(m: string | null | undefined): string {
  if (!m) return '';
  return m.replace(/\D/g, '');
}

export function buildOrderCustomerMessage(params: {
  customerName: string;
  orderNumber: string;
  /** Human-readable date, e.g. locale date string */
  dateLabel: string;
  lines: OrderCustomerShareLine[];
}): string {
  const { customerName, orderNumber, dateLabel, lines } = params;

  let body = `Hi ${customerName},\n\n`;
  body += `Order ${orderNumber} — quantities as of ${dateLabel}.\n\n`;

  if (lines.length === 0) {
    body += '(No line items.)';
    return body.length > MAX_MESSAGE_CHARS ? body.slice(0, MAX_MESSAGE_CHARS) + '…' : body;
  }

  body += 'Items:\n';
  for (const line of lines) {
    const parts: string[] = [];
    if (line.qtyShip > 0) parts.push(`${line.qtyShip} shipping now`);
    if (line.qtyPo > 0) parts.push(`${line.qtyPo} on back-order / PO`);
    const detail = parts.length > 0 ? parts.join(', ') : 'see warehouse';
    body += `• ${line.name}: requested ${line.qtyRequested} — ${detail}\n`;
  }

  body += '\nThank you.';

  if (body.length > MAX_MESSAGE_CHARS) {
    return body.slice(0, MAX_MESSAGE_CHARS) + '…';
  }
  return body;
}

export function whatsappShareUrl(phoneDigits: string, text: string): string {
  const q = encodeURIComponent(text);
  return `https://wa.me/${phoneDigits}?text=${q}`;
}
