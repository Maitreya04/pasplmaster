import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')

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

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: imageBase64
                }
              },
              {
                text: `You are verifying a warehouse product pick.

Expected item from order: "${expectedItem.name}"
Expected alias code: "${expectedItem.alias1 || 'N/A'}"
Expected MRP: "${expectedItem.mrp || 'N/A'}"

Look at this product photo and extract:
1. Any part numbers, model codes, or product codes visible
2. Product description text
3. MRP/price if visible
4. Brand name

Then determine: Does this photo show the expected item?

Reply ONLY in this JSON format, no other text:
{
  "match": true/false,
  "confidence": 0-100,
  "extracted_code": "code from box",
  "extracted_description": "description from box",
  "extracted_mrp": "price from box",
  "extracted_brand": "brand from box",
  "reason": "brief explanation"
}`
              }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 300
          }
        })
      }
    )

    if (!response.ok) {
      const errText = await response.text()
      console.error('Gemini API error:', response.status, errText)
      return new Response(
        JSON.stringify({ match: false, confidence: 0, reason: `Gemini API error: ${response.status}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const data = await response.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'

    // Parse JSON from response (handle markdown code blocks)
    const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    let result
    try {
      result = JSON.parse(jsonStr)
    } catch {
      result = { match: false, confidence: 0, reason: 'Failed to parse AI response' }
    }

    return new Response(JSON.stringify(result), {
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
