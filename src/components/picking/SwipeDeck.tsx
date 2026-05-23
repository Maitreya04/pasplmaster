import {
  Children,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';

const SWIPE_THRESHOLD_RATIO = 0.11;
const SWIPE_THRESHOLD_MIN_PX = 32;
const VELOCITY_THRESHOLD = 0.22;
const VELOCITY_DISTANCE_MIN_PX = 14;
const VERTICAL_DOMINANCE = 1.35;
const VERTICAL_MIN_PX = 10;
const VERTICAL_OPEN_PX = 44;
const GESTURE_LOCK_PX = 5;
const DRAG_OVERSCROLL_RATIO = 1.05;
const SNAP_MS = 220;
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
  const widthRef = useRef(320);
  const currentIndexRef = useRef(currentIndex);
  const itemCountRef = useRef(itemCount);
  const onIndexChangeRef = useRef(onIndexChange);
  const onSwipeUpRef = useRef(onSwipeUp);
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
    dragOffsetRef.current = 0;
    draggingRef.current = false;
    animatingRef.current = animate;
    paintTrack(wrapped, 0, animate);
    onIndexChangeRef.current(wrapped);
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
    if (!el || itemCount <= 1) return;

    const swipeUpEnabled = () => Boolean(onSwipeUpRef.current);

    const finishGesture = (clientX: number, clientY: number) => {
      if (startXRef.current === null || startYRef.current === null) return;

      const deltaX = clientX - startXRef.current;
      const deltaY = clientY - startYRef.current;
      const elapsed = Math.max(1, performance.now() - startTimeRef.current);
      const velocity = Math.abs(deltaX) / elapsed;
      const width = widthRef.current;
      const swipeThreshold = Math.max(SWIPE_THRESHOLD_MIN_PX, width * SWIPE_THRESHOLD_RATIO);
      const idx = currentIndexRef.current;
      const count = itemCountRef.current;

      if (gestureRef.current === 'vertical') {
        if (deltaY < -VERTICAL_OPEN_PX) onSwipeUpRef.current?.();
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
      if (animatingRef.current || itemCountRef.current <= 1) return;
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
      if (animatingRef.current || itemCountRef.current <= 1) return;
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

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative overflow-hidden select-none touch-pan-y"
        style={{
          height: 'min(62vh, 540px)',
          touchAction: 'pan-y pinch-zoom',
          contain: 'strict',
        }}
      >
        <div
          ref={trackRef}
          className="flex h-full"
          style={{ willChange: 'transform', backfaceVisibility: 'hidden' }}
        >
          {childArray.map((child, index) => (
            <div
              key={index}
              className="h-full shrink-0 overflow-hidden"
              style={{ width: 'var(--swipe-slide-width, 100%)' }}
            >
              {child}
            </div>
          ))}
        </div>
      </div>
      {itemCount > 1 && (
        <div
          className="flex max-w-full justify-start gap-1.5 overflow-x-auto px-3 py-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                aria-label={`Line ${index + 1} of ${itemCount}`}
                onClick={() => {
                  if (index === currentIndexRef.current) return;
                  snapToIndex(index, false);
                }}
                className={`shrink-0 rounded-full pick-pressable transition-all duration-200 ${
                  isActive
                    ? 'h-2 w-5 bg-[var(--role-primary)]'
                    : 'h-2 w-2 bg-[var(--border-opaque)] hover:bg-[var(--content-tertiary)]'
                }`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
