import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardText, SignOut } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';
import { useFieldActivityDashboard } from '../../hooks/useFieldActivity';
import { Card, Skeleton } from '../../components/shared';
import { formatTimeAgo } from '../../utils/formatters';

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function FieldActivityPage(): React.JSX.Element {
  const navigate = useNavigate();
  const { switchRole } = useAuth();
  const [date, setDate] = useState(todayIsoDate());
  const { data, isLoading } = useFieldActivityDashboard(date);

  return (
    <div className="role-admin min-h-screen bg-[var(--bg-primary)]">
      <div className="mx-auto max-w-4xl p-4 lg:px-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--content-primary)]">Field activity</h1>
            <p className="text-sm text-[var(--content-tertiary)]">
              Workdays, customer visits, duration, and outcomes
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              switchRole();
              navigate('/select-role');
            }}
            className="flex min-h-11 items-center gap-2 text-sm text-[var(--content-tertiary)]"
          >
            <SignOut size={18} />
            Switch role
          </button>
        </div>

        <div className="mb-4">
          <label className="text-sm font-medium text-[var(--content-secondary)]">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--content-primary)]"
          />
        </div>

        {isLoading || !data ? (
          <Skeleton variant="text" lines={10} />
        ) : (
          <div className="space-y-6">
            <section>
              <div className="mb-3 flex items-center gap-2">
                <ClipboardText size={18} className="text-[var(--role-primary)]" />
                <h2 className="text-sm font-semibold text-[var(--content-secondary)]">
                  Workday status
                </h2>
              </div>
              <div className="space-y-2">
                {data.workdays.map((row) => {
                  const status = row.started_at
                    ? row.ended_at
                      ? 'Ended'
                      : 'Active'
                    : 'Not started';
                  return (
                    <Card
                      key={row.salesman_user_id}
                      className="py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-[var(--content-primary)]">{row.salesman_name}</p>
                          <p className="text-xs text-[var(--content-tertiary)]">
                            {status}
                            {row.started_at ? ` · started ${formatTimeAgo(row.started_at)}` : ''}
                          </p>
                        </div>
                        <div className="text-right text-xs text-[var(--content-secondary)]">
                          <p>{row.visits_count ?? 0} visits</p>
                          {row.last_visit_at && (
                            <p>Last seen {formatTimeAgo(row.last_visit_at)}</p>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-[var(--content-secondary)]">
                Visits today ({data.visits.length})
              </h2>
              <div className="space-y-2">
                {data.visits.length === 0 ? (
                  <Card>
                    <p className="text-sm text-[var(--content-tertiary)]">No visits logged yet.</p>
                  </Card>
                ) : (
                  data.visits.map((visit) => (
                    <Card key={visit.id} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-[var(--content-primary)]">
                            {visit.customer_name}
                          </p>
                          <p className="text-xs text-[var(--content-tertiary)]">
                            {visit.salesman_name}
                            {visit.customer_city ? ` · ${visit.customer_city}` : ''}
                          </p>
                          <p className="mt-1 text-xs text-[var(--content-secondary)]">
                            {formatTimeAgo(visit.started_at)}
                            {visit.duration_minutes ? ` · ${visit.duration_minutes} min` : ''}
                            {visit.outcome ? ` · ${visit.outcome.replace('_', ' ')}` : ''}
                          </p>
                          {visit.notes && (
                            <p className="mt-2 text-sm text-[var(--content-secondary)]">
                              {visit.notes}
                            </p>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
