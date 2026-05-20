const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

/** Gemini structured output schema (uppercase types per API). */
const INVOICE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    invoice_number: { type: 'STRING' },
    invoice_date: { type: 'STRING' },
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          part_no: { type: 'STRING' },
          description: { type: 'STRING' },
          qty: { type: 'NUMBER' },
          rate_per_ea: { type: 'NUMBER' },
        },
        required: ['qty'],
      },
    },
  },
  required: ['lines'],
} as const;

const INVOICE_PROMPT = `You extract data from supplier GST/tax invoices for auto parts (India). This feeds warehouse receiving.

## Priorities per line (what matters most)

For every merchandise row, the **two critical values** are:
1. **qty** — billed quantity to **receive** (pieces / eaches) from the invoice **Qty** column.
2. **rate_per_ea** — **supplier billing rate per unit** (INR), i.e. what we are billed per piece **before GST**.  
   Use columns named **Item Rate**, **Rate**, **Basic Rate**, **Billing Rate**, or equivalent — never substitute retail pricing.

Also capture identifiers for matching (secondary to qty + rate):
- **part_no** — item / catalog / part code column only (e.g. Item Code, TIDC Part No).
- **description** — description column text only; do not duplicate the full code string here if it is already part_no.

## Header (once)

Invoice number and invoice date near the title (e.g. Invoice No., Inv No). Copy date as printed (e.g. 09-MAY-26).

## Where to read lines

Only the **main numbered goods table** (Sl. No. 1, 2, 3…) with Qty and rate columns — not tax summaries.

## rate_per_ea (billing unit rate)

- Prefer the printed **unit billing rate** column for that row.
- Do **not** use line **Total**, GST-inclusive totals, or **Taxable Value** as rate_per_ea (unless you **derive** unit rate as Taxable Value ÷ qty when the rate cell is blank — 2 decimals).
- **Never** use **MRP**, **Max Retail Price**, **RSP**, **List Price**, or retail columns — ignore those columns entirely even if present.

## qty

Western digits. Must match the billed quantity for that line we expect to receive.

## IGNORE (no output rows)

HSN-only summaries, GST breakdown blocks, freight without SKU, amount in words, duplicate annex tables, invented lines.

If there is no line grid, lines: [].

Merge wrapped description lines for the same Sl.No into one description string.`;

interface GeminiTextPart {
  text?: string;
}

interface GeminiCandidate {
  content?: { parts?: GeminiTextPart[] };
}

interface GeminiGenerateContentResponse {
  candidates?: GeminiCandidate[];
}

function stripJsonFences(value: string): string {
  return value
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export interface ExtractedInvoiceLine {
  /** Supplier part / item code (for matching); optional if description suffices in OCR. */
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

const EMPTY: ExtractedSupplierInvoice = { invoice_number: null, invoice_date: null, lines: [] };

function emptyToNull(s: string | undefined | null): string | null {
  const t = (s ?? '').trim();
  return t.length === 0 ? null : t;
}

/** Drop invalid rows, strip noise, remove exact duplicate extractions. */
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

export async function extractSupplierInvoiceFromJpegPages(base64Pages: string[]): Promise<ExtractedSupplierInvoice> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('Missing VITE_GEMINI_API_KEY');
  }
  if (base64Pages.length === 0) return EMPTY;

  const imageParts = base64Pages.map((data) => ({
    inlineData: { mimeType: 'image/jpeg', data },
  }));

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: INVOICE_PROMPT }, ...imageParts],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
        responseSchema: INVOICE_RESPONSE_SCHEMA,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini invoice extraction failed: ${response.status} ${errorText}`);
  }

  const payload = (await response.json()) as GeminiGenerateContentResponse;
  const rawText =
    payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim() ?? '';

  if (!rawText) return EMPTY;

  try {
    const parsed = JSON.parse(stripJsonFences(rawText)) as ExtractedSupplierInvoice;
    const rawLines = Array.isArray(parsed.lines)
      ? parsed.lines.map((l) => ({
          part_no: emptyToNull(l.part_no as string | null | undefined),
          description: emptyToNull(l.description as string | null | undefined),
          qty: Number.isFinite(Number(l.qty)) ? Math.max(0, Number(l.qty)) : 0,
          rate_per_ea:
            l.rate_per_ea != null && Number.isFinite(Number(l.rate_per_ea))
              ? Number(l.rate_per_ea)
              : null,
        }))
      : [];
    const lines = sanitizeExtractedInvoiceLines(rawLines);
    return {
      invoice_number: emptyToNull(parsed.invoice_number as string | null | undefined),
      invoice_date: emptyToNull(parsed.invoice_date as string | null | undefined),
      lines,
    };
  } catch (e) {
    console.error('Invoice JSON parse failed', e, rawText);
    return EMPTY;
  }
}
