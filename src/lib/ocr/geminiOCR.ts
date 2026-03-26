import { matchOcrToItem, type GeminiExtraction } from './ocrMatcher';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const STRUCTURED_PROMPT = `You are an expert at reading Indian auto-parts product labels and packaging.
Extract structured information from this product label/packaging photo.

CRITICAL RULES:
- Read EVERY piece of text, no matter how small, stylized, or randomly placed.
- Part numbers are often standalone codes like K6N, D32, S75, 7157, SHH0120, ASK/NA/BS/00002, 26046091, PC.217.7.18.003
- Be precise: distinguish 0 vs O, 1 vs I, Z vs 2, 8 vs B, S vs 5, G vs 6
- MRP is always in Indian Rupees (Rs. or ₹)
- "Part No", "Control No", "Product/Part No" labels precede part numbers
- Brand names: USHA, ASK, Diamond, Lucas TVS, Suprajit, KSPG, Varroc, Shriram, Rane
- Common product types: PISTON ASSEMBLY, BRAKE SHOE, CLUTCH SHOE, ENGINE VALVE, CAM CHAIN, CHAIN KIT, STARTER MOTOR, PISTON RINGS, CLUTCH CABLE, CAM BUSH, BEARING

Return ONLY valid JSON (no markdown, no backticks, no commentary):
{
  "part_numbers": ["every part/model/control number visible on label"],
  "product_type": "the product category, e.g. PISTON ASSEMBLY, BRAKE SHOE",
  "brand": "brand name visible",
  "vehicle_models": ["vehicle names, e.g. HONDA ACTIVA, HERO SPLENDOR"],
  "mrp": 0,
  "size_variant": "e.g. STD, 0.25, 0.50, 104.00mm or empty string",
  "emission_standard": "e.g. BS3, BS4, BS6 or empty string",
  "other_variants": ["NC", "DURO", "HET", "FRONT", "REAR", "RH", "LH", "F&R", "NM"],
  "raw_text": "ALL visible text transcribed verbatim preserving layout"
}`;

function parseGeminiJson(text: string): GeminiExtraction | null {
  const cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      part_numbers: Array.isArray(parsed.part_numbers) ? parsed.part_numbers.map(String) : [],
      product_type: typeof parsed.product_type === 'string' ? parsed.product_type : '',
      brand: typeof parsed.brand === 'string' ? parsed.brand : '',
      vehicle_models: Array.isArray(parsed.vehicle_models) ? parsed.vehicle_models.map(String) : [],
      mrp: typeof parsed.mrp === 'number' ? parsed.mrp : (typeof parsed.mrp === 'string' ? parseFloat(parsed.mrp.replace(/,/g, '')) || null : null),
      size_variant: typeof parsed.size_variant === 'string' ? parsed.size_variant : '',
      emission_standard: typeof parsed.emission_standard === 'string' ? parsed.emission_standard : '',
      other_variants: Array.isArray(parsed.other_variants) ? parsed.other_variants.map(String) : [],
      raw_text: typeof parsed.raw_text === 'string' ? parsed.raw_text : '',
    };
  } catch {
    console.warn('Failed to parse Gemini JSON, falling back to raw text extraction');
    return null;
  }
}

export async function verifyWithGemini(
  imageBase64: string,
  expectedItem: { name: string; alias: string; alias1: string; mrp: number; mainGroup?: string; parentGroup?: string }
) {
  if (!API_KEY) return { isMatch: false, confidence: 0, extractedCode: '', extractedDescription: '', reason: 'API key not configured' };

  let data;
  let lastErrorMsg = '';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [
              { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
              { text: STRUCTURED_PROMPT }
            ]}],
            generationConfig: { temperature: 0.1, maxOutputTokens: 800 }
          })
        }
      );

      data = await res.json();

      if (data.error) {
        lastErrorMsg = data.error.message;
        if (res.status === 503 || res.status === 429) {
          console.warn(`Gemini API overload (attempt ${attempt}/3). Retrying...`);
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }
        console.error('Gemini API Error:', data.error);
        clearTimeout(timeoutId);
        return { isMatch: false, confidence: 0, extractedCode: '', extractedDescription: '', reason: `API Error: ${data.error.message}` };
      }

      break;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { isMatch: false, confidence: 0, extractedCode: '', extractedDescription: '', reason: 'Timeout — verify manually' };
      }
      lastErrorMsg = err.message;
      if (attempt === 3) {
        clearTimeout(timeoutId);
        return { isMatch: false, confidence: 0, extractedCode: '', extractedDescription: '', reason: 'Failed to access API' };
      }
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }

  clearTimeout(timeoutId);

  if (!data || !data.candidates || data.error) {
    return { isMatch: false, confidence: 0, extractedCode: '', extractedDescription: '', reason: `API Error: ${lastErrorMsg || 'Exhausted retries'}` };
  }

  const rawResponse = data.candidates[0]?.content?.parts?.[0]?.text || '';

  if (!rawResponse.trim()) {
    console.error('Gemini returned no text. Full response:', data);
    return { isMatch: false, confidence: 0, extractedCode: '', extractedDescription: '', reason: 'Image blocked by safety filters or empty response' };
  }

  console.log('Gemini raw response:', rawResponse.substring(0, 200));

  // Try structured JSON parsing first, fall back to raw text
  const extraction = parseGeminiJson(rawResponse);
  const ocrInput: GeminiExtraction | string = extraction ?? rawResponse;

  const matchResult = matchOcrToItem(
    ocrInput,
    { item_name: expectedItem.name, item_alias: expectedItem.alias },
    expectedItem.mrp,
    expectedItem.mainGroup ?? null,
    expectedItem.alias1,
    expectedItem.parentGroup ?? null,
  );

  const summarySignal = matchResult.signals.find(s => s.signal === 'summary');
  const reason = summarySignal?.detail || matchResult.signals.map(s => `${s.signal}:${s.score}`).join(', ');

  return {
    isMatch: matchResult.isMatch,
    confidence: matchResult.confidence,
    extractedCode: matchResult.ocrExtracted.partNumber || (extraction?.part_numbers[0] ?? rawResponse.substring(0, 30).replace(/\n/g, ' ')),
    extractedDescription: extraction
      ? `${extraction.product_type} | ${extraction.brand} | ${extraction.vehicle_models.join(', ')}`
      : rawResponse.substring(0, 100).replace(/\n/g, ' '),
    reason,
  };
}

export async function imageToBase64(file: File, maxWidth = 800): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, maxWidth / img.width);
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.7).split(',')[1]);
    };
    img.src = URL.createObjectURL(file);
  });
}
