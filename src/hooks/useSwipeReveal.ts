import { useCallback, useEffect, useRef } from 'react';

const SWIPE_OPEN_RATIO = 0.42;
const SWIPE_OPEN_MIN_PX = 28;
const GESTURE_LOCK_PX = 5;
const VERTICAL_DOMINANCE = 1.2;
const DRAG_GAIN = 1.08;

export interface SwipeRevealAction {
  id: string;
  widthPx: number;
}

interface UseSwipeRevealOptions {
  actions: SwipeRevealAction[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  enabled?: boolean;
}

interface UseSwipeRevealResult {
  panelRef: React.RefObject<HTMLDivElement | null>;
  actionWidth: number;
  bind: {
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: (event: React.PointerEvent) => void;
    onPointerCancel: (event: React.PointerEvent) => void;
  };
  close: () => void;
}

export function useSwipeReveal({
  actions,
  isOpen,
  onOpenChange,
  enabled = true,
}: UseSwipeRevealOptions): UseSwipeRevealResult {
  const panelRef = useRef<HTMLDivElement>(null);
  const actionWidth = actions.reduce((sum, action) => sum + action.widthPx, 0);
  const offsetRef = useRef(isOpen ? actionWidth : 0);
  const baseOffsetRef = useRef(0);
  const startXRef = useRef<number | null>(null);
  const startYRef = useRef<number | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const gestureRef = useRef<'none' | 'horizontal' | 'vertical'>('none');
  const isDraggingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const openThreshold = Math.max(SWIPE_OPEN_MIN_PX, actionWidth * SWIPE_OPEN_RATIO);

  const paint = useCallback((offset: number, animate: boolean) => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.style.transition = animate ? 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
    panel.style.transform = `translate3d(-${offset}px, 0, 0)`;
  }, []);

  const setOffset = useCallback((next: number, animate: boolean) => {
    const clamped = Math.max(0, Math.min(actionWidth, next));
    offsetRef.current = clamped;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      paint(clamped, animate);
      rafRef.current = null;
    });
  }, [actionWidth, paint]);

  const close = useCallback(() => {
    setOffset(0, true);
    onOpenChange(false);
  }, [onOpenChange, setOffset]);

  useEffect(() => {
    offsetRef.current = isOpen ? actionWidth : 0;
    paint(offsetRef.current, false);
  }, [actionWidth, isOpen, paint]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    if (!enabled || actionWidth <= 0) return;
    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
    baseOffsetRef.current = isOpen ? actionWidth : 0;
    gestureRef.current = 'none';
    isDraggingRef.current = true;
    pointerIdRef.current = event.pointerId;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    paint(baseOffsetRef.current, false);
  }, [actionWidth, enabled, isOpen, paint]);

  const handlePointerMove = useCallback((event: React.PointerEvent) => {
    if (!enabled || startXRef.current === null || startYRef.current === null) return;
    if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return;

    const deltaX = startXRef.current - event.clientX;
    const deltaY = startYRef.current - event.clientY;

    if (gestureRef.current === 'none') {
      if (Math.abs(deltaX) < GESTURE_LOCK_PX && Math.abs(deltaY) < GESTURE_LOCK_PX) return;
      if (Math.abs(deltaY) > Math.abs(deltaX) * VERTICAL_DOMINANCE) {
        gestureRef.current = 'vertical';
        isDraggingRef.current = false;
        try {
          (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
        } catch {
          /* already released */
        }
        pointerIdRef.current = null;
        startXRef.current = null;
        startYRef.current = null;
        return;
      }
      gestureRef.current = 'horizontal';
    }

    if (gestureRef.current !== 'horizontal') return;

    const nextOffset = baseOffsetRef.current + (deltaX * DRAG_GAIN);
    setOffset(nextOffset, false);
    event.preventDefault();
  }, [enabled, setOffset]);

  const finishGesture = useCallback((event: React.PointerEvent) => {
    if (pointerIdRef.current !== null && event.pointerId !== pointerIdRef.current) return;

    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }

    if (gestureRef.current === 'horizontal') {
      if (offsetRef.current >= openThreshold) {
        setOffset(actionWidth, true);
        onOpenChange(true);
      } else {
        close();
      }
    }

    startXRef.current = null;
    startYRef.current = null;
    pointerIdRef.current = null;
    gestureRef.current = 'none';
    isDraggingRef.current = false;
  }, [actionWidth, close, onOpenChange, openThreshold, setOffset]);

  return {
    panelRef,
    actionWidth,
    bind: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: finishGesture,
      onPointerCancel: finishGesture,
    },
    close,
  };
}
