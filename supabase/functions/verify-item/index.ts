import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { assertActiveStaff } from '../_shared/assertStaff.ts'

/**
 * Photo AI verification was retired with Gemini removal.
 * Keep the function registered so old clients get a stable unavailable response
 * instead of a missing-function error. Deploy when convenient; not required for this PR.
 */
serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const auth = await assertActiveStaff(req)
    if (!auth.ok) {
      return new Response(
        JSON.stringify({ match: false, confidence: 0, reason: auth.error }),
        { status: auth.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        match: false,
        confidence: 0,
        reason: 'AI photo verification has been removed',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('verify-item error:', err)
    return new Response(
      JSON.stringify({ match: false, confidence: 0, reason: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
