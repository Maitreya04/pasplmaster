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

/**
 * Read-only checks you can run from the app (anon key) to see why in-app notifications fail.
 */
export async function runNotificationDiagnostics(opts: {
  userId: number | null;
  userName: string | null;
  role: string | null;
}): Promise<NotificationDiagnosticCheck[]> {
  const checks: NotificationDiagnosticCheck[] = [];

  checks.push({
    id: 'auth_user_id',
    ok: opts.userId != null,
    label: 'Session users.id',
    detail:
      opts.userId != null
        ? `userId=${opts.userId} (inbox queries use this)`
        : 'userId is null — the bell cannot load rows. Open Role select and pick your name again (name must match users.full_name for your role).',
  });

  checks.push({
    id: 'auth_name_role',
    ok: !!(opts.userName && opts.role),
    label: 'Name & role',
    detail: `${opts.role ?? '—'} / ${opts.userName ?? '—'}`,
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
  const msg = fnErr && typeof fnErr === 'object' && 'message' in fnErr ? String((fnErr as { message: string }).message) : '';

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
        'Not deployed or wrong name (HTTP 404). Run: supabase functions deploy send-internal-notification',
    });
  } else if (status === 400 || /non-2xx|400|Unknown|Invalid/i.test(msg)) {
    checks.push({
      id: 'edge_function',
      ok: true,
      label: 'Edge function send-internal-notification',
      detail:
        'Responds (expected 400 for dummy payload). Billing “Copy & approve” can reach the function if deploy + secrets are set.',
    });
  } else {
    checks.push({
      id: 'edge_function',
      ok: false,
      label: 'Edge function send-internal-notification',
      detail: msg || 'Invoke failed — check Dashboard → Edge Functions → Logs.',
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
