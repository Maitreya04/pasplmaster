import { matchOcrToItem, type GeminiExtraction } from './ocrMatcher';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const GEMINI_MODEL = 'gemini-2.5-flash-lite';

const PROMPT = `Read this Indian auto-parts product label photo. Extract ALL text you can see.
Part numbers follow labels like "Part No", "Control No", or are standalone codes.
Brand names: USHA, ASK, Diamond, Lucas TVS, Suprajit, KSPG, Varroc, Shriram, Rane.
Distinguish 0/O, 1/I, S/5, G/6, B/8, Z/2.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT' as const,
  properties: {
    part_numbers: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
    product_type: { type: 'STRING' as const },
    brand: { type: 'STRING' as const },
    vehicle_models: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
    mrp: { type: 'NUMBER' as const },
    size_variant: { type: 'STRING' as const },
    emission_standard: { type: 'STRING' as const },
    other_variants: { type: 'ARRAY' as const, items: { type: 'STRING' as const } },
    raw_text: { type: 'STRING' as const },
  },
  required: ['part_numbers', 'product_type', 'brand', 'vehicle_models', 'raw_text'],
};

function safeExtraction(parsed: Record<string, unknown>): GeminiExtraction {
  const mrpRaw = parsed.mrp;
  let mrp: number | null = null;
  if (typeof mrpRaw === 'number' && mrpRaw > 0) mrp = mrpRaw;
  else if (typeof mrpRaw === 'string') mrp = parseFloat(mrpRaw.replace(/,/g, '')) || null;

  return {
    part_numbers: Array.isArray(parsed.part_numbers) ? parsed.part_numbers.map(String) : [],
    product_type: typeof parsed.product_type === 'string' ? parsed.product_type : '',
    brand: typeof parsed.brand === 'string' ? parsed.brand : '',
    vehicle_models: Array.isArray(parsed.vehicle_models) ? parsed.vehicle_models.map(String) : [],
    mrp,
    size_variant: typeof parsed.size_variant === 'string' ? parsed.size_variant : '',
    emission_standard: typeof parsed.emission_standard === 'string' ? parsed.emission_standard : '',
    other_variants: Array.isArray(parsed.other_variants) ? parsed.other_variants.map(String) : [],
    raw_text: typeof parsed.raw_text === 'string' ? parsed.raw_text : '',
  };
}

function parseGeminiResponse(text: string): GeminiExtraction | null {
  const candidates = [
    text.trim(),
    text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim(),
    (text.match(/\{[\s\S]*\}/) ?? [''])[0],
  ];

  for (const raw of candidates) {
    if (!raw || !raw.startsWith('{')) continue;
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') return safeExtraction(obj);
    } catch { /* next */ }
  }
  return null;
}

export async function verifyWithGemini(
  imageBase64: string,
  expectedItem: { name: string; alias: string; alias1: string; mrp: number; mainGroup?: string; parentGroup?: string }
) {
  if (!API_KEY) return { isMatch: false, confidence: 0, extractedCode: '', extractedDescription: '', reason: 'API key not configured' };

  const t0 = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  let data: any;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [
              { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
              { text: PROMPT },
            ]}],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 1024,
              responseMimeType: 'application/json',
              responseSchema: RESPONSE_SCHEMA,
            },
          }),
        }
      );
      data = await res.json();

      if (data.error) {
        if ((res.status === 503 || res.status === 429) && attempt < 2) {
          await new Promise(r => setTimeout(r, 800));
          continue;
        }
        clearTimeout(timeoutId);
        return { isMatch: false, confidence: 0, extractedCode: '', extractedDescription: '', reason: `API Error: ${data.error.message}` };
      }
      break;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        return { isMatch: false, confidence: 0, extractedCode: '', extractedDescription: '', reason: 'Timeout — verify manually' };
      }
      if (attempt === 2) {
        return { isMatch: false, confidence: 0, extractedCode: '', extractedDescription: '', reason: 'Network error' };
      }
      await new Promise(r => setTimeout(r, 500));
    }
  }
  clearTimeout(timeoutId);

  if (!data?.candidates) {
    return { isMatch: false, confidence: 0, extractedCode: '', extractedDescription: '', reason: 'Empty API response' };
  }

  // Handle both regular and thinking-model response shapes
  const parts: Array<{ text?: string; thought?: boolean }> =
    data.candidates[0]?.content?.parts ?? [];
  let rawResponse = '';
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].text && !parts[i].thought) { rawResponse = parts[i].text!; break; }
  }
  if (!rawResponse) rawResponse = parts[0]?.text || '';

  if (!rawResponse.trim()) {
    return { isMatch: false, confidence: 0, extractedCode: '', extractedDescription: '', reason: 'No text from AI' };
  }

  const apiMs = Math.round(performance.now() - t0);
  console.log(`Gemini ${GEMINI_MODEL} responded in ${apiMs}ms`);

  const extraction = parseGeminiResponse(rawResponse);
  const ocrInput: GeminiExtraction | string = extraction ?? rawResponse;

  const matchResult = matchOcrToItem(
    ocrInput,
    { item_name: expectedItem.name, item_alias: expectedItem.alias },
    expectedItem.mrp,
    expectedItem.mainGroup ?? null,
    expectedItem.alias1,
    expectedItem.parentGroup ?? null,
  );

  const totalMs = Math.round(performance.now() - t0);
  console.log(`Total verify: ${totalMs}ms (API: ${apiMs}ms, match: ${totalMs - apiMs}ms)`);

  const summarySignal = matchResult.signals.find(s => s.signal === 'summary');
  const reason = summarySignal?.detail || matchResult.signals.map(s => `${s.signal}:${s.score}`).join(', ');

  return {
    isMatch: matchResult.isMatch,
    confidence: matchResult.confidence,
    extractedCode: matchResult.ocrExtracted.partNumber || (extraction?.part_numbers[0] ?? ''),
    extractedDescription: extraction
      ? [extraction.brand, extraction.product_type, extraction.vehicle_models.join(', '), extraction.size_variant, extraction.emission_standard].filter(Boolean).join(' | ')
      : rawResponse.substring(0, 100).replace(/\n/g, ' '),
    reason,
  };
}

export async function imageToBase64(file: File, maxWidth = 640): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, maxWidth / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.filter = 'contrast(1.15)';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.65).split(',')[1]);
    };
    img.src = URL.createObjectURL(file);
  });
}
