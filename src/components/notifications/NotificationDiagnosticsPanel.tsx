import { useCallback, useState } from 'react';
import { ArrowsClockwise, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';
import { runNotificationDiagnostics } from '../../lib/notificationDiagnostics';
import type { NotificationDiagnosticCheck } from '../../lib/notificationDiagnostics';

export function NotificationDiagnosticsPanel(): React.JSX.Element {
  const { userId, userName, role } = useAuth();
  const [checks, setChecks] = useState<NotificationDiagnosticCheck[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      const result = await runNotificationDiagnostics({ userId, userName, role });
      setChecks(result);
    } finally {
      setRunning(false);
    }
  }, [userId, userName, role]);

  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-[var(--content-primary)]">Notification diagnostics</p>
          <p className="text-xs text-[var(--content-tertiary)] mt-0.5">
            Run checks for in-app inbox + edge function reachability (read-only).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="inline-flex items-center gap-2 min-h-10 px-3 rounded-xl text-sm font-medium bg-[var(--bg-tertiary)] text-[var(--content-primary)] hover:bg-[var(--bg-accent-subtle)] disabled:opacity-50"
        >
          <ArrowsClockwise size={18} className={running ? 'animate-spin' : ''} />
          {running ? 'Running…' : 'Run checks'}
        </button>
      </div>

      {checks && (
        <ul className="space-y-2">
          {checks.map((c) => (
            <li
              key={c.id}
              className="flex gap-2 text-sm rounded-xl bg-[var(--bg-primary)] p-3 border border-[var(--border-subtle)]"
            >
              {c.ok ? (
                <CheckCircle size={18} weight="fill" className="text-[var(--content-positive)] shrink-0 mt-0.5" />
              ) : (
                <WarningCircle size={18} weight="fill" className="text-[var(--content-warning)] shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <p className="font-medium text-[var(--content-primary)]">{c.label}</p>
                <p className="text-xs text-[var(--content-secondary)] whitespace-pre-wrap mt-0.5">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] text-[var(--content-quaternary)] leading-relaxed">
        Supabase SQL (service role / SQL editor):{' '}
        <code className="text-[var(--content-tertiary)]">
          select * from notification_events order by created_at desc limit 10;
        </code>{' '}
        — confirms the function wrote audit rows after billing approved.{' '}
        <code className="text-[var(--content-tertiary)]">
          select * from user_notifications order by created_at desc limit 10;
        </code>{' '}
        — confirms in-app rows and target user_id.
      </p>
    </div>
  );
}
