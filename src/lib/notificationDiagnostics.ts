import { supabase } from './supabase/client';

export type NotificationDiagnosticCheck = {
  id: string;
  ok: boolean;
  label: string;
  detail: string;
};

function fnErrorStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { context?: { status?: number }; status?: number };
  if (typeof e.context?.status === 'number') return e.context.status;
  if (typeof e.status === 'number') return e.status;
  return null;
}

function formatFnError(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'object' && err !== null) {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e.message === 'string') parts.push(e.message);
    if (e.context != null) parts.push(JSON.stringify(e.context));
    if (e.cause != null) parts.push(String(e.cause));
    if (parts.length > 0) return parts.join(' ');
  }
  return String(err);
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

  const { error: fnErr } = await supabase.functions.invoke('send-internal-notification', {
    body: { eventType: '__diagnostic_invalid__' },
  });

  const status = fnErr ? fnErrorStatus(fnErr) : null;
  const msg = formatFnError(fnErr);

  if (fnErr == null) {
    checks.push({
      id: 'edge_function',
      ok: false,
      label: 'Edge function send-internal-notification',
      detail: 'Unexpected: invalid payload returned no error — check function code.',
    });
  } else if (status === 404 || /not\s*found|404/i.test(msg)) {
    checks.push({
      id: 'edge_function',
      ok: false,
      label: 'Edge function send-internal-notification',
      detail:
        'Not deployed or wrong name (HTTP 404). In Supabase Dashboard → Edge Functions, confirm `send-internal-notification` exists. Deploy: `supabase functions deploy send-internal-notification`',
    });
  } else if (
    status === 400 ||
    /non-2xx|400|Unknown|Invalid|unknown or missing eventtype/i.test(msg)
  ) {
    checks.push({
      id: 'edge_function',
      ok: true,
      label: 'Edge function send-internal-notification',
      detail:
        'Reachable (expected error for test payload). Billing “Copy & approve” can call this function. Ensure VAPID secrets are set on the function for push.',
    });
  } else if (/failed to send|failed to fetch|network|load failed|could not connect/i.test(msg)) {
    checks.push({
      id: 'edge_function',
      ok: false,
      label: 'Edge function send-internal-notification',
      detail: `${msg}\n\nUsually: function not deployed to this Supabase project, wrong VITE_SUPABASE_URL in the hosted build, ad-blocker/VPN, or device offline. Compare Dashboard project URL with your .env.`,
    });
  } else {
    checks.push({
      id: 'edge_function',
      ok: false,
      label: 'Edge function send-internal-notification',
      detail:
        msg ||
        'Invoke failed — open Supabase → Edge Functions → send-internal-notification → Logs.',
    });
  }

  checks.push({
    id: 'billing_path',
    ok: true,
    label: 'Billing: when is sales notified?',
    detail:
      'Only after Live Queue → Communicate → “Copy & Approve Order”. “Skip notification” does not call the sales update.',
  });

  return checks;
}
