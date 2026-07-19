import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  try {
    const { invite_code, phone, pin } = await req.json();

    if (!invite_code || !phone || !pin) {
      return jsonResponse({ error: 'missing_fields' }, 400);
    }

    const normalizedPhone = String(phone).replace(/\D/g, '').slice(-10);
    const normalizedPin = String(pin);

    if (!/^\d{10}$/.test(normalizedPhone)) {
      return jsonResponse({ error: 'invalid_phone' }, 400);
    }

    if (normalizedPin.length < 4 || normalizedPin.length > 6 || !/^\d+$/.test(normalizedPin)) {
      return jsonResponse({ error: 'pin_must_be_4_to_6_digits' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'server_misconfigured' }, 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: validation, error: validationError } = await supabaseAdmin.rpc(
      'validate_reset_code',
      { p_code: invite_code },
    );

    if (validationError) {
      console.error('validate_reset_code failed', validationError);
      return jsonResponse({ error: 'validation_failed' }, 500);
    }

    if (!validation?.valid) {
      return jsonResponse({ error: validation?.error || 'invalid_code' }, 400);
    }

    if (validation.phone !== normalizedPhone) {
      return jsonResponse({ error: 'phone_mismatch' }, 400);
    }

    const authId = validation.auth_id as string;
    const userId = validation.user_id as number;
    const resetId = typeof validation.reset_id === 'number' ? validation.reset_id as number : null;

    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(authId, {
      password: normalizedPin,
    });

    if (authError) {
      console.error('PIN update failed', authError);
      return jsonResponse({ error: 'pin_update_failed', detail: authError.message }, 500);
    }

    const { error: clearError } = await supabaseAdmin
      .from('users')
      .update({
        invite_code: null,
        invite_code_expires_at: null,
      })
      .eq('id', userId);

    if (clearError) {
      console.error('invite code clear failed', clearError);
    }

    if (resetId) {
      await supabaseAdmin.rpc('consume_reset_code', {
        p_reset_id: resetId,
      });
    }

    await supabaseAdmin.rpc('log_user_security_event', {
      p_actor_user_id: null,
      p_target_user_id: userId,
      p_event_type: 'pin_reset_completed',
      p_risk_level: 'warning',
      p_metadata: {
        reset_id: resetId,
        auth_id: authId,
      },
    });

    return jsonResponse({
      success: true,
      user_id: userId,
      full_name: validation.full_name,
      role: validation.role,
      branch: validation.branch,
      phone: normalizedPhone,
      message: 'PIN updated. Sign in with your phone and new PIN.',
    });
  } catch (error) {
    console.error('reset-user-pin unexpected error', error);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
});
