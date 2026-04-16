// Calls Gemini directly from the browser to extract handwritten order lines as raw JSON.
import type { GeminiRawOrder } from './types';

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const EXTRACTION_PROMPT = `You are reading a handwritten auto parts order from an Indian field salesperson.

Extract every line item. Return ONLY valid JSON, no markdown, no explanation.

QUANTITY RULES:
- "code — 02" or "code - 02" = qty 2
- Two numbers stacked vertically after the same item code mean two sizes ordered separately (first = STD qty, second = OS/oversize qty) → treat as TWO separate items with the same raw_text but append " STD" and " OS"
- "3 set" or "३ सेट" = qty 3, unit = set
- "N-et" suffix after qty = unit is net/pcs
- Fraction written as top/bottom (e.g. 10 over 02) = qty is the top number; if bottom number differs it is pack size, NOT a second qty
- Default qty = 1 if no qty is visible

MULTI-ITEM SAME LINE:
- If two codes appear side by side with separate quantities below each, treat as TWO separate items

CANCELLED ITEMS:
- If a line has a visible strikethrough, set is_cancelled: true

CUSTOMER NAME:
- Usually the first line or a header. An arrow (→) pointing to a name means the same customer continues. Extract name only, not a line item.

DO NOT match codes to products. DO NOT interpret abbreviations.
DO NOT add any text not present in the image.

Return: { "customer_name": string | null, "items": [{ "raw_text": string, "qty": number, "qty_unit": string, "is_cancelled": boolean }] }`;

const EMPTY_ORDER: GeminiRawOrder = { customer_name: null, items: [] };

interface GeminiTextPart {
  text?: string;
}

interface GeminiContent {
  parts?: GeminiTextPart[];
}

interface GeminiCandidate {
  content?: GeminiContent;
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

export async function extractOrderFromImage(
  base64Image: string,
  mimeType: string,
): Promise<GeminiRawOrder> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('Missing VITE_GEMINI_API_KEY');
  }

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: EXTRACTION_PROMPT },
            { inlineData: { mimeType, data: base64Image } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 404) {
      throw new Error(
        `Gemini model endpoint not found (404). Check the current Google model name for this API key. Response: ${errorText}`,
      );
    }
    throw new Error(`Gemini extraction failed with status ${response.status}: ${errorText}`);
  }

  const payload = (await response.json()) as GeminiGenerateContentResponse;
  const rawText = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim() ?? '';

  if (!rawText) {
    return EMPTY_ORDER;
  }

  try {
    return JSON.parse(stripJsonFences(rawText)) as GeminiRawOrder;
  } catch (error) {
    console.error('Failed to parse Gemini OCR response:', error, rawText);
    return EMPTY_ORDER;
  }
}
