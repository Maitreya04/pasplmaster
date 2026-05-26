import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'billing-desk-split-ratio-v1';
const DEFAULT_RATIO = 0.4;
const MIN_RATIO = 0.28;
const MAX_RATIO = 0.72;

function readStoredRatio(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_RATIO;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_RATIO;
    return Math.min(MAX_RATIO, Math.max(MIN_RATIO, n));
  } catch {
    return DEFAULT_RATIO;
  }
}

interface DeskSplitPaneProps {
  left: ReactNode;
  right: ReactNode;
}

export function DeskSplitPane({ left, right }: DeskSplitPaneProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(readStoredRatio);
  const [dragging, setDragging] = useState(false);

  const persistRatio = useCallback((next: number) => {
    const clamped = Math.min(MAX_RATIO, Math.max(MIN_RATIO, next));
    setRatio(clamped);
    try {
      localStorage.setItem(STORAGE_KEY, String(clamped));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const next = (e.clientX - rect.left) / rect.width;
      persistRatio(next);
    };

    const onUp = () => setDragging(false);

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, persistRatio]);

  const leftPct = `${Math.round(ratio * 1000) / 10}%`;

  return (
    <div ref={containerRef} className="relative flex flex-1 min-h-0 h-full w-full">
      <div
        className="flex h-full min-h-0 flex-col overflow-hidden shrink-0"
        style={{ width: leftPct }}
      >
        {left}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={Math.round(MIN_RATIO * 100)}
        aria-valuemax={Math.round(MAX_RATIO * 100)}
        title="Drag to resize · double-click to reset"
        onMouseDown={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDoubleClick={() => persistRatio(DEFAULT_RATIO)}
        className={`group/handle relative z-[1] h-full w-1.5 shrink-0 self-stretch cursor-col-resize touch-none ${
          dragging ? 'bg-[var(--role-primary-subtle)]' : 'bg-[var(--border-subtle)] hover:bg-[var(--border-opaque)]'
        } transition-colors`}
      >
        <div
          className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-0.5 rounded-full px-0.5 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-subtle)] shadow-sm opacity-0 group-hover/handle:opacity-100 ${dragging ? 'opacity-100' : ''} transition-opacity`}
        >
          {[0, 1, 2].map((i) => (
            <span key={i} className="block w-0.5 h-0.5 rounded-full bg-[var(--content-quaternary)]" />
          ))}
        </div>
      </div>

      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--bg-secondary)]">
        <div className="h-full min-h-0 flex flex-col overflow-hidden">
          {right}
        </div>
      </div>
    </div>
  );
}
