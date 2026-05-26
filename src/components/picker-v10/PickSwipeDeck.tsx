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
  onSwipeUpDrag?: (progress: number) => void;
  onSwipeUpDragEnd?: () => void;
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
  onSwipeUpDrag,
  onSwipeUpDragEnd,
  children,
}: PickSwipeDeckProps): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col">
    <SwipeDeck
      variant="carousel"
      currentIndex={currentIndex}
      itemCount={itemCount}
      onIndexChange={onIndexChange}
      dotStatus={dotStatus}
      onSwipeUp={onSwipeUp}
      onSwipeUpDrag={onSwipeUpDrag}
      onSwipeUpDragEnd={onSwipeUpDragEnd}
    >
      {children}
    </SwipeDeck>
    </div>
  );
}
