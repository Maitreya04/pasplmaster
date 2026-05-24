import { useCallback, useRef, useState } from 'react';
import type { OrderWithClaimInfo } from '../../hooks/useClaimableOrders';
import { QueueSectionHeader } from '../shared/QueueSectionHeader';
import { BeingPickedCard } from './BeingPickedCard';

interface BeingPickedCarouselProps {
  orders: OrderWithClaimInfo[];
  myOrderIds: Set<number>;
  onResume: (orderId: number) => void;
}

export function BeingPickedCarousel({
  orders,
  myOrderIds,
  onResume,
}: BeingPickedCarouselProps): React.JSX.Element | null {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || orders.length === 0) return;
    const cardWidth = el.scrollWidth / orders.length;
    const index = Math.round(el.scrollLeft / cardWidth);
    setActiveIndex(Math.min(Math.max(index, 0), orders.length - 1));
  }, [orders.length]);

  if (orders.length === 0) return null;

  return (
    <section className="space-y-2">
      <QueueSectionHeader label="Being picked" count={orders.length} className="pb-1" />

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex gap-2 overflow-x-auto snap-x snap-mandatory scrollbar-none -mx-4 px-4 pb-0.5"
        aria-roledescription="carousel"
        aria-label="Orders being picked"
      >
        {orders.map((order) => (
          <BeingPickedCard
            key={order.id}
            order={order}
            isMine={myOrderIds.has(order.id)}
            onResume={() => onResume(order.id)}
          />
        ))}
      </div>

      {orders.length > 1 && (
        <div
          className="flex justify-center gap-1 pt-0.5"
          role="tablist"
          aria-label="Carousel pages"
        >
          {orders.map((order, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={order.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={`Order ${index + 1} of ${orders.length}`}
                onClick={() => {
                  const el = scrollRef.current;
                  if (!el) return;
                  const cardWidth = el.scrollWidth / orders.length;
                  el.scrollTo({ left: cardWidth * index, behavior: 'smooth' });
                  setActiveIndex(index);
                }}
                className={`shrink-0 rounded-full transition-all duration-200 ${
                  isActive
                    ? 'h-2 w-5 bg-[var(--role-primary)]'
                    : 'h-2 w-2 bg-[var(--border-opaque)] hover:bg-[var(--content-tertiary)]'
                }`}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
