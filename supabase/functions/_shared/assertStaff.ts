import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

export type StaffAuth =
  | { ok: true; admin: SupabaseClient }
  | { ok: false; status: number; error: string };

/** Require Bearer user JWT of an active public.users row. Rejects bare anon key. */
export async function assertActiveStaff(req: Request): Promise<StaffAuth> {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey) return { ok: false, status: 500, error: 'server_misconfigured' };

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token || token === anonKey) return { ok: false, status: 401, error: 'unauthorized' };

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return { ok: false, status: 401, error: 'unauthorized' };

  const { data: staff, error } = await admin
    .from('users')
    .select('id')
    .eq('auth_id', authData.user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (error || !staff) return { ok: false, status: 403, error: 'forbidden' };

  return { ok: true, admin };
}
