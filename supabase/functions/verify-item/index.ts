import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const GEMINI_FAST_MODEL = 'gemini-2.5-flash'
const GEMINI_ACCURATE_MODEL = 'gemini-2.5-pro'

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    match: { type: 'BOOLEAN' },
    confidence: { type: 'NUMBER' },
    extracted_code: { type: 'STRING' },
    extracted_description: { type: 'STRING' },
    extracted_mrp: { type: 'STRING' },
    extracted_brand: { type: 'STRING' },
    reason: { type: 'STRING' },
  },
  required: ['match', 'confidence', 'reason'],
} as const

async function callGemini(model: string, imageBase64: string, expectedItem: any) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: imageBase64,
              },
            },
            {
              text: `You are verifying a warehouse product pick.

Expected item from order: "${expectedItem.name}"
Expected alias code: "${expectedItem.alias1 || 'N/A'}"
Expected MRP: "${expectedItem.mrp || 'N/A'}"

Task:
- Read the product label and extract any visible codes (part no / model / control no), brand, description, and MRP.
- Disambiguate 0/O, 1/I, S/5, G/6, B/8, Z/2.
- Decide if the photo matches the expected item.

Return ONLY JSON that matches this schema.`,
            },
          ],
        }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 350,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    },
  )

  const data = await res.json()
  return { res, data }
}

serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (!GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ match: false, confidence: 0, reason: 'GEMINI_API_KEY not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const { imageBase64, expectedItem } = await req.json()

    if (!imageBase64 || !expectedItem) {
      return new Response(
        JSON.stringify({ match: false, confidence: 0, reason: 'Missing imageBase64 or expectedItem' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fast-first; fallback to more accurate model only when needed.
    const { res: fastRes, data: fastData } = await callGemini(GEMINI_FAST_MODEL, imageBase64, expectedItem)
    if (!fastRes.ok) {
      console.error('Gemini API error:', fastRes.status, JSON.stringify(fastData))
      return new Response(
        JSON.stringify({ match: false, confidence: 0, reason: `Gemini API error: ${fastRes.status}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const fastText = fastData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
    let fastResult: any
    try {
      fastResult = typeof fastText === 'string' ? JSON.parse(fastText) : fastText
    } catch {
      fastResult = { match: false, confidence: 0, reason: 'Failed to parse AI response' }
    }

    const confidence = typeof fastResult?.confidence === 'number' ? fastResult.confidence : 0
    const needsFallback =
      confidence < 55 ||
      (!fastResult?.match && confidence < 75) ||
      (!fastResult?.extracted_code && !fastResult?.extracted_description)

    if (!needsFallback) {
      return new Response(JSON.stringify(fastResult), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { res: accRes, data: accData } = await callGemini(GEMINI_ACCURATE_MODEL, imageBase64, expectedItem)
    if (!accRes.ok) {
      // If fallback fails, return the fast result (best effort).
      console.error('Gemini fallback error:', accRes.status, JSON.stringify(accData))
      return new Response(JSON.stringify(fastResult), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const accText = accData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
    let accResult: any
    try {
      accResult = typeof accText === 'string' ? JSON.parse(accText) : accText
    } catch {
      accResult = fastResult
    }

    return new Response(JSON.stringify(accResult), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('verify-item error:', err)
    return new Response(
      JSON.stringify({ match: false, confidence: 0, reason: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
