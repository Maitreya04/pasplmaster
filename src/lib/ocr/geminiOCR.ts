// Removed matchOcrToItem import as matching is now handled entirely via LLM JSON output

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
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [
              { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
              { text: `You are an expert warehouse inventory verifier for Pathak Auto Sales, an auto parts distributor in Indore. You verify picked items by reading product labels.

TASK: Read this product photo and verify if it matches the expected item.

EXPECTED ITEM FROM ORDER:
- Name: "${expectedItem.name}"
- Code (alias): "${expectedItem.alias || ''}"  
- Code (alias1): "${expectedItem.alias1 || ''}"
- MRP: ₹${expectedItem.mrp || ''}

YOUR KNOWLEDGE OF THIS INDUSTRY:
- Alias1 codes are internal DB codes, NOT manufacturer codes. Example: "INEL53064" is our code, box shows "53064"
- Brand prefixes in alias1: INEL=Lucas/INEL, TIDC=Diamond/TIDC, ASK=ASK, SH/SM=Suprajit, U2/UP/UR=USHA/Shriram, FOIL/FOAM=Varroc, TE/SW=TAFE/Swaraj, KV=Rane, G=Banco, EV=EVA, BB/BM/BW=KSPG
- USHA products: box has manufacturer part no (S75 NC, NC 332, P-D32) which does NOT appear in our alias1. Match by description keywords instead.
- Prefix stripping: "P-D32" on our alias means "D32" is the core code. "Control No. D 32" on box = same item.
- TIDC chains: our code "TIDCK6N" means the box will show "K6N". "TIDCK6ND" = "K6N DURO" variant.

CRITICAL VARIANT RULES (wrong variant = WRONG ITEM):
- Size: 0.25, 0.50, 0.75, 1.00, STD — must match exactly
- Side: RH vs LH — must match exactly  
- Cover: NC (new cover) vs non-NC — different items
- Emission: BS3/BS4/BS6/BSVI — must match
- DURO vs non-DURO — different chain variant
- Front(F) vs Rear(R) — different items

Read the photo. Extract all visible text, codes, and numbers. Then reason:
1. What brand is this product?
2. What part number/code is on the label?
3. What vehicle/description is shown?
4. What size/variant indicators are present?
5. Does this match the expected item considering prefix stripping and keyword overlap?

Reply ONLY as JSON:
{"match":true/false,"confidence":0-100,"code":"code from label","description":"product description from label","mrp":"price if visible","variant_check":"size/side/NC status found","reason":"one line explanation"}` }
            ]}],
            generationConfig: { temperature: 0.1, maxOutputTokens: 400, thinkingConfig: { thinkingBudget: 200 } }
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

  try {
    const jsonStr = extractedText.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(jsonStr);
    return {
      isMatch: result.match,
      confidence: result.confidence,
      extractedCode: result.code || '',
      extractedDescription: result.description || '',
      reason: result.reason || 'AI Verified'
    };
  } catch (err) {
    console.error("Gemini output was not valid JSON:", extractedText);
    return {
      isMatch: false,
      confidence: 0,
      extractedCode: '',
      extractedDescription: '',
      reason: `Failed to parse AI response. Raw: ${extractedText.substring(0, 100)}`
    };
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
