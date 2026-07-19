import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const PASPL_AUTH_EMAIL_DOMAIN = 'paspl.local';

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '').slice(-10);
}

function phoneToAuthEmail(phone: string): string {
  return `${normalizePhone(phone)}@${PASPL_AUTH_EMAIL_DOMAIN}`;
}

async function assertAdminActor(
  supabaseAdmin: ReturnType<typeof createClient>,
  accessToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
  if (authError || !authData.user) {
    return { ok: false, error: 'unauthorized' };
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('auth_id', authData.user.id)
    .eq('role', 'admin')
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, error: 'unauthorized' };
  }

  return { ok: true };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  try {
    const body = await req.json();
    const action = String(body.action ?? '');
    const actorUserId = Number(body.actor_user_id);
    const targetUserId = Number(body.user_id);
    const authHeader = req.headers.get('Authorization') ?? '';
    const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!action || !Number.isFinite(actorUserId) || !Number.isFinite(targetUserId) || !accessToken) {
      return jsonResponse({ error: 'missing_fields' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'server_misconfigured' }, 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const adminCheck = await assertAdminActor(supabaseAdmin, accessToken);
    if (!adminCheck.ok) {
      return jsonResponse({ error: adminCheck.error }, 403);
    }

    const { data: targetUser, error: targetError } = await supabaseAdmin
      .from('users')
      .select('id, full_name, role, auth_id, phone, is_active')
      .eq('id', targetUserId)
      .maybeSingle();

    if (targetError || !targetUser) {
      return jsonResponse({ error: 'user_not_found' }, 404);
    }

    if (targetUser.role === 'admin') {
      return jsonResponse({ error: 'cannot_modify_admin' }, 403);
    }

    if (action === 'update_phone') {
      const normalizedPhone = normalizePhone(String(body.phone ?? ''));
      if (!/^\d{10}$/.test(normalizedPhone)) {
        return jsonResponse({ error: 'invalid_phone' }, 400);
      }

      if (!targetUser.auth_id) {
        return jsonResponse({ error: 'not_activated' }, 400);
      }

      const { data: existingPhone } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('phone', normalizedPhone)
        .neq('id', targetUserId)
        .maybeSingle();

      if (existingPhone) {
        return jsonResponse({ error: 'phone_already_used' }, 400);
      }

      const email = phoneToAuthEmail(normalizedPhone);
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
        targetUser.auth_id,
        {
          email,
          user_metadata: {
            phone: normalizedPhone,
          },
        },
      );

      if (authError) {
        console.error('auth update failed', authError);
        return jsonResponse({ error: 'auth_update_failed', detail: authError.message }, 500);
      }

      const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({ phone: normalizedPhone })
        .eq('id', targetUserId);

      if (updateError) {
        console.error('users phone update failed', updateError);
        return jsonResponse({ error: 'user_update_failed' }, 500);
      }

      return jsonResponse({ success: true, user_id: targetUserId, phone: normalizedPhone });
    }

    if (action === 'delete_auth_user') {
      const authId = String(body.auth_id ?? targetUser.auth_id ?? '');
      if (!authId) {
        return jsonResponse({ success: true, skipped: true });
      }

      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(authId);
      if (deleteError) {
        console.error('auth delete failed', deleteError);
        return jsonResponse({ error: 'auth_delete_failed', detail: deleteError.message }, 500);
      }

      return jsonResponse({ success: true, user_id: targetUserId, auth_id: authId });
    }

    return jsonResponse({ error: 'unknown_action' }, 400);
  } catch (error) {
    console.error('admin-update-user-auth unexpected error', error);
    return jsonResponse({ error: 'internal_error' }, 500);
  }
});
