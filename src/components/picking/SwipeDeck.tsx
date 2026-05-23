import { Children, useCallback, useRef, useState, type ReactNode } from 'react';

const SWIPE_THRESHOLD_RATIO = 0.18;
const VELOCITY_THRESHOLD = 0.45;
const VERTICAL_DOMINANCE = 1.4;
const VERTICAL_MIN_PX = 12;
const VERTICAL_OPEN_PX = 48;

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

  const snapTo = useCallback(
    (nextIndex: number) => {
      if (itemCount <= 0) return;
      const wrapped = ((nextIndex % itemCount) + itemCount) % itemCount;
      setAnimating(true);
      setDragOffset(0);
      onIndexChange(wrapped);
      window.setTimeout(() => setAnimating(false), 280);
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
      if (Math.abs(deltaY) > Math.abs(deltaX) * VERTICAL_DOMINANCE && Math.abs(deltaY) > VERTICAL_MIN_PX) {
        gestureRef.current = 'vertical';
        return;
      }
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        gestureRef.current = 'horizontal';
      }
    }

    if (gestureRef.current === 'horizontal') {
      setDragOffset(deltaX);
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
      if (deltaX < -threshold || (velocity > VELOCITY_THRESHOLD && deltaX < 0)) {
        snapTo(currentIndex + 1);
      } else if (deltaX > threshold || (velocity > VELOCITY_THRESHOLD && deltaX > 0)) {
        snapTo(currentIndex - 1);
      } else {
        setAnimating(true);
        setDragOffset(0);
        window.setTimeout(() => setAnimating(false), 280);
      }
    }

    startXRef.current = null;
    startYRef.current = null;
    gestureRef.current = 'none';
  };

  const trackOffset = -currentIndex * width + dragOffset;

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden touch-pan-y"
      style={{ height: 'min(72vh, 640px)' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div
        className="flex h-full"
        style={{
          transform: `translate3d(${trackOffset}px, 0, 0)`,
          transition: animating ? 'transform 280ms cubic-bezier(0.23, 1, 0.32, 1)' : 'none',
        }}
      >
        {Children.map(children, (child) => (
          <div className="h-full shrink-0" style={{ width }}>
            {child}
          </div>
        ))}
      </div>
      {itemCount > 1 && (
        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1">
          {Array.from({ length: Math.min(itemCount, 12) }).map((_, i) => {
            const dotIndex = itemCount <= 12 ? i : Math.floor((i / 12) * itemCount);
            return (
              <span
                key={dotIndex}
                className={`h-1.5 rounded-full transition-all ${
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
