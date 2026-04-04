export type OrderCustomerShareLine = {
  name: string;
  qtyRequested: number;
  qtyShip: number;
  qtyPo: number;
  /** If set, listed under *Pending* (e.g. cannot source). */
  qtyUnavailable?: number;
};

const MAX_MESSAGE_CHARS = 3800;

const DEFAULT_BUSINESS_NAME = 'Pathak Auto Sales';

/** WhatsApp: *bold* */
function waBold(label: string): string {
  return `*${label}*`;
}

/** WhatsApp: _italic_ */
function waItalic(text: string): string {
  return `_${text}_`;
}

/** e.g. 4th Apr 2026 — readable in customer copy / WhatsApp */
export function formatCustomerShareDate(d: Date): string {
  const day = d.getDate();
  const month = d.toLocaleDateString('en-IN', { month: 'short' });
  const year = d.getFullYear();
  return `${ordinalDay(day)} ${month} ${year}`;
}

function ordinalDay(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** One line: bullet, name, literal "qty" then bold number (WhatsApp-friendly). */
function formatItemLine(productName: string, qty: number): string {
  return `• ${productName}: qty *${qty}*`;
}

function appendBlock(out: string[], heading: string, bullets: string[]): void {
  if (bullets.length === 0) return;
  out.push(waBold(heading), ...bullets, '');
}

/** Digits only for wa.me (no +). */
export function digitsOnlyMobile(m: string | null | undefined): string {
  if (!m) return '';
  return m.replace(/\D/g, '');
}

export function buildOrderCustomerMessage(params: {
  customerName: string;
  /** Snapshot time for “as of” copy (captured when submit starts). */
  date: Date;
  lines: OrderCustomerShareLine[];
  /** Shown after "Thank you." — omit to use default or `VITE_BUSINESS_DISPLAY_NAME` from caller */
  businessName?: string;
}): string {
  const { customerName, date, lines, businessName } = params;
  const signatureName = (businessName?.trim() || DEFAULT_BUSINESS_NAME).trim();
  const dateStr = formatCustomerShareDate(date);

  const chunks: string[] = [];

  chunks.push(`Hi ${customerName},`, '');
  chunks.push(`${waBold('Order update:')} billed items as of ${waItalic(dateStr)}.`, '');

  if (lines.length === 0) {
    chunks.push('(No line items.)', '', 'Thank you.', `— ${signatureName}`);
    return finalizeMessage(chunks);
  }

  const billed: string[] = [];
  const pending: string[] = [];

  for (const line of lines) {
    if (line.qtyShip > 0) billed.push(formatItemLine(line.name, line.qtyShip));
    if (line.qtyPo > 0) pending.push(formatItemLine(line.name, line.qtyPo));
    const u = line.qtyUnavailable ?? 0;
    if (u > 0) pending.push(formatItemLine(line.name, u));
  }

  appendBlock(chunks, 'Billed:', billed);
  appendBlock(chunks, 'Pending:', pending);

  if (billed.length === 0 && pending.length === 0) {
    chunks.push('(No quantities to report.)');
  }

  chunks.push('Thank you.', `— ${signatureName}`);

  return finalizeMessage(chunks);
}

function finalizeMessage(chunks: string[]): string {
  const body = chunks.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  if (body.length <= MAX_MESSAGE_CHARS) return body;
  return `${body.slice(0, MAX_MESSAGE_CHARS - 1)}…`;
}

/**
 * Opens WhatsApp (app or web) with the message prefilled. No phone in the URL — the user picks
 * the customer chat (search party) and sends. Best default for counter staff.
 */
export function whatsappPrefilledUrl(text: string): string {
  const q = encodeURIComponent(text);
  return `https://wa.me/?text=${q}`;
}

/** Opens WhatsApp directly to one number (digits only, country code, no +). */
export function whatsappShareUrl(phoneDigits: string, text: string): string {
  const q = encodeURIComponent(text);
  return `https://wa.me/${phoneDigits}?text=${q}`;
}
