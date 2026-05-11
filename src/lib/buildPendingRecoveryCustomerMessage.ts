import { formatCustomerShareDate, whatsappPrefilledUrl } from './buildOrderCustomerMessage';

type AvailabilityLine = {
  name: string;
  qtyAvailable: number;
  qtyPending: number;
  coverage: 'full' | 'partial';
};

const DEFAULT_BUSINESS_NAME = 'Pathak Auto Sales';

function waBold(label: string): string {
  return `*${label}*`;
}

function waItalic(text: string): string {
  return `_${text}_`;
}

function lineText(line: AvailabilityLine): string {
  if (line.coverage === 'full') {
    return `• ${line.name}: qty *${line.qtyPending}* ready now`;
  }

  return `• ${line.name}: qty *${line.qtyAvailable}* ready now, *${line.qtyPending - line.qtyAvailable}* still pending`;
}

export function buildPendingRecoveryCustomerMessage(params: {
  customerName: string;
  date: Date;
  lines: AvailabilityLine[];
  businessName?: string;
}): string {
  const signature = (params.businessName?.trim() || DEFAULT_BUSINESS_NAME).trim();
  const dateStr = formatCustomerShareDate(params.date);
  const full = params.lines.filter((line) => line.coverage === 'full').map(lineText);
  const partial = params.lines.filter((line) => line.coverage === 'partial').map(lineText);
  const chunks: string[] = [
    `Hi ${params.customerName},`,
    '',
    `${waBold('Availability update:')} as of ${waItalic(dateStr)}.`,
    '',
  ];

  if (full.length > 0) {
    chunks.push(waBold('Available now:'), ...full, '');
  }

  if (partial.length > 0) {
    chunks.push(waBold('Partially available now:'), ...partial, '');
  }

  chunks.push(
    'Please let us know which items you want us to bill now.',
    '',
    'Thank you.',
    `— ${signature}`,
  );

  return chunks.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * Same as billing / cart: message prefilled, no phone in the URL — staff picks the chat in WhatsApp.
 * `phoneDigits` is kept for call-site compatibility and ignored.
 */
export function pendingRecoveryWhatsappUrl(_phoneDigits: string | null | undefined, text: string): string {
  return whatsappPrefilledUrl(text);
}
