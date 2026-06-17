import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, Warning, Flag, ArrowRight, Clock, Package, CloudArrowUp, ArrowsClockwise } from '@phosphor-icons/react';
import { BigButton } from '../../components/shared';
import { formatLineCountLabel } from '../../lib/picking/pickQueueDisplay';
import { retryOfflinePickSync } from '../../lib/offlinePicks';
import type { PickCompletionSnapshot } from '../../lib/picking/pickCompletionSnapshot';

interface PickCompleteScreenProps {
  snapshot: PickCompletionSnapshot;
  orderId?: number | null;
}

function formatReceiptTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatPickDuration(startIso: string | null, endIso: string): string {
  if (!startIso) return '';
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  const ms = end.getTime() - start.getTime();
  if (ms <= 0) return '';
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export function PickCompleteScreen({ snapshot, orderId }: PickCompleteScreenProps): React.JSX.Element | null {
  const navigate = useNavigate();
  const [retrying, setRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const {
    orderNumber,
    customerName,
    customerCity,
    transportName,
    pickedLineCount,
    flaggedLineCount,
    totalLineCount,
    pickedPieceCount,
    totalPieceCount,
    boxCount,
    billingNotified,
    billingHandoffLine,
    finishedAtIso,
    startedAtIso,
    flagReasonLabels,
    saveState,
  } = snapshot;
  const hasFlagged = flaggedLineCount > 0;
  const completedTime = formatReceiptTime(finishedAtIso);
  const duration = formatPickDuration(startedAtIso, finishedAtIso);
  const statusText =
    saveState === 'already_saved'
      ? 'Pick already saved'
      : saveState === 'queued'
        ? 'Waiting to sync'
        : saveState === 'needs_review'
          ? 'Needs review'
          : hasFlagged
            ? 'Sent to billing with flags'
            : 'Pick complete';
  const toneClass = saveState === 'queued'
    ? 'bg-[var(--bg-accent)] text-[var(--content-on-color)]'
    : saveState === 'needs_review' || hasFlagged
    ? 'bg-[var(--bg-warning)] text-[var(--content-primary)]'
    : 'bg-[var(--bg-positive)] text-[var(--content-on-color)]';

  return (
    <div className="min-h-[100dvh] bg-[var(--bg-primary)] px-4 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-[var(--content-primary)]">
      <div className="mx-auto flex min-h-[calc(100dvh-2.5rem)] w-full max-w-md flex-col">
        <section className={`rounded-2xl px-5 py-6 shadow-sm ${toneClass}`}>
          <div className="mb-5 flex items-start justify-between gap-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/20">
              {saveState === 'queued' ? (
                <CloudArrowUp size={42} weight="fill" />
              ) : saveState === 'needs_review' || hasFlagged ? (
                <Warning size={42} weight="fill" />
              ) : (
                <CheckCircle size={42} weight="fill" />
              )}
            </div>
            <div className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold">
              {statusText}
            </div>
          </div>

          <p className="font-mono text-xs font-bold opacity-80">{orderNumber}</p>
          <h1 className="mt-2 text-2xl font-bold leading-tight">{customerName}</h1>
          <div className="mt-3 space-y-1 text-sm font-semibold opacity-85">
            {customerCity && <p>{customerCity}</p>}
            {transportName && <p>{transportName}</p>}
          </div>
        </section>

        <section className="mt-4 space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--content-secondary)]">
              <Clock size={18} weight="bold" />
              Completed
            </div>
            <div className="text-right">
              {completedTime && (
                <p className="text-sm font-bold text-[var(--content-primary)]">
                  {completedTime}
                </p>
              )}
              {duration && (
                <p className="text-xs font-semibold text-[var(--content-tertiary)]">
                  Took {duration}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-[var(--bg-tertiary)] p-3">
              <p className="text-xs font-semibold text-[var(--content-tertiary)]">Boxes</p>
              <p className="mt-1 flex items-center gap-1.5 text-xl font-bold tabular-nums">
                <Package size={18} weight="bold" />
                {boxCount}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--bg-tertiary)] p-3">
              <p className="text-xs font-semibold text-[var(--content-tertiary)]">Lines</p>
              <p className="mt-1 text-xl font-bold tabular-nums">
                {pickedLineCount + flaggedLineCount}/{totalLineCount}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--bg-tertiary)] p-3">
              <p className="text-xs font-semibold text-[var(--content-tertiary)]">Picked</p>
              <p className="mt-1 text-lg font-bold tabular-nums">
                {formatLineCountLabel(pickedLineCount, { short: true })}
              </p>
            </div>
            <div className="rounded-xl bg-[var(--bg-tertiary)] p-3">
              <p className="text-xs font-semibold text-[var(--content-tertiary)]">Pieces</p>
              <p className="mt-1 text-lg font-bold tabular-nums">
                {pickedPieceCount}/{totalPieceCount}
              </p>
            </div>
          </div>

          {hasFlagged && (
            <div className="rounded-xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] p-3">
              <p className="flex items-center gap-1.5 text-sm font-bold text-[var(--content-warning-on-light)]">
                <Flag size={16} weight="fill" />
                {flaggedLineCount} flagged for billing
              </p>
              {flagReasonLabels.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {flagReasonLabels.map((label) => (
                    <span
                      key={label}
                      className="rounded-full bg-[var(--bg-primary)] px-2.5 py-1 text-xs font-bold text-[var(--content-secondary)]"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl bg-[var(--bg-accent-subtle)] p-3 text-sm font-semibold text-[var(--content-accent)]">
            {saveState === 'queued'
              ? 'Saved on this device. It will sync automatically when network returns.'
              : saveState === 'needs_review'
                ? 'Saved on this device. Billing/admin review is needed before this pick can be applied.'
                : billingHandoffLine}
            {billingNotified && saveState === 'saved' && (
              <span className="block pt-1 text-xs text-[var(--content-secondary)]">
                Billing notified
              </span>
            )}
          </div>
        </section>

        <div className="mt-auto pt-4 space-y-3">
          {(saveState === 'queued' || saveState === 'needs_review') && orderId != null && (
            <BigButton
              variant="secondary"
              loading={retrying}
              onClick={() => {
                setRetrying(true);
                setRetryMessage(null);
                void retryOfflinePickSync(orderId)
                  .then((session) => {
                    if (session?.status === 'applied') {
                      setRetryMessage('Pick synced successfully.');
                    } else if (session?.status === 'conflict' || session?.status === 'failed') {
                      setRetryMessage(session.lastError ?? 'Sync still needs review.');
                    } else {
                      setRetryMessage('Still waiting for network. Will retry automatically.');
                    }
                  })
                  .catch((err) => {
                    setRetryMessage(err instanceof Error ? err.message : 'Retry failed');
                  })
                  .finally(() => setRetrying(false));
              }}
            >
              <ArrowsClockwise size={20} weight="bold" />
              Retry sync now
            </BigButton>
          )}
          {retryMessage && (
            <p className="text-center text-xs font-semibold text-[var(--content-secondary)]">
              {retryMessage}
            </p>
          )}
          <BigButton
            variant="primary"
            onClick={() => navigate('/picking', { replace: true })}
            className="bg-[var(--bg-positive)] text-[var(--content-on-color)] font-bold"
          >
            <ArrowRight size={20} weight="bold" />
            Next order
          </BigButton>
          <button
            type="button"
            onClick={() => navigate('/picking?view=done&day=today', { replace: true })}
            className="min-h-11 w-full rounded-xl text-sm font-bold text-[var(--content-secondary)] underline-offset-2 hover:underline"
          >
            View completed
          </button>
        </div>
      </div>
    </div>
  );
}
