import { Children, useCallback, useRef, useState, type ReactNode } from 'react';

const SWIPE_THRESHOLD_RATIO = 0.18;
const VELOCITY_THRESHOLD = 0.45;
const VERTICAL_DOMINANCE = 1.4;
const VERTICAL_MIN_PX = 12;
const VERTICAL_OPEN_PX = 48;
const EDGE_RUBBER_BAND = 0.32;
const SNAP_MS = 320;

interface SwipeDeckProps {
  currentIndex: number;
  itemCount: number;
  onIndexChange: (index: number) => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  children: ReactNode;
}

export function SwipeDeck({
  currentIndex,
  itemCount,
  onIndexChange,
  onSwipeUp,
  onSwipeDown,
  children,
}: SwipeDeckProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const gestureRef = useRef<'none' | 'horizontal' | 'vertical'>('none');
  const [dragOffset, setDragOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);

  const width = viewportWidth || containerRef.current?.clientWidth || 320;

  const rubberBand = useCallback(
    (deltaX: number) => {
      const atStart = currentIndex <= 0;
      const atEnd = currentIndex >= itemCount - 1;
      if (atStart && deltaX > 0) return deltaX * EDGE_RUBBER_BAND;
      if (atEnd && deltaX < 0) return deltaX * EDGE_RUBBER_BAND;
      return deltaX;
    },
    [currentIndex, itemCount],
  );

  const snapTo = useCallback(
    (nextIndex: number) => {
      if (itemCount <= 0) return;
      const wrapped = ((nextIndex % itemCount) + itemCount) % itemCount;
      setAnimating(true);
      setDragOffset(0);
      onIndexChange(wrapped);
      window.setTimeout(() => setAnimating(false), SNAP_MS);
    },
    [itemCount, onIndexChange],
  );

  const handlePointerDown = (event: React.PointerEvent) => {
    if (itemCount <= 1) return;
    if (containerRef.current) {
      setViewportWidth(containerRef.current.clientWidth);
    }
    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
    startTimeRef.current = Date.now();
    gestureRef.current = 'none';
    setAnimating(false);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (startXRef.current === null || startYRef.current === null) return;
    const deltaX = event.clientX - startXRef.current;
    const deltaY = event.clientY - startYRef.current;

    if (gestureRef.current === 'none') {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      if (
        Math.abs(deltaY) > Math.abs(deltaX) * VERTICAL_DOMINANCE &&
        Math.abs(deltaY) > VERTICAL_MIN_PX
      ) {
        gestureRef.current = 'vertical';
        return;
      }
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        gestureRef.current = 'horizontal';
      }
    }

    if (gestureRef.current === 'horizontal') {
      setDragOffset(rubberBand(deltaX));
    }
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    if (startXRef.current === null || startYRef.current === null) return;
    const deltaX = event.clientX - startXRef.current;
    const deltaY = event.clientY - startYRef.current;
    const elapsed = Math.max(1, Date.now() - startTimeRef.current);
    const velocity = Math.abs(deltaX) / elapsed;

    if (gestureRef.current === 'vertical') {
      if (deltaY < -VERTICAL_OPEN_PX) onSwipeUp?.();
      else if (deltaY > VERTICAL_OPEN_PX) onSwipeDown?.();
    } else if (gestureRef.current === 'horizontal') {
      const threshold = width * SWIPE_THRESHOLD_RATIO;
      const atStart = currentIndex <= 0;
      const atEnd = currentIndex >= itemCount - 1;
      if (deltaX < -threshold || (velocity > VELOCITY_THRESHOLD && deltaX < 0)) {
        if (!atEnd) snapTo(currentIndex + 1);
        else {
          setAnimating(true);
          setDragOffset(0);
          window.setTimeout(() => setAnimating(false), SNAP_MS);
        }
      } else if (deltaX > threshold || (velocity > VELOCITY_THRESHOLD && deltaX > 0)) {
        if (!atStart) snapTo(currentIndex - 1);
        else {
          setAnimating(true);
          setDragOffset(0);
          window.setTimeout(() => setAnimating(false), SNAP_MS);
        }
      } else {
        setAnimating(true);
        setDragOffset(0);
        window.setTimeout(() => setAnimating(false), SNAP_MS);
      }
    }

    startXRef.current = null;
    startYRef.current = null;
    gestureRef.current = 'none';
  };

  const trackOffset = -currentIndex * width + dragOffset;

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="relative touch-pan-y select-none overflow-hidden"
        style={{ height: 'min(62vh, 540px)' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="flex h-full will-change-transform"
          style={{
            transform: `translate3d(${trackOffset}px, 0, 0)`,
            transition: animating
              ? `transform ${SNAP_MS}ms cubic-bezier(0.23, 1, 0.32, 1)`
              : 'none',
          }}
        >
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
