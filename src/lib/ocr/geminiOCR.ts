const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

export async function verifyWithGemini(
  imageBase64: string,
  expectedItem: { name: string; alias: string; alias1: string; mrp: number }
) {
  if (!API_KEY) return { isMatch: false, confidence: 0, extractedCode: '', extractedDescription: '', reason: 'API key not configured' };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
          { text: `Warehouse product verification. Read this product label photo.

Expected item: "${expectedItem.name}"
Expected code: "${expectedItem.alias1}" or "${expectedItem.alias}"
Expected MRP: ${expectedItem.mrp}

Extract all part numbers, codes, description, MRP, brand from the photo.

Matching rules:
- Code "53064" on box matches "INEL53064" in DB (substring)
- Code "D 32" on box matches "P-D32" in DB (prefix stripped)
- Code "K6N" matches "TIDCK6N" (substring)
- Description keywords must overlap (HINO 6ETI on box = HINO 6ETI in DB)
- Size MUST match exactly: 0.25 vs 0.50 = WRONG ITEM
- Side MUST match: RH vs LH = WRONG ITEM
- NC vs non-NC = DIFFERENT ITEM

Reply ONLY as JSON, no markdown:
{"match":true,"confidence":95,"code":"code from box","description":"label description","reason":"brief explanation"}` }
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
      })
    }
  );

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  try {
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(cleaned);
    return {
      isMatch: result.match || false,
      confidence: result.confidence || 0,
      extractedCode: result.code || '',
      extractedDescription: result.description || '',
      reason: result.reason || ''
    };
  } catch {
    return { isMatch: false, confidence: 0, extractedCode: '', extractedDescription: text.substring(0, 100), reason: 'Parse error' };
  }
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
