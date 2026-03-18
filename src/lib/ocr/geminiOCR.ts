import { matchOcrToItem } from './ocrMatcher';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

export async function verifyWithGemini(
  imageBase64: string,
  expectedItem: { name: string; alias: string; alias1: string; mrp: number }
) {
  if (!API_KEY) return { isMatch: false, confidence: 0, extractedCode: '', extractedDescription: '', reason: 'API key not configured' };

  let data;
  let lastErrorMsg = '';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout
  
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
              { text: `Transcribe EVERY piece of legible text from this product label or packaging photo.
DO NOT SKIP ANY TEXT. Read every single word, number, and code you see, no matter how large, small, stylized, or randomly placed it is.
CRITICAL: Pay special attention to standalone codes (e.g. K6N, D32, 7157). These are part numbers, NOT decorative logos!
Be extremely precise with letters vs numbers (e.g. 0 vs O, 1 vs I, Z vs 2, 8 vs B).
Return ONLY the raw extracted text as plain text, preserving newlines. Do not add any conversational text or markdown formatting.` }
            ]}],
            generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
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
      
      break; // Success
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

  const extractedText = data.candidates[0]?.content?.parts?.[0]?.text || '';
  
  if (!extractedText.trim()) {
    console.error('Gemini returned no text. Full response:', data);
    return { isMatch: false, confidence: 0, extractedCode: '', extractedDescription: '', reason: 'Image blocked by safety filters or empty response' };
  }

  // Phase 2: Leverage our developed deterministic matching engine
  const matchResult = matchOcrToItem(
    extractedText,
    { item_name: expectedItem.name, item_alias: expectedItem.alias },
    expectedItem.mrp,
    null,
    expectedItem.alias1
  );

  return {
    isMatch: matchResult.isMatch,
    confidence: matchResult.confidence,
    extractedCode: matchResult.ocrExtracted.partNumber || extractedText.substring(0, 30).replace(/\n/g, ' '),
    extractedDescription: extractedText.substring(0, 100).replace(/\n/g, ' '),
    reason: matchResult.signals[0]?.detail || 'Matched by engine'
  };
}

export async function imageToBase64(file: File, maxWidth = 600): Promise<string> {
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
