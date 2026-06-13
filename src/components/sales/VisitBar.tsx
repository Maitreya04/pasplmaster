import { useEffect, useState } from 'react';
import { MapPin } from '@phosphor-icons/react';
import type { ActiveVisit } from '../../types/visit';

function formatElapsed(startedAt: string): string {
  const mins = Math.max(1, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000));
  return `${mins} min`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function VisitBar({
  visit,
  onEndVisit,
}: {
  visit: ActiveVisit;
  onEndVisit: () => void;
}): React.JSX.Element {
  const [, tick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="rounded-xl border border-[var(--border-success)] bg-[var(--bg-success-subtle)] px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--content-success-on-light)]">
            <MapPin size={16} weight="fill" />
            Visit in progress
          </div>
          <p className="mt-0.5 truncate text-sm text-[var(--content-primary)]">{visit.customer_name}</p>
          <p className="text-xs text-[var(--content-secondary)]">
            Started {formatTime(visit.started_at)} · {formatElapsed(visit.started_at)}
          </p>
        </div>
        <button
          type="button"
          onClick={onEndVisit}
          className="shrink-0 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-primary)] px-3 py-2 text-xs font-semibold text-[var(--content-primary)]"
        >
          End visit
        </button>
      </div>
    </div>
  );
}
