import { type ReactNode, useEffect, useRef, useCallback } from 'react';
import { X } from '@phosphor-icons/react';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function BottomSheet({ isOpen, onClose, title, children }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const currentTranslate = useRef(0);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // When an input inside the sheet receives focus (especially on mobile),
  // scroll it into view so it doesn't get covered by the on‑screen keyboard.
  useEffect(() => {
    const sheetEl = sheetRef.current;
    if (!sheetEl) return;

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || !sheetEl.contains(target)) return;

      // Only nudge on small / touch devices to avoid surprising desktop behaviour.
      const isCoarsePointer =
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(pointer: coarse)').matches;

      if (!isCoarsePointer) return;

      // Defer slightly so the browser has applied keyboard/layout changes.
      window.setTimeout(() => {
        try {
          target.scrollIntoView({
            block: 'center',
            behavior: 'smooth',
          });
        } catch {
          // Older browsers: use a simpler call.
          target.scrollIntoView(true);
        }
      }, 50);
    };

    sheetEl.addEventListener('focusin', handleFocusIn);
    return () => {
      sheetEl.removeEventListener('focusin', handleFocusIn);
    };
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current === null || !sheetRef.current) return;
    const diff = e.touches[0].clientY - dragStartY.current;
    if (diff > 0) {
      currentTranslate.current = diff;
      sheetRef.current.style.transform = `translateY(${diff}px)`;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!sheetRef.current) return;
    if (currentTranslate.current > 100) {
      onClose();
    }
    sheetRef.current.style.transform = '';
    dragStartY.current = null;
    currentTranslate.current = 0;
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div
        className="absolute inset-0 bg-[var(--bg-overlay)] backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={sheetRef}
        className="relative z-10 w-full max-h-[85vh] bg-[var(--bg-secondary)] rounded-t-3xl flex flex-col animate-slide-up"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex justify-center mt-3 mb-2">
          <div className="w-10 h-1 rounded-full bg-[var(--border-subtle)]" />
        </div>

        {title && (
          <div className="flex items-center justify-between px-5 pb-4">
            <h2 className="text-lg font-semibold text-[var(--content-primary)]">{title}</h2>
            <button
              onClick={onClose}
              className="p-2 -mr-2 rounded-lg text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors duration-150"
              aria-label="Close"
            >
              <X size={20} weight="regular" />
            </button>
          </div>
        )}

        <div
          className="overflow-y-auto overscroll-contain px-5 pb-5"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 20px)' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
