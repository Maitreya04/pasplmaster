import { Camera, ClockCounterClockwise, Package, User } from '@phosphor-icons/react';
import type { OcrRunSummary } from './types';

export function OcrLabHomeScreen({
  recentRuns,
  onNavigate,
}: {
  recentRuns: OcrRunSummary[];
  onNavigate: () => void;
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col bg-[var(--bg-primary)]">
      <div className="border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-5 py-5">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="font-ds-micro text-[var(--content-tertiary)]">OCR Sales Flow</p>
            <h2 className="mt-1 text-xl font-bold text-[var(--content-primary)]">Stage before shipping</h2>
            <p className="mt-1 text-sm text-[var(--content-tertiary)]">Use the live OCR pipeline, but keep the workflow safely inside admin.</p>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--bg-tertiary)]">
            <User size={20} className="text-[var(--content-secondary)]" />
          </div>
        </div>

        <button
          onClick={onNavigate}
          className="flex w-full items-center justify-between rounded-2xl bg-[var(--role-primary)] p-4 text-[var(--content-on-color)] shadow-sm transition-colors hover:opacity-95"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15">
              <Camera size={24} className="text-[var(--content-on-color)]" />
            </div>
            <div className="text-left">
              <h2 className="text-lg font-semibold">Start OCR Review</h2>
              <p className="text-xs text-white/80">Upload a WhatsApp bill photo and walk it through the staged review flow.</p>
            </div>
          </div>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--content-secondary)]">Recent staged scans</h3>
          <span className="rounded-full bg-[var(--bg-tertiary)] px-3 py-1 text-xs font-medium text-[var(--content-tertiary)]">
            Admin only
          </span>
        </div>
        <div className="space-y-3">
          {recentRuns.map((run) => (
            <div
              key={run.id}
              className="flex items-center justify-between rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--bg-tertiary)]">
                  <Package size={18} className="text-[var(--content-secondary)]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--content-primary)]">{run.customer}</p>
                  <p className="text-xs text-[var(--content-tertiary)]">{run.itemCount} items • {run.timeLabel}</p>
                </div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${run.status === 'Strong match' ? 'bg-[var(--bg-positive-subtle)] text-[var(--content-positive)]' : 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning)]'}`}>
                {run.status}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--bg-tertiary)]">
              <ClockCounterClockwise size={18} className="text-[var(--content-secondary)]" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--content-primary)]">How it fits the app</p>
              <p className="mt-1 text-xs leading-5 text-[var(--content-tertiary)]">
                This mirrors the future sales flow: upload photo, inspect extracted lines, confirm matches, then finalize the order draft.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
