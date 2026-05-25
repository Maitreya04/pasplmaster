import { type ReactNode } from 'react';
import { SwipeDeck, type SwipeDeckDotStatus } from '../picking/SwipeDeck';

export type { SwipeDeckDotStatus as PickSwipeDotStatus };

export interface PickSwipeDeckProps {
  currentIndex: number;
  itemCount: number;
  onIndexChange: (index: number) => void;
  /** Per-line status for colored page dots. */
  dotStatus?: SwipeDeckDotStatus[];
  onSwipeUp?: () => void;
  children: ReactNode;
}

/**
 * V10 pick deck — horizontal swipe with centered page indicators and status dots.
 * Wraps the shared SwipeDeck gesture engine (GPU track, velocity fling, no lag).
 */
export function PickSwipeDeck({
  currentIndex,
  itemCount,
  onIndexChange,
  dotStatus,
  onSwipeUp,
  children,
}: PickSwipeDeckProps): React.JSX.Element {
  return (
    <SwipeDeck
      variant="carousel"
      currentIndex={currentIndex}
      itemCount={itemCount}
      onIndexChange={onIndexChange}
      dotStatus={dotStatus}
      onSwipeUp={onSwipeUp}
      hint="Swipe › next line · ‹ previous"
    >
      {children}
    </SwipeDeck>
  );
}
