import { supabase } from './supabase/client';

export type NotificationDiagnosticCheck = {
  id: string;
  ok: boolean;
  label: string;
  detail: string;
};

/**
 * Direct POST to the Edge Function URL — returns real HTTP status (404 = not deployed).
 * `supabase.functions.invoke` sometimes only reports "Failed to send a request" with empty context.
 */
async function probeEdgeFunctionHttp(): Promise<NotificationDiagnosticCheck> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!url || !key) {
    return {
      id: 'edge_function',
      ok: false,
      label: 'Edge function send-internal-notification',
      detail:
        'VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing in this build. Set both in Vercel → Environment Variables and redeploy.',
    };
  }

  const endpoint = `${url.replace(/\/$/, '')}/functions/v1/send-internal-notification`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        apikey: key,
      },
      body: JSON.stringify({ eventType: '__diagnostic_invalid__' }),
    });

    const text = await res.text();
    let snippet = text.slice(0, 200);
    if (snippet.length === 200) snippet += '…';

    if (res.status === 404) {
      return {
        id: 'edge_function',
        ok: false,
        label: 'Edge function send-internal-notification',
        detail: `HTTP 404 — this function is not deployed on the Supabase project used by this app.\n\nOpen Supabase Dashboard → Edge Functions. You should see \`send-internal-notification\`. If not, run:\n\nsupabase functions deploy send-internal-notification\n\nEndpoint tried:\n${endpoint}`,
      };
    }

    if (res.status === 400) {
      return {
        id: 'edge_function',
        ok: true,
        label: 'Edge function send-internal-notification',
        detail: `HTTP 400 (expected for test payload) — function is deployed and reachable.\n${snippet}`,
      };
    }

    if (res.status === 401 || res.status === 403) {
      return {
        id: 'edge_function',
        ok: false,
        label: 'Edge function send-internal-notification',
        detail: `HTTP ${res.status} — anon key may not match this project. Check VITE_SUPABASE_ANON_KEY in Vercel matches Dashboard → API.\n${snippet}`,
      };
    }

    if (res.status === 500) {
      return {
        id: 'edge_function',
        ok: false,
        label: 'Edge function send-internal-notification',
        detail: `HTTP 500 — function runs but failed (often missing VAPID or service role). Check Edge Function logs in Dashboard.\n${snippet}`,
      };
    }

    return {
      id: 'edge_function',
      ok: res.ok,
      label: 'Edge function send-internal-notification',
      detail: `HTTP ${res.status}: ${snippet}`,
    };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    return {
      id: 'edge_function',
      ok: false,
      label: 'Edge function send-internal-notification',
      detail: `Fetch failed: ${errMsg}\n\nTried: ${endpoint}\n\nREST works (table check above), so the Supabase URL is usually correct. Common causes: function not deployed (try direct URL in browser after deploy), VPN/ad-blocker, or iOS limiting cross-site requests.`,
    };
  }
}

/**
 * Read-only checks you can run from the app (anon key) to see why in-app notifications fail.
 */
export async function runNotificationDiagnostics(opts: {
  userId: number | null;
  userName: string | null;
  role: string | null;
}): Promise<NotificationDiagnosticCheck[]> {
  const checks: NotificationDiagnosticCheck[] = [];

  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  checks.push({
    id: 'vite_supabase_url',
    ok: !!baseUrl?.startsWith('https://'),
    label: 'Build VITE_SUPABASE_URL',
    detail: baseUrl
      ? `Loaded (${baseUrl.length} chars). Must match Supabase Dashboard → Project Settings → API → Project URL.`
      : 'MISSING — set in Vercel and redeploy.',
  });

  const isAdminNoPersona = opts.role === 'admin';
  checks.push({
    id: 'auth_user_id',
    ok: opts.userId != null || isAdminNoPersona,
    label: 'Session users.id',
    detail:
      opts.userId != null
        ? `userId=${opts.userId} (inbox queries use this)`
        : isAdminNoPersona
          ? 'N/A while on Admin — there is no `users.id` for this screen. Use Switch Role → Sales (or Billing/Picking), pick your name, then run checks again to test the notification bell.'
          : 'userId is null — the bell cannot load rows. Open Role select and pick your name (must match users.full_name for your role).',
  });

  checks.push({
    id: 'auth_name_role',
    ok: !!(opts.userName && opts.role) || isAdminNoPersona,
    label: 'Name & role',
    detail: isAdminNoPersona
      ? `admin — ${opts.userName ?? '(no name — expected on Admin)'}`
      : `${opts.role ?? '—'} / ${opts.userName ?? '—'}`,
  });

  const probe = await supabase.from('user_notifications').select('id').limit(1);
  const pe = probe.error;
  const tableMissing =
    pe != null &&
    (pe.code === '42P01' ||
      (typeof pe.message === 'string' && pe.message.toLowerCase().includes('does not exist')));

  checks.push({
    id: 'table_user_notifications',
    ok: pe == null,
    label: 'Table user_notifications',
    detail: pe
      ? tableMissing
        ? `Missing or unreachable (${pe.code ?? 'error'}). Apply migration 014 on this Supabase project.`
        : `${pe.code ?? 'error'}: ${pe.message}`
      : 'OK — table exists and SELECT is allowed.',
  });

  if (opts.userId != null && pe == null) {
    const { count, error: cErr } = await supabase
      .from('user_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', opts.userId);

    checks.push({
      id: 'row_count',
      ok: true,
      label: 'Rows for your userId',
      detail: cErr ? cErr.message : `${count ?? 0} notification(s) stored for you.`,
    });
  }

  checks.push(await probeEdgeFunctionHttp());

  checks.push({
    id: 'billing_path',
    ok: true,
    label: 'Billing: when is sales notified?',
    detail:
      'Only after Live Queue → Communicate → “Copy & Approve Order”. “Skip notification” does not call the sales update.',
  });

  return checks;
}
