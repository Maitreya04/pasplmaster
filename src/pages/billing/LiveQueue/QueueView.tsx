import { useState, useEffect, type ReactElement } from 'react';
import { Tray } from '@phosphor-icons/react';
import type { OrderWithClaimInfo } from '../../../hooks/useClaimableOrders';
import { StatusBadge, EmptyState } from '../../../components/shared';
import { formatCurrency, formatTimeAgo } from '../../../utils/formatters';

interface QueueViewProps {
  available: OrderWithClaimInfo[];
  otherActive: OrderWithClaimInfo[];
  stale: OrderWithClaimInfo[];
  myActive: OrderWithClaimInfo[];
  isLoading: boolean;
  onSelect: (orderId: number) => void;
  onTakeover: (orderId: number) => void;
}

function SectionHeader({ label, count }: { label: string; count: number }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-3 pt-6 pb-2 px-1 first:pt-0">
      <span className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
        {label}
      </span>
      <span className="text-xs font-mono font-semibold text-[var(--content-quaternary)] bg-[var(--bg-tertiary)] rounded-full px-2 py-0.5">
        {count}
      </span>
    </div>
  );
}

function OrderRow({
  order,
  isSelected,
  isClaimed,
  isStale,
  onClick,
  onTakeover,
}: {
  order: OrderWithClaimInfo;
  isSelected: boolean;
  isClaimed: boolean;
  isStale: boolean;
  onClick: () => void;
  onTakeover?: () => void;
}) {
  const isUrgent = order.priority === 'urgent';
  const hasSpecialRate = order.special_rate_line_count > 0;
  const customerAddress = order.customer_address?.trim() ?? '';
  const headerMeta = [order.order_number, order.salesperson_name].filter(Boolean).join(' · ');
  const customerLocation = [order.customer_city, customerAddress].filter(Boolean).join(' · ');
  const notePreview = order.notes?.trim() ?? '';

  return (
    <button
      onClick={isClaimed && !isStale ? undefined : onClick}
      disabled={isClaimed && !isStale}
      className={`ds-card ds-card--pressable w-full text-left p-4 transition-all ${
        isClaimed && !isStale
          ? 'opacity-50 cursor-not-allowed'
          : isSelected
            ? 'ds-row--selected ring-1 ring-[var(--role-primary)]'
            : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            {isUrgent && <StatusBadge status="urgent" />}
            {hasSpecialRate && (
              <span className="ds-chip ds-chip--warning ds-chip--sm">
                Special rate
              </span>
            )}
            <h3 className={`text-base font-semibold truncate ${
              isClaimed && !isStale ? 'text-[var(--content-tertiary)]' : 'text-[var(--content-primary)]'
            }`}>
              {order.customer_name}
            </h3>
          </div>
          {headerMeta && (
            <p className="text-xs text-[var(--content-tertiary)]">
              {headerMeta}
            </p>
          )}
          {customerLocation && (
            <p className="mt-1 line-clamp-2 text-sm text-[var(--content-tertiary)]">
              {order.customer_city && (
                <span className="font-medium text-[var(--content-secondary)]">
                  {order.customer_city}
                </span>
              )}
              {order.customer_city && customerAddress && (
                <span className="px-1 text-[var(--content-quaternary)]">·</span>
              )}
              {customerAddress && <span>{customerAddress}</span>}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className={`text-sm font-mono font-semibold tabular-nums ${
            isClaimed && !isStale ? 'text-[var(--content-quaternary)]' : 'text-[var(--content-primary)]'
          }`}>
            {formatCurrency(order.total_value)}
          </p>
          <p className="font-ds-label-size text-[var(--content-quaternary)] mt-0.5">
            {order.item_count} items · {formatTimeAgo(order.created_at)}
          </p>
        </div>
      </div>

      {hasSpecialRate && (
        <div className="mt-3 rounded-xl border border-[var(--border-warning)] bg-[var(--bg-warning-subtle)] px-3 py-2">
          <p className="text-xs font-semibold text-[var(--content-warning)]">
            Quote locked on {order.special_rate_line_count} line{order.special_rate_line_count === 1 ? '' : 's'}
            {order.special_rate_qty > 0 ? ` · ${order.special_rate_qty} pcs` : ''} · check highlighted rate before billing in Busy
          </p>
        </div>
      )}

      {notePreview && (
        <div className="mt-3 rounded-xl border border-[var(--border-accent)] bg-[var(--bg-accent-subtle)] px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--content-accent)]">
            Sales note
          </p>
          <p className="mt-1 text-xs leading-snug text-[var(--content-primary)] line-clamp-2 whitespace-pre-wrap">
            {notePreview}
          </p>
        </div>
      )}

      {/* Being billed by someone else */}
      {isClaimed && !isStale && order.claim_info && (
        <p className="font-ds-label-size text-[var(--content-quaternary)] mt-2 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--content-accent)] shrink-0" />
          {order.claim_info.claimed_by_name} · started {formatTimeAgo(order.claim_info.claimed_at)}
        </p>
      )}

      {/* Stale — takeover */}
      {isStale && order.claim_info && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--border-faint)]">
          <p className="font-ds-label-size text-[var(--content-warning)] flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--content-warning)] animate-pulse shrink-0" />
            Stale · {order.claim_info.claimed_by_name} · {formatTimeAgo(order.claim_info.last_heartbeat_at)}
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTakeover?.();
            }}
            className="text-xs font-semibold text-[var(--content-accent)] hover:text-[var(--content-primary)] px-3 py-1.5 rounded-lg bg-[var(--bg-accent-subtle)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            Take over
          </button>
        </div>
      )}
    </button>
  );
}

export function QueueView({
  available,
  otherActive,
  stale,
  myActive,
  isLoading,
  onSelect,
  onTakeover,
}: QueueViewProps): ReactElement {
  // Flat list for keyboard navigation: myActive → available → stale
  const navigable = [...myActive, ...available, ...stale];
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (selectedIndex >= navigable.length) {
      setSelectedIndex(Math.max(0, navigable.length - 1));
    }
  }, [navigable.length, selectedIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, navigable.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      }
      if (e.key === 'Enter' && navigable.length > 0) {
        e.preventDefault();
        const order = navigable[selectedIndex];
        if (order && (!order.claim_info || order.is_mine || order.claim_info.is_stale)) {
          onSelect(order.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigable, selectedIndex, onSelect]);

  const totalCount = available.length + stale.length + myActive.length;

  if (isLoading) {
    return (
      <div className="density-compact min-h-screen bg-[var(--bg-primary)] p-4 lg:p-8">
        <div className="max-w-2xl mx-auto">
          <div className="h-7 w-40 bg-[var(--bg-tertiary)] rounded-lg animate-pulse mb-6" />
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="ds-card h-20 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (totalCount === 0 && otherActive.length === 0) {
    return (
      <div className="density-compact min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <EmptyState
          icon={Tray}
          title="No orders waiting"
          description="New orders will appear here when sales submits them."
        />
      </div>
    );
  }

  // Track a running navigable index to highlight the correct row across sections
  let navIndex = 0;

  return (
    <div className="density-compact min-h-screen bg-[var(--bg-primary)] p-4 lg:p-8">
      <div className="max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-baseline justify-between mb-6">
          <h1 className="text-xl font-bold text-[var(--content-primary)]">
            Billing Queue
          </h1>
          {totalCount > 0 && (
            <span className="text-sm font-mono font-semibold text-[var(--content-secondary)] bg-[var(--bg-tertiary)] px-2.5 py-0.5 rounded-full">
              {totalCount}
            </span>
          )}
        </div>

        {/* My active orders */}
        {myActive.length > 0 && (
          <>
            <SectionHeader label="Your active" count={myActive.length} />
            <div className="space-y-2">
              {myActive.map((order) => {
                const idx = navIndex++;
                return (
                  <OrderRow
                    key={order.id}
                    order={order}
                    isSelected={idx === selectedIndex}
                    isClaimed={false}
                    isStale={false}
                    onClick={() => {
                      setSelectedIndex(idx);
                      onSelect(order.id);
                    }}
                  />
                );
              })}
            </div>
          </>
        )}

        {/* Available orders */}
        {available.length > 0 && (
          <>
            <SectionHeader label="Available" count={available.length} />
            <div className="space-y-2">
              {available.map((order) => {
                const idx = navIndex++;
                return (
                  <OrderRow
                    key={order.id}
                    order={order}
                    isSelected={idx === selectedIndex}
                    isClaimed={false}
                    isStale={false}
                    onClick={() => {
                      setSelectedIndex(idx);
                      onSelect(order.id);
                    }}
                  />
                );
              })}
            </div>
          </>
        )}

        {/* Being billed by others */}
        {otherActive.length > 0 && (
          <>
            <SectionHeader label="Being billed" count={otherActive.length} />
            <div className="space-y-2">
              {otherActive.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  isSelected={false}
                  isClaimed={true}
                  isStale={false}
                  onClick={() => {}}
                />
              ))}
            </div>
          </>
        )}

        {/* Stale orders — takeover */}
        {stale.length > 0 && (
          <>
            <SectionHeader label="Stale — take over" count={stale.length} />
            <div className="space-y-2">
              {stale.map((order) => {
                const idx = navIndex++;
                return (
                  <OrderRow
                    key={order.id}
                    order={order}
                    isSelected={idx === selectedIndex}
                    isClaimed={false}
                    isStale={true}
                    onClick={() => {
                      setSelectedIndex(idx);
                      onSelect(order.id);
                    }}
                    onTakeover={() => onTakeover(order.id)}
                  />
                );
              })}
            </div>
          </>
        )}

        {/* Keyboard hint */}
        {navigable.length > 0 && (
          <p className="text-center font-ds-label-size text-[var(--content-quaternary)] mt-8">
            ↑↓ navigate · Enter to start billing
          </p>
        )}

      </div>
    </div>
  );
}
