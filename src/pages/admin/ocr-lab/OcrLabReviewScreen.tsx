import { ArrowLeft, CaretRight, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { itemStatusComplete } from './helpers';
import type { OcrStageRun } from './types';

function confidenceTone(item: OcrStageRun['items'][number]): string {
  if (itemStatusComplete(item.status)) return 'border-[var(--border-subtle)] bg-[var(--bg-positive-subtle)]';
  if (item.confidence >= 0.9) return 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]';
  if (item.confidence >= 0.7) return 'border-[var(--border-subtle)] bg-[var(--bg-warning-subtle)]';
  return 'border-[var(--border-subtle)] bg-[var(--bg-secondary)]';
}

export function OcrLabReviewScreen({
  run,
  selectedItemId,
  allConfirmed,
  onBack,
  onItemClick,
  onProceed,
}: {
  run: OcrStageRun;
  selectedItemId: string | null;
  allConfirmed: boolean;
  onBack: () => void;
  onItemClick: (id: string) => void;
  onProceed: () => void;
}): React.JSX.Element {
  const confirmedCount = run.items.filter((item) => itemStatusComplete(item.status)).length;

  return (
    <div className="flex h-full flex-col bg-[var(--bg-primary)]">
      <div className="z-10 flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-4 py-3 shadow-sm">
        <div className="flex items-center">
          <button onClick={onBack} className="-ml-2 rounded-full p-2 text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)]">
            <ArrowLeft size={20} />
          </button>
          <div className="ml-2">
            <h1 className="text-base font-semibold text-[var(--content-primary)]">Review Items</h1>
            <p className="text-xs text-[var(--content-tertiary)]">{confirmedCount}/{run.items.length} confirmed</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {run.items.map((item) => (
            <div
              key={item.id}
              className={`h-2 w-2 rounded-full ${itemStatusComplete(item.status) ? 'bg-[var(--bg-positive)]' : 'bg-[var(--border-opaque)]'}`}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-3">
          {run.items.map((item, index) => {
            const selected = item.id === selectedItemId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onItemClick(item.id)}
                className={`w-full rounded-2xl border p-4 text-left transition-shadow ${confidenceTone(item)} ${selected ? 'ring-2 ring-[var(--role-primary)]' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--content-tertiary)]">
                      Line {index + 1}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[var(--content-primary)]">{item.rawText}</p>
                    <p className="mt-1 text-xs text-[var(--content-secondary)]">
                      {item.matchedProduct?.name ?? 'No catalog match'} · qty {item.quantity}
                    </p>
                  </div>
                  <span className="rounded-full bg-[var(--bg-primary)] px-2.5 py-1 text-xs font-medium text-[var(--content-secondary)]">
                    {item.confidenceLabel}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-4 shadow-[0_-4px_10px_rgba(0,0,0,0.04)]">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-4 text-xs font-medium">
            <div className="flex items-center gap-1 text-[var(--content-secondary)]">
              <CheckCircle size={14} className="text-[var(--content-positive)]" />
              <span>High</span>
            </div>
            <div className="flex items-center gap-1 text-[var(--content-secondary)]">
              <WarningCircle size={14} className="text-[var(--content-warning)]" />
              <span>Medium</span>
            </div>
            <div className="flex items-center gap-1 text-[var(--content-secondary)]">
              <WarningCircle size={14} className="text-[var(--content-negative)]" />
              <span>Low</span>
            </div>
          </div>
          <span className="text-xs font-medium text-[var(--content-tertiary)]">Tap a line to edit</span>
        </div>

        <button
          onClick={onProceed}
          disabled={!allConfirmed}
          className={`flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-semibold transition-all ${allConfirmed ? 'bg-[var(--role-primary)] text-[var(--content-on-color)] shadow-sm' : 'cursor-not-allowed bg-[var(--bg-tertiary)] text-[var(--content-quaternary)]'}`}
        >
          <span>Proceed to Order</span>
          <CaretRight size={18} />
        </button>
      </div>
    </div>
  );
}
