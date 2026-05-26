import {
  Children,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import { appHaptics } from '../../lib/haptics';

const SWIPE_THRESHOLD_RATIO = 0.11;
const SWIPE_THRESHOLD_MIN_PX = 32;
const VELOCITY_THRESHOLD = 0.22;
const VELOCITY_DISTANCE_MIN_PX = 14;
const VERTICAL_DOMINANCE = 1.15;
const VERTICAL_MIN_PX = 8;
const VERTICAL_OPEN_PX = 28;
const VERTICAL_DRAG_MAX_PX = 80;
const GESTURE_LOCK_PX = 5;
const DRAG_OVERSCROLL_RATIO = 1.05;
const SNAP_MS = 220;
const SNAP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

export type SwipeDeckDotStatus = 'pending' | 'active' | 'done' | 'partial' | 'flagged';

interface SwipeDeckProps {
  currentIndex: number;
  itemCount: number;
  onIndexChange: (index: number) => void;
  /** Swipe up on the deck (e.g. open queue). Downward swipes are never intercepted — PWA pull-to-refresh stays available. */
  onSwipeUp?: () => void;
  /** 0–1 while dragging up — use to lift the status panel below the deck. */
  onSwipeUpDrag?: (progress: number) => void;
  /** Called when a vertical swipe gesture ends (progress resets to 0). */
  onSwipeUpDragEnd?: () => void;
  /** `carousel` — centered dots, slide inset, inactive scale. */
  variant?: 'default' | 'carousel';
  dotStatus?: SwipeDeckDotStatus[];
  hint?: string;
  children: ReactNode;
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

export function SwipeDeck({
  currentIndex,
  itemCount,
  onIndexChange,
  onSwipeUp,
  onSwipeUpDrag,
  onSwipeUpDragEnd,
  variant = 'default',
  dotStatus,
  hint,
  children,
}: SwipeDeckProps): React.JSX.Element {
  const isCarousel = variant === 'carousel';
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef(320);
  const currentIndexRef = useRef(currentIndex);
  const itemCountRef = useRef(itemCount);
  const onIndexChangeRef = useRef(onIndexChange);
  const onSwipeUpRef = useRef(onSwipeUp);
  const onSwipeUpDragRef = useRef(onSwipeUpDrag);
  const onSwipeUpDragEndRef = useRef(onSwipeUpDragEnd);
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const gestureRef = useRef<'none' | 'horizontal' | 'vertical'>('none');
  const dragOffsetRef = useRef(0);
  const animatingRef = useRef(false);
  const draggingRef = useRef(false);

  currentIndexRef.current = currentIndex;
  itemCountRef.current = itemCount;
  onIndexChangeRef.current = onIndexChange;
  onSwipeUpRef.current = onSwipeUp;
  onSwipeUpDragRef.current = onSwipeUpDrag;
  onSwipeUpDragEndRef.current = onSwipeUpDragEnd;

  const getTrackOffset = useCallback((index: number, drag: number) => {
    return -index * widthRef.current + drag;
  }, []);

  const paintTrack = useCallback((index: number, drag: number, animate: boolean) => {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = animate ? `transform ${SNAP_MS}ms ${SNAP_EASING}` : 'none';
    track.style.transform = `translate3d(${getTrackOffset(index, drag)}px, 0, 0)`;
  }, [getTrackOffset]);

  const snapToIndex = useCallback((nextIndex: number, animate = true) => {
    const count = itemCountRef.current;
    if (count <= 0) return;
    const wrapped = wrapIndex(nextIndex, count);
    const changed = wrapped !== currentIndexRef.current;
    dragOffsetRef.current = 0;
    draggingRef.current = false;
    animatingRef.current = animate;
    paintTrack(wrapped, 0, animate);
    onIndexChangeRef.current(wrapped);
    if (changed) {
      appHaptics.selection();
    }
    if (animate) {
      window.setTimeout(() => {
        animatingRef.current = false;
      }, SNAP_MS);
    } else {
      animatingRef.current = false;
    }
  }, [paintTrack]);

  const animateWrap = useCallback((fromIndex: number, direction: 1 | -1) => {
    const count = itemCountRef.current;
    if (count <= 1) {
      dragOffsetRef.current = 0;
      paintTrack(fromIndex, 0, true);
      return;
    }

    const maxDrag = widthRef.current * DRAG_OVERSCROLL_RATIO;
    const targetIndex = wrapIndex(fromIndex + direction, count);
    const exitDrag = direction < 0 ? -maxDrag : maxDrag;
    animatingRef.current = true;
    draggingRef.current = false;
    paintTrack(fromIndex, exitDrag, true);

    window.setTimeout(() => {
      dragOffsetRef.current = 0;
      paintTrack(targetIndex, 0, false);
      onIndexChangeRef.current(targetIndex);
      appHaptics.selection();
      window.requestAnimationFrame(() => {
        animatingRef.current = false;
      });
    }, SNAP_MS);
  }, [paintTrack]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measured = el.clientWidth;
    if (measured > 0) {
      widthRef.current = measured;
      el.style.setProperty('--swipe-slide-width', `${measured}px`);
      if (!draggingRef.current && !animatingRef.current) {
        paintTrack(currentIndexRef.current, 0, false);
      }
    }
  }, [paintTrack, itemCount]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? 0;
      if (nextWidth <= 0) return;
      widthRef.current = nextWidth;
      el.style.setProperty('--swipe-slide-width', `${nextWidth}px`);
      if (!draggingRef.current && !animatingRef.current) {
        paintTrack(currentIndexRef.current, 0, false);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [paintTrack]);

  useEffect(() => {
    if (!draggingRef.current && !animatingRef.current) {
      dragOffsetRef.current = 0;
      paintTrack(currentIndex, 0, false);
    }
  }, [currentIndex, paintTrack]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const swipeUpEnabled = () => Boolean(onSwipeUpRef.current);
    const emitDragProgress = (deltaY: number) => {
      if (deltaY >= 0) {
        el.style.setProperty('--swipe-up-progress', '0');
        onSwipeUpDragRef.current?.(0);
        return;
      }
      const progress = Math.min(1, Math.abs(deltaY) / VERTICAL_DRAG_MAX_PX);
      el.style.setProperty('--swipe-up-progress', String(progress));
      onSwipeUpDragRef.current?.(progress);
    };
    const endVerticalDrag = () => {
      el.style.setProperty('--swipe-up-progress', '0');
      onSwipeUpDragRef.current?.(0);
      onSwipeUpDragEndRef.current?.();
    };

    const finishGesture = (clientX: number, clientY: number) => {
      if (startXRef.current === null || startYRef.current === null) return;

      const deltaX = clientX - startXRef.current;
      const deltaY = clientY - startYRef.current;
      const elapsed = Math.max(1, performance.now() - startTimeRef.current);
      const velocity = Math.abs(deltaX) / elapsed;
      const verticalVelocity = Math.abs(deltaY) / elapsed;
      const width = widthRef.current;
      const swipeThreshold = Math.max(SWIPE_THRESHOLD_MIN_PX, width * SWIPE_THRESHOLD_RATIO);
      const idx = currentIndexRef.current;
      const count = itemCountRef.current;

      if (gestureRef.current === 'vertical') {
        endVerticalDrag();
        const flingUp = verticalVelocity > VELOCITY_THRESHOLD && deltaY < -VELOCITY_DISTANCE_MIN_PX;
        if (deltaY < -VERTICAL_OPEN_PX || flingUp) {
          appHaptics.impactLight();
          onSwipeUpRef.current?.();
        }
      } else if (gestureRef.current === 'horizontal') {
        const fling = velocity > VELOCITY_THRESHOLD && Math.abs(deltaX) > VELOCITY_DISTANCE_MIN_PX;
        const goNext = deltaX < -swipeThreshold || (fling && deltaX < 0);
        const goPrev = deltaX > swipeThreshold || (fling && deltaX > 0);

        if (goNext) {
          if (idx >= count - 1) animateWrap(idx, -1);
          else snapToIndex(idx + 1);
        } else if (goPrev) {
          if (idx <= 0) animateWrap(idx, 1);
          else snapToIndex(idx - 1);
        } else {
          dragOffsetRef.current = 0;
          animatingRef.current = true;
          paintTrack(idx, 0, true);
          window.setTimeout(() => {
            animatingRef.current = false;
          }, SNAP_MS);
        }
      } else if (dragOffsetRef.current !== 0) {
        dragOffsetRef.current = 0;
        paintTrack(idx, 0, true);
      }

      draggingRef.current = false;
      startXRef.current = null;
      startYRef.current = null;
      gestureRef.current = 'none';
    };

    const onTouchStart = (event: TouchEvent) => {
      if (animatingRef.current) return;
      if (itemCountRef.current <= 1 && !swipeUpEnabled()) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      startXRef.current = touch.clientX;
      startYRef.current = touch.clientY;
      startTimeRef.current = performance.now();
      gestureRef.current = 'none';
      dragOffsetRef.current = 0;
      draggingRef.current = true;
      paintTrack(currentIndexRef.current, 0, false);
    };

    const readTouch = (event: TouchEvent) => event.touches[0] ?? event.changedTouches[0];

    const onTouchMove = (event: TouchEvent) => {
      if (!draggingRef.current || startXRef.current === null || startYRef.current === null) return;
      const touch = readTouch(event);
      if (!touch) return;

      const deltaX = touch.clientX - startXRef.current;
      const deltaY = touch.clientY - startYRef.current;
      const maxDrag = widthRef.current * DRAG_OVERSCROLL_RATIO;

      if (gestureRef.current === 'none') {
        if (Math.abs(deltaX) < GESTURE_LOCK_PX && Math.abs(deltaY) < GESTURE_LOCK_PX) return;
        if (
          Math.abs(deltaY) > Math.abs(deltaX) * VERTICAL_DOMINANCE &&
          Math.abs(deltaY) > VERTICAL_MIN_PX
        ) {
          if (deltaY < 0 && swipeUpEnabled()) {
            gestureRef.current = 'vertical';
          } else {
            draggingRef.current = false;
            startXRef.current = null;
            startYRef.current = null;
            return;
          }
        } else if (Math.abs(deltaX) >= Math.abs(deltaY)) {
          gestureRef.current = 'horizontal';
        }
      }

      if (gestureRef.current === 'vertical') {
        emitDragProgress(deltaY);
        event.preventDefault();
        return;
      }

      if (gestureRef.current !== 'horizontal') return;

      const clampedDrag = Math.max(-maxDrag, Math.min(maxDrag, deltaX));
      dragOffsetRef.current = clampedDrag;
      paintTrack(currentIndexRef.current, clampedDrag, false);
      event.preventDefault();
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!draggingRef.current && gestureRef.current === 'none') return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      finishGesture(touch.clientX, touch.clientY);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      if (animatingRef.current) return;
      if (itemCountRef.current <= 1 && !swipeUpEnabled()) return;
      startXRef.current = event.clientX;
      startYRef.current = event.clientY;
      startTimeRef.current = performance.now();
      gestureRef.current = 'none';
      dragOffsetRef.current = 0;
      draggingRef.current = true;
      el.setPointerCapture(event.pointerId);
      paintTrack(currentIndexRef.current, 0, false);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      if (!draggingRef.current || startXRef.current === null || startYRef.current === null) return;

      const deltaX = event.clientX - startXRef.current;
      const deltaY = event.clientY - startYRef.current;
      const maxDrag = widthRef.current * DRAG_OVERSCROLL_RATIO;

      if (gestureRef.current === 'none') {
        if (Math.abs(deltaX) < GESTURE_LOCK_PX && Math.abs(deltaY) < GESTURE_LOCK_PX) return;
        if (
          Math.abs(deltaY) > Math.abs(deltaX) * VERTICAL_DOMINANCE &&
          Math.abs(deltaY) > VERTICAL_MIN_PX
        ) {
          if (deltaY < 0 && swipeUpEnabled()) {
            gestureRef.current = 'vertical';
          } else {
            draggingRef.current = false;
            startXRef.current = null;
            startYRef.current = null;
            try { el.releasePointerCapture(event.pointerId); } catch { /* noop */ }
            return;
          }
        } else if (Math.abs(deltaX) >= Math.abs(deltaY)) {
          gestureRef.current = 'horizontal';
        }
      }

      if (gestureRef.current === 'vertical') {
        emitDragProgress(deltaY);
        event.preventDefault();
        return;
      }

      if (gestureRef.current !== 'horizontal') return;

      const clampedDrag = Math.max(-maxDrag, Math.min(maxDrag, deltaX));
      dragOffsetRef.current = clampedDrag;
      paintTrack(currentIndexRef.current, clampedDrag, false);
      event.preventDefault();
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      if (!draggingRef.current && gestureRef.current === 'none') return;
      try { el.releasePointerCapture(event.pointerId); } catch { /* noop */ }
      finishGesture(event.clientX, event.clientY);
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
    };
  }, [animateWrap, itemCount, paintTrack, snapToIndex]);

  const childArray = Children.toArray(children);

  const dotClass = (index: number): string => {
    const status = dotStatus?.[index] ?? (index === currentIndex ? 'active' : 'pending');
    const isActive = index === currentIndex || status === 'active';
    if (isActive) {
      return 'h-2.5 w-6 bg-[var(--role-primary)] shadow-sm';
    }
    switch (status) {
      case 'done':
        return 'h-2 w-2 bg-[var(--bg-positive)]';
      case 'partial':
        return 'h-2 w-2 bg-[var(--bg-warning)]';
      case 'flagged':
        return 'h-2 w-2 bg-[var(--bg-negative)]';
      default:
        return 'h-2 w-2 bg-[var(--border-opaque)] hover:bg-[var(--content-tertiary)]';
    }
  };

  const dotAriaLabel = (index: number): string => {
    const status = dotStatus?.[index] ?? (index === currentIndex ? 'active' : 'pending');
    const statusWord =
      status === 'done'
        ? 'picked'
        : status === 'active'
          ? 'current'
          : status;
    return `Line ${index + 1} of ${itemCount}, ${statusWord}`;
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div
        ref={containerRef}
        className={`relative min-h-0 flex-1 overflow-hidden select-none ${isCarousel ? 'px-0.5' : ''} pick-deck-height`}
        style={{
          touchAction: onSwipeUp ? 'pan-x pinch-zoom' : 'pan-y pinch-zoom',
          ['--swipe-up-progress' as string]: '0',
        }}
      >
        {onSwipeUp ? (
          <div
            className="pick-deck-pull-zone absolute inset-x-0 bottom-0 z-20 flex items-end justify-center pb-1.5 pt-6"
            aria-hidden
          >
            <span className="pick-deck-swipe-hint inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-secondary)]/95 px-3 py-1 text-[10px] font-semibold text-[var(--content-secondary)] shadow-sm backdrop-blur-sm">
              ↑ Queue
            </span>
          </div>
        ) : null}
        <div className="pick-deck-lift h-full min-h-0">
        <div
          ref={trackRef}
          className="flex h-full"
          style={{ willChange: 'transform', backfaceVisibility: 'hidden' }}
        >
          {childArray.map((child, index) => {
            const isActive = index === currentIndex;
            return (
              <div
                key={index}
                className="h-full shrink-0 overflow-hidden"
                style={{ width: 'var(--swipe-slide-width, 100%)' }}
              >
                <div
                  className={`h-full transition-[transform,opacity] duration-200 ease-out ${
                    isCarousel ? 'px-1.5' : ''
                  } ${
                    isActive
                      ? 'scale-100 opacity-100'
                      : isCarousel
                        ? 'scale-[0.94] opacity-80'
                        : 'scale-100 opacity-100'
                  }`}
                  style={{
                    transform: isActive ? 'translateZ(0)' : undefined,
                    willChange: isCarousel ? 'transform, opacity' : undefined,
                  }}
                >
                  {child}
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </div>
      {itemCount > 1 && (
        <div className="shrink-0 space-y-1">
          <div
            className={`flex max-w-full gap-1.5 overflow-x-auto py-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
              isCarousel ? 'justify-center px-4' : 'justify-start px-3'
            }`}
            role="tablist"
            aria-label="Pick lines"
          >
            {Array.from({ length: itemCount }).map((_, index) => {
              const isActive = index === currentIndex;
              return (
                <button
                  key={index}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={dotAriaLabel(index)}
                  onClick={() => {
                    if (index === currentIndexRef.current) return;
                    snapToIndex(index, true);
                  }}
                  className="flex min-h-11 min-w-11 shrink-0 items-center justify-center pick-pressable"
                >
                  <span
                    className={`rounded-full transition-all duration-200 ${dotClass(index)}`}
                  />
                </button>
              );
            })}
          </div>
          {hint ? (
            <p className="text-center text-[10px] font-medium text-[var(--content-tertiary)]">{hint}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
