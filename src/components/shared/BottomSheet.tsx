import { type ReactNode, useEffect, useRef, useCallback } from 'react';
import { X } from '@phosphor-icons/react';
import { appHaptics } from '../../lib/haptics';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  sheetClassName?: string;
  contentClassName?: string;
}

export function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  sheetClassName = '',
  contentClassName = '',
}: BottomSheetProps): React.JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const currentTranslate = useRef(0);
  const wasOpenRef = useRef(isOpen);

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

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      appHaptics.selection();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  const handleClose = useCallback(() => {
    appHaptics.selection();
    onClose();
  }, [onClose]);

  // On mobile Safari/Chrome, fixed bottom sheets don't automatically move with
  // the on-screen keyboard because the layout viewport height doesn't change.
  // Size the sheet container to the visual viewport instead of translating the
  // whole overlay upward, which can push the sheet header/search off-screen.
  useEffect(() => {
    if (!isOpen) return;
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const container = containerRef.current;
    if (!container) return;

    const viewport = window.visualViewport;

    const syncWithViewport = () => {
      if (!viewport || !containerRef.current) return;
      containerRef.current.style.top = `${viewport.offsetTop}px`;
      containerRef.current.style.height = `${viewport.height}px`;
      containerRef.current.style.bottom = 'auto';
    };

    syncWithViewport();
    viewport.addEventListener('resize', syncWithViewport);
    viewport.addEventListener('scroll', syncWithViewport);

    return () => {
      viewport.removeEventListener('resize', syncWithViewport);
      viewport.removeEventListener('scroll', syncWithViewport);
      if (container) {
        container.style.top = '';
        container.style.height = '';
        container.style.bottom = '';
      }
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
            block: 'nearest',
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
      handleClose();
    }
    sheetRef.current.style.transform = '';
    dragStartY.current = null;
    currentTranslate.current = 0;
  }, [handleClose]);

  if (!isOpen) return null;

  return (
    <div ref={containerRef} className="fixed inset-0 z-[60] flex items-end">
      <div
        className="absolute inset-0 bg-[var(--bg-overlay)] backdrop-blur-md transition-opacity duration-300"
        onClick={handleClose}
        aria-hidden="true"
      />

      <div
        ref={sheetRef}
        className={`relative z-10 w-full max-h-[85vh] bg-[var(--bg-secondary)]/95 backdrop-blur-xl rounded-t-2xl flex flex-col shadow-2xl ring-1 ring-white/10 animate-slide-up ${sheetClassName}`}
      >
        <div
          className="flex justify-center mt-3 mb-2"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-10 h-1 rounded-full bg-[var(--border-subtle)]" />
        </div>

        {title && (
          <div
            className="flex items-center justify-between px-5 pb-4"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <h2 className="text-lg font-semibold text-[var(--content-primary)]">{title}</h2>
            <button
              onClick={handleClose}
              className="p-2 min-h-11 min-w-11 flex items-center justify-center -mr-2 rounded-lg text-[var(--content-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors duration-150"
              aria-label="Close"
            >
              <X size={20} weight="regular" />
            </button>
          </div>
        )}

        <div
          className={`overflow-y-auto overscroll-contain px-5 pb-5 ${contentClassName}`}
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 20px)' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
