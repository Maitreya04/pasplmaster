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

    const normalizedPhone = String(phone).replace(/\D/g, '');
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
      'validate_invite_code',
      { p_code: invite_code },
    );

    if (validationError) {
      console.error('validate_invite_code failed', validationError);
      return jsonResponse({ error: 'validation_failed' }, 500);
    }

    if (!validation?.valid) {
      return jsonResponse({ error: validation?.error || 'invalid_code' }, 400);
    }

    const userId = validation.user_id as number;
    const email = `${normalizedPhone}@paspl.local`;

    const { data: existingPhone, error: phoneLookupError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (phoneLookupError) {
      console.error('phone lookup failed', phoneLookupError);
      return jsonResponse({ error: 'phone_lookup_failed' }, 500);
    }

    if (existingPhone) {
      return jsonResponse({ error: 'phone_already_used' }, 400);
    }

    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: normalizedPin,
      email_confirm: true,
      user_metadata: {
        full_name: validation.full_name,
        phone: normalizedPhone,
        role: validation.role,
        branch: validation.branch,
      },
    });

    if (authError || !authUser.user) {
      console.error('Auth creation failed', authError);
      return jsonResponse({ error: 'auth_creation_failed', detail: authError?.message }, 500);
    }

    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        auth_id: authUser.user.id,
        phone: normalizedPhone,
        activated_at: new Date().toISOString(),
        invite_code: null,
        invite_code_expires_at: null,
      })
      .eq('id', userId);

    if (updateError) {
      console.error('users update failed', updateError);
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      return jsonResponse({ error: 'user_update_failed' }, 500);
    }

    return jsonResponse({
      success: true,
      user_id: userId,
      full_name: validation.full_name,
      role: validation.role,
      branch: validation.branch,
      phone: normalizedPhone,
      message: 'Account activated. Sign in with your phone and PIN.',
    });
  } catch (error) {
    console.error('activate-user unexpected error', error);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
});
