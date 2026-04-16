import { ArrowLeft, CaretRight, CheckCircle, MagnifyingGlassMinus, MagnifyingGlassPlus, WarningCircle } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { itemStatusComplete } from './helpers';
import type { LoadedOcrImage, OcrStageRun } from './types';

function dotClasses(item: OcrStageRun['items'][number], selected: boolean): string {
  const base = 'absolute -translate-x-1/2 -translate-y-1/2 rounded-full text-white shadow-lg ring-4 transition-transform';
  const size = selected ? 'h-10 w-10 scale-110' : 'h-9 w-9';
  if (itemStatusComplete(item.status)) return `${base} ${size} bg-emerald-500 ring-emerald-200`;
  if (item.confidence >= 0.9) return `${base} ${size} bg-emerald-500 ring-emerald-200`;
  if (item.confidence >= 0.7) return `${base} ${size} bg-amber-500 ring-amber-200`;
  return `${base} ${size} bg-rose-500 ring-rose-200`;
}

export function OcrLabReviewScreen({
  image,
  run,
  selectedItemId,
  allConfirmed,
  onBack,
  onItemClick,
  onProceed,
}: {
  image: LoadedOcrImage | null;
  run: OcrStageRun;
  selectedItemId: string | null;
  allConfirmed: boolean;
  onBack: () => void;
  onItemClick: (id: string) => void;
  onProceed: () => void;
}): React.JSX.Element {
  const confirmedCount = run.items.filter((item) => itemStatusComplete(item.status)).length;
  const [zoom, setZoom] = useState(1);
  const imageMode = useMemo(() => {
    if (!image) return 'portrait';
    return image.width >= image.height ? 'landscape' : 'portrait';
  }, [image]);

  const imageClassName = imageMode === 'landscape'
    ? 'block h-full w-auto max-w-none'
    : 'block h-auto w-full max-w-none';

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

      <div className="relative flex-1 overflow-hidden bg-[var(--bg-primary)] p-4">
        <div className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] shadow-sm">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] px-3 py-2 text-xs text-[var(--content-tertiary)]">
            <span>{image ? (imageMode === 'landscape' ? 'Landscape bill: scroll sideways to inspect full width' : 'Portrait bill: scroll vertically to inspect full page') : 'No image loaded'}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setZoom((value) => Math.max(1, Number((value - 0.25).toFixed(2))))}
                className="rounded-full bg-[var(--bg-tertiary)] p-2 text-[var(--content-secondary)]"
              >
                <MagnifyingGlassMinus size={14} />
              </button>
              <span className="min-w-10 text-center font-semibold text-[var(--content-secondary)]">{Math.round(zoom * 100)}%</span>
              <button
                onClick={() => setZoom((value) => Math.min(2.5, Number((value + 0.25).toFixed(2))))}
                className="rounded-full bg-[var(--bg-tertiary)] p-2 text-[var(--content-secondary)]"
              >
                <MagnifyingGlassPlus size={14} />
              </button>
            </div>
          </div>

          <div className="relative flex-1 overflow-auto bg-[var(--bg-tertiary)]">
            <div
              className={`relative min-h-full min-w-full ${imageMode === 'landscape' ? 'flex h-full items-start' : 'block'}`}
              style={{
                width: image ? `${zoom * 100}%` : undefined,
              }}
            >
              {image ? (
                <div className={`relative ${imageMode === 'landscape' ? 'h-full' : 'w-full'}`}>
                  <img src={image.previewUrl} alt={image.name} className={imageClassName} />
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))]" />

                  {run.items.map((item, index) => {
                    const selected = item.id === selectedItemId;
                    return (
                      <button
                        key={item.id}
                        onClick={() => onItemClick(item.id)}
                        className={dotClasses(item, selected)}
                        style={{
                          top: item.coordinates.top,
                          left: item.coordinates.left,
                        }}
                        title={`Item ${index + 1}`}
                      >
                        <span className="text-sm font-bold">{index + 1}</span>
                        {itemStatusComplete(item.status) ? (
                          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--bg-positive)] text-[10px] font-bold text-white">
                            ✓
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_#f8fafc,_#e5e7eb)]" />
              )}
            </div>
          </div>
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
          <span className="text-xs font-medium text-[var(--content-tertiary)]">Scroll and tap numbered pins to review</span>
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
