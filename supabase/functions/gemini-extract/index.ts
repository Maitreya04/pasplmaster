import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { assertActiveStaff } from '../_shared/assertStaff.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL = 'gemini-2.5-flash';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ORDER_PROMPT = `You are reading a handwritten auto parts order from an Indian field salesperson.
Extract every line item. Return ONLY valid JSON, no markdown.
QUANTITY: "code — 02"=qty 2; stacked STD/OS=two items; "3 set"=qty 3 unit set; default qty 1.
Cancelled=strikethrough → is_cancelled true. Customer name from header/arrow.
Do not invent text. Return { "customer_name": string|null, "items": [{ "raw_text", "qty", "qty_unit", "is_cancelled" }] }`;

const INVOICE_PROMPT = `Extract supplier GST invoice lines for auto-parts receiving (India).
Per line capture qty (eaches), rate_per_ea (billing rate before GST — never MRP/list/retail),
part_no, description. Header: invoice_number, invoice_date as printed.
Only the main goods table. Ignore HSN/GST summaries/freight. Empty lines=[] if none.`;

const INVOICE_SCHEMA = {
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

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function parseModelText(raw: string): unknown {
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

async function callGemini(parts: unknown[], generationConfig: Record<string, unknown>) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
    },
  );
  const data = await res.json();
  return { res, data };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!GEMINI_API_KEY) return json(500, { error: 'GEMINI_API_KEY not configured' });

  const auth = await assertActiveStaff(req);
  if (!auth.ok) return json(auth.status, { error: auth.error });

  try {
    const body = await req.json();
    const mode = String(body.mode ?? '');

    if (mode === 'order') {
      const base64Image = String(body.base64Image ?? '');
      const mimeType = String(body.mimeType ?? 'image/jpeg');
      if (!base64Image) return json(400, { error: 'missing_image' });
      const { res, data } = await callGemini(
        [{ text: ORDER_PROMPT }, { inlineData: { mimeType, data: base64Image } }],
        { responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
      );
      if (!res.ok) return json(502, { error: 'gemini_failed', status: res.status, detail: data });
      const raw = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('').trim() ?? '';
      if (!raw) return json(200, { customer_name: null, items: [] });
      try {
        return json(200, parseModelText(raw));
      } catch {
        return json(200, { customer_name: null, items: [] });
      }
    }

    if (mode === 'invoice') {
      const pages = Array.isArray(body.base64Pages) ? body.base64Pages.map(String) : [];
      if (pages.length === 0) return json(200, { invoice_number: null, invoice_date: null, lines: [] });
      const { res, data } = await callGemini(
        [
          { text: INVOICE_PROMPT },
          ...pages.map((data: string) => ({ inlineData: { mimeType: 'image/jpeg', data } })),
        ],
        {
          temperature: 0,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: INVOICE_SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
        },
      );
      if (!res.ok) return json(502, { error: 'gemini_failed', status: res.status, detail: data });
      const raw = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('').trim() ?? '';
      if (!raw) return json(200, { invoice_number: null, invoice_date: null, lines: [] });
      try {
        return json(200, parseModelText(raw));
      } catch {
        return json(200, { invoice_number: null, invoice_date: null, lines: [] });
      }
    }

    return json(400, { error: 'invalid_mode' });
  } catch (error) {
    console.error('gemini-extract', error);
    return json(500, { error: 'internal_error' });
  }
});
