import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const SWIPE_THRESHOLD_RATIO = 0.12;
const SWIPE_THRESHOLD_MIN_PX = 36;
const VELOCITY_THRESHOLD = 0.28;
const VELOCITY_DISTANCE_MIN_PX = 18;
const VERTICAL_DOMINANCE = 1.35;
const VERTICAL_MIN_PX = 10;
const VERTICAL_OPEN_PX = 44;
const GESTURE_LOCK_PX = 6;
const DRAG_OVERSCROLL_RATIO = 1.08;
const SNAP_MS = 260;
const SNAP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

interface SwipeDeckProps {
  currentIndex: number;
  itemCount: number;
  onIndexChange: (index: number) => void;
  /** Swipe up on the deck (e.g. open queue). Downward swipes are never intercepted — PWA pull-to-refresh stays available. */
  onSwipeUp?: () => void;
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
  children,
}: SwipeDeckProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const pointerIdRef = useRef<number | null>(null);
  const gestureRef = useRef<'none' | 'horizontal' | 'vertical'>('none');
  const dragOffsetRef = useRef(0);
  const animatingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);

  const width = viewportWidth > 0 ? viewportWidth : 320;
  const swipeThreshold = Math.max(SWIPE_THRESHOLD_MIN_PX, width * SWIPE_THRESHOLD_RATIO);
  const maxDrag = width * DRAG_OVERSCROLL_RATIO;
  const swipeUpEnabled = Boolean(onSwipeUp);

  const releasePointer = (event: React.PointerEvent) => {
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    pointerIdRef.current = null;
    startXRef.current = null;
    startYRef.current = null;
  };

  const abandonGesture = (event: React.PointerEvent) => {
    releasePointer(event);
    gestureRef.current = 'none';
  };

  const getTrackOffset = useCallback(
    (index: number, drag: number) => -index * width + drag,
    [width],
  );

  const paintTrack = useCallback(
    (index: number, drag: number, animate: boolean) => {
      const track = trackRef.current;
      if (!track) return;
      track.style.transition = animate ? `transform ${SNAP_MS}ms ${SNAP_EASING}` : 'none';
      track.style.transform = `translate3d(${getTrackOffset(index, drag)}px, 0, 0)`;
    },
    [getTrackOffset],
  );

  const schedulePaint = useCallback(
    (index: number, drag: number, animate: boolean) => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        paintTrack(index, drag, animate);
        rafRef.current = null;
      });
    },
    [paintTrack],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? 0;
      if (nextWidth > 0) setViewportWidth(nextWidth);
    });
    ro.observe(el);
    setViewportWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!animatingRef.current) {
      dragOffsetRef.current = 0;
      paintTrack(currentIndex, 0, false);
    }
  }, [currentIndex, width, paintTrack]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const snapToIndex = useCallback(
    (nextIndex: number, animate = true) => {
      if (itemCount <= 0) return;
      const wrapped = wrapIndex(nextIndex, itemCount);
      dragOffsetRef.current = 0;
      animatingRef.current = animate;
      paintTrack(wrapped, 0, animate);
      onIndexChange(wrapped);
      if (animate) {
        window.setTimeout(() => {
          animatingRef.current = false;
        }, SNAP_MS);
      } else {
        animatingRef.current = false;
      }
    },
    [itemCount, onIndexChange, paintTrack],
  );

  const animateWrap = useCallback(
    (fromIndex: number, direction: 1 | -1) => {
      if (itemCount <= 1) {
        dragOffsetRef.current = 0;
        paintTrack(fromIndex, 0, true);
        return;
      }

      const targetIndex = wrapIndex(fromIndex + direction, itemCount);
      const exitDrag = direction < 0 ? -maxDrag : maxDrag;
      animatingRef.current = true;
      paintTrack(fromIndex, exitDrag, true);

      window.setTimeout(() => {
        dragOffsetRef.current = 0;
        paintTrack(targetIndex, 0, false);
        onIndexChange(targetIndex);
        window.requestAnimationFrame(() => {
          animatingRef.current = false;
        });
      }, SNAP_MS);
    },
    [itemCount, maxDrag, onIndexChange, paintTrack],
  );

  const handlePointerDown = (event: React.PointerEvent) => {
    if (itemCount <= 1) return;
    if (animatingRef.current) return;

    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
    startTimeRef.current = performance.now();
    pointerIdRef.current = event.pointerId;
    gestureRef.current = 'none';
    dragOffsetRef.current = 0;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    paintTrack(currentIndex, 0, false);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (startXRef.current === null || startYRef.current === null) return;
    if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return;

    const deltaX = event.clientX - startXRef.current;
    const deltaY = event.clientY - startYRef.current;

    if (gestureRef.current === 'none') {
      if (Math.abs(deltaX) < GESTURE_LOCK_PX && Math.abs(deltaY) < GESTURE_LOCK_PX) return;
      if (
        Math.abs(deltaY) > Math.abs(deltaX) * VERTICAL_DOMINANCE &&
        Math.abs(deltaY) > VERTICAL_MIN_PX
      ) {
        // Only claim swipe-up for queue open. Swipe-down is left to the browser
        // so PWA pull-to-refresh and page scroll are never blocked.
        if (deltaY < 0 && swipeUpEnabled) {
          gestureRef.current = 'vertical';
        } else {
          abandonGesture(event);
          return;
        }
      } else if (Math.abs(deltaX) >= Math.abs(deltaY)) {
        gestureRef.current = 'horizontal';
      }
    }

    if (gestureRef.current !== 'horizontal') return;

    const clampedDrag = Math.max(-maxDrag, Math.min(maxDrag, deltaX));
    dragOffsetRef.current = clampedDrag;
    schedulePaint(currentIndex, clampedDrag, false);
    event.preventDefault();
  };

  const finishPointer = (event: React.PointerEvent) => {
    if (startXRef.current === null || startYRef.current === null) return;
    if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return;

    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }

    const deltaX = event.clientX - (startXRef.current ?? event.clientX);
    const deltaY = event.clientY - (startYRef.current ?? event.clientY);
    const elapsed = Math.max(1, performance.now() - startTimeRef.current);
    const velocity = Math.abs(deltaX) / elapsed;

    if (gestureRef.current === 'vertical') {
      if (deltaY < -VERTICAL_OPEN_PX) onSwipeUp?.();
    } else if (gestureRef.current === 'horizontal') {
      const fling = velocity > VELOCITY_THRESHOLD && Math.abs(deltaX) > VELOCITY_DISTANCE_MIN_PX;
      const goNext = deltaX < -swipeThreshold || (fling && deltaX < 0);
      const goPrev = deltaX > swipeThreshold || (fling && deltaX > 0);

      if (goNext) {
        if (currentIndex >= itemCount - 1) {
          animateWrap(currentIndex, -1);
        } else {
          snapToIndex(currentIndex + 1);
        }
      } else if (goPrev) {
        if (currentIndex <= 0) {
          animateWrap(currentIndex, 1);
        } else {
          snapToIndex(currentIndex - 1);
        }
      } else {
        dragOffsetRef.current = 0;
        animatingRef.current = true;
        paintTrack(currentIndex, 0, true);
        window.setTimeout(() => {
          animatingRef.current = false;
        }, SNAP_MS);
      }
    } else if (dragOffsetRef.current !== 0) {
      dragOffsetRef.current = 0;
      paintTrack(currentIndex, 0, true);
    }

    startXRef.current = null;
    startYRef.current = null;
    pointerIdRef.current = null;
    gestureRef.current = 'none';
  };

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative select-none overflow-hidden touch-pan-y"
        style={{ height: 'min(62vh, 540px)', touchAction: 'pan-y pinch-zoom' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
      >
        <div ref={trackRef} className="flex h-full will-change-transform">
          {Children.map(children, (child) => (
            <div className="h-full shrink-0 overflow-hidden" style={{ width }}>
              {child}
            </div>
          ))}
        </div>
      </div>
      {itemCount > 1 && (
        <div className="flex justify-center gap-1 py-0.5">
          {Array.from({ length: Math.min(itemCount, 12) }).map((_, i) => {
            const dotIndex = itemCount <= 12 ? i : Math.floor((i / 12) * itemCount);
            return (
              <span
                key={dotIndex}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  dotIndex === currentIndex
                    ? 'w-4 bg-[var(--role-primary)]'
                    : 'w-1.5 bg-[var(--border-opaque)]'
                }`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
