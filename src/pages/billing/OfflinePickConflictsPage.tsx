import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CloudWarning, Package, UserCircle, Clock } from '@phosphor-icons/react';
import { PageHeader, Skeleton, EmptyState } from '../../components/shared';
import { supabase } from '../../lib/supabase/client';

interface OfflinePickConflictRow {
  id: number;
  client_pick_key: string;
  order_id: number | null;
  order_number: string | null;
  customer_name: string | null;
  picker_user_id: number | null;
  picker_name: string | null;
  status: 'conflict' | 'failed';
  result: Record<string, unknown> | null;
  payload: {
    box_count?: number;
    completed_at?: string;
    lines?: Array<{
      order_item_id?: number;
      state?: string;
      picked_qty?: number;
      flag_reason?: string | null;
      scan_result?: { matchedAgainst?: string; extractedCode?: string; reason?: string } | null;
    }>;
  } | null;
  error: string | null;
  completed_at: string | null;
  updated_at: string;
}

async function fetchOfflinePickConflicts(): Promise<OfflinePickConflictRow[]> {
  const { data, error } = await supabase.rpc('list_offline_pick_conflicts');
  if (error) throw error;
  return (data ?? []) as OfflinePickConflictRow[];
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return 'Unknown time';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function OfflinePickConflictsPage(): React.JSX.Element | null {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['offline-pick-conflicts'],
    queryFn: fetchOfflinePickConflicts,
    refetchInterval: 30_000,
  });

  const rows = data ?? [];
  const counts = useMemo(() => {
    let conflict = 0;
    let failed = 0;
    for (const row of rows) {
      if (row.status === 'conflict') conflict += 1;
      else failed += 1;
    }
    return { conflict, failed };
  }, [rows]);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <PageHeader title="Offline pick review" />
      <div className="space-y-4 p-4">
        <div className="rounded-xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] p-3">
          <p className="flex items-center gap-2 text-sm font-bold text-[var(--content-warning-on-light)]">
            <CloudWarning size={18} weight="fill" />
            Offline pick packets needing attention
          </p>
          <p className="mt-1 text-xs font-semibold text-[var(--content-secondary)]">
            {counts.conflict} conflict · {counts.failed} failed
          </p>
        </div>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton variant="card" count={3} />
          </div>
        )}

        {error && (
          <p className="text-sm font-semibold text-[var(--content-negative)]">
            Could not load offline pick conflicts.
          </p>
        )}

        {!isLoading && rows.length === 0 && (
          <EmptyState
            icon={Package}
            title="No offline pick conflicts"
            description="Queued offline picks that sync cleanly will not appear here."
          />
        )}

        <div className="space-y-3">
          {rows.map((row) => {
            const lines = row.payload?.lines ?? [];
            const flagged = lines.filter((line) => line.state === 'flagged').length;
            const picked = lines.filter((line) => line.state === 'picked').length;
            const reason =
              row.error ??
              (typeof row.result?.reason === 'string' ? row.result.reason : null) ??
              'Needs review';
            const expanded = expandedId === row.id;
            return (
              <article
                key={row.id}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold text-[var(--content-tertiary)]">
                      {row.order_number ?? `Order #${row.order_id ?? 'unknown'}`}
                    </p>
                    <h2 className="mt-1 truncate text-base font-bold text-[var(--content-primary)]">
                      {row.customer_name ?? 'Unknown customer'}
                    </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--content-secondary)]">
                      <span className="inline-flex items-center gap-1">
                        <UserCircle size={15} weight="bold" />
                        {row.picker_name ?? 'Unknown picker'}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock size={15} weight="bold" />
                        {formatWhen(row.completed_at ?? row.updated_at)}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-2.5 py-1 text-xs font-bold text-[var(--content-warning-on-light)]">
                    {row.status}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-semibold">
                  <div className="rounded-lg bg-[var(--bg-tertiary)] p-2">
                    <p className="text-[var(--content-tertiary)]">Picked</p>
                    <p className="mt-1 text-base font-bold text-[var(--content-primary)]">{picked}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--bg-tertiary)] p-2">
                    <p className="text-[var(--content-tertiary)]">Flags</p>
                    <p className="mt-1 text-base font-bold text-[var(--content-primary)]">{flagged}</p>
                  </div>
                  <div className="rounded-lg bg-[var(--bg-tertiary)] p-2">
                    <p className="text-[var(--content-tertiary)]">Boxes</p>
                    <p className="mt-1 text-base font-bold text-[var(--content-primary)]">
                      {row.payload?.box_count ?? '-'}
                    </p>
                  </div>
                </div>

                <p className="mt-3 rounded-lg bg-[var(--bg-tertiary)] px-3 py-2 text-xs font-semibold text-[var(--content-secondary)]">
                  {reason}
                </p>

                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : row.id)}
                  className="mt-3 min-h-10 rounded-lg px-3 text-sm font-bold text-[var(--content-accent)]"
                >
                  {expanded ? 'Hide packet' : 'Show packet'}
                </button>

                {expanded && (
                  <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-[var(--bg-tertiary)] p-3 text-[11px] text-[var(--content-secondary)]">
                    {JSON.stringify({ result: row.result, payload: row.payload }, null, 2)}
                  </pre>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
