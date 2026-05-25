import { useState, useEffect, useMemo, type ReactElement } from 'react';
import { Lock, Tray } from '@phosphor-icons/react';
import type { OrderWithClaimInfo } from '../../../hooks/useClaimableOrders';
import { isSalesEditFreshLock } from '../../../hooks/useClaimableOrders';
import { StatusBadge, EmptyState, QueueDayTag } from '../../../components/shared';
import { formatCurrency, formatTimeAgo } from '../../../utils/formatters';
import { groupBillingQueueBySubmissionDay } from '../../../lib/queueDayBuckets';

interface QueueViewProps {
  embedded?: boolean;
  available: OrderWithClaimInfo[];
  otherActive: OrderWithClaimInfo[];
  stale: OrderWithClaimInfo[];
  myActive: OrderWithClaimInfo[];
  salesLocked: OrderWithClaimInfo[];
  isLoading: boolean;
  onSelect: (orderId: number) => void;
  onTakeover: (orderId: number) => void;
}

function SectionHeader({
  label,
  count,
  description,
}: {
  label: string;
  count: number;
  description?: string;
}) {
  if (count === 0) return null;
  return (
    <div className="pt-6 pb-2 px-1 first:pt-0">
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--content-tertiary)]">
          {label}
        </span>
        <span className="text-xs font-mono font-semibold text-[var(--content-quaternary)] bg-[var(--bg-tertiary)] rounded-full px-2 py-0.5">
          {count}
        </span>
      </div>
      {description && (
        <p className="mt-1 text-xs text-[var(--content-quaternary)] leading-snug px-0.5">
          {description}
        </p>
      )}
    </div>
  );
}

function rowSelectable(order: OrderWithClaimInfo): boolean {
  if (isSalesEditFreshLock(order)) return false;
  if (!order.claim_info) return true;
  return order.is_mine || order.claim_info.is_stale;
}

function OrderRow({
  order,
  isSelected,
  isClaimed,
  isStale,
  freezeHint,
  onClick,
  onTakeover,
}: {
  order: OrderWithClaimInfo;
  isSelected: boolean;
  isClaimed: boolean;
  isStale: boolean;
  freezeHint?: string | null;
  onClick: () => void;
  onTakeover?: () => void;
}) {
  const isFrozen = Boolean(freezeHint);
  const isBlocked = (isClaimed && !isStale) || isFrozen;
  const isUrgent = order.priority === 'urgent';
  const hasSpecialRate = order.special_rate_line_count > 0;
  const customerAddress = order.customer_address?.trim() ?? '';
  const headerMeta = [order.order_number, order.salesperson_name].filter(Boolean).join(' · ');
  const customerLocation = [order.customer_city, customerAddress].filter(Boolean).join(' · ');
  const notePreview = order.notes?.trim() ?? '';

  return (
    <button
      onClick={isBlocked ? undefined : onClick}
      disabled={isBlocked}
      className={`ds-card ds-card--pressable w-full text-left p-4 transition-all ${
        isBlocked
          ? 'opacity-50 cursor-not-allowed'
          : isSelected
            ? 'ds-row--selected ring-1 ring-[var(--role-primary)]'
            : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {isUrgent && <StatusBadge status="urgent" />}
            <QueueDayTag order={order} variant="late_to_bill" />
            {hasSpecialRate && (
              <span className="ds-chip ds-chip--warning ds-chip--sm">
                Special rate
              </span>
            )}
            <h3 className={`text-base font-semibold truncate ${
              isBlocked ? 'text-[var(--content-tertiary)]' : 'text-[var(--content-primary)]'
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
            isBlocked ? 'text-[var(--content-quaternary)]' : 'text-[var(--content-primary)]'
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

      {/* Frozen — sales editing */}
      {isFrozen && freezeHint && (
        <p className="font-ds-label-size text-[var(--content-secondary)] mt-2 flex items-center gap-1.5">
          <Lock size={14} weight="bold" className="shrink-0 text-[var(--content-tertiary)]" />
          {freezeHint}
        </p>
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
  embedded = false,
  available,
  otherActive,
  stale,
  myActive,
  salesLocked,
  isLoading,
  onSelect,
  onTakeover,
}: QueueViewProps): ReactElement {
  const availableSections = useMemo(
    () => groupBillingQueueBySubmissionDay(available),
    [available],
  );

  // Keyboard navigation includes frozen rows (visible but not selectable via Enter)
  const navigable = [...myActive, ...available, ...stale, ...salesLocked];
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
        if (order && rowSelectable(order)) {
          onSelect(order.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigable, selectedIndex, onSelect]);

  const totalCount = available.length + stale.length + myActive.length + salesLocked.length;

  const shellClass = embedded
    ? 'density-compact h-full min-h-0 bg-[var(--bg-primary)] p-3 flex flex-col overflow-hidden'
    : 'density-compact min-h-screen bg-[var(--bg-primary)] p-4 lg:p-8';

  const innerClass = embedded ? 'flex-1 min-h-0 overflow-y-auto' : 'max-w-2xl mx-auto';

  if (isLoading) {
    return (
      <div className={shellClass}>
        <div className={innerClass}>
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

  if (totalCount === 0 && otherActive.length === 0 && salesLocked.length === 0) {
    return (
      <div className={`${shellClass} flex items-center justify-center`}>
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

  const queueHeader = (
    <div className={`${embedded ? 'shrink-0 px-3 pt-3 pb-2.5 border-b border-[var(--border-faint)]' : 'mb-6'}`}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {embedded && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-[var(--content-positive)] animate-pulse shrink-0"
                aria-hidden
              />
            )}
            <h1 className={`font-bold text-[var(--content-primary)] ${embedded ? 'text-base' : 'text-xl'}`}>
              {embedded ? 'Live queue' : 'Billing Queue'}
            </h1>
          </div>
          {embedded && (
            <p className="text-[10px] text-[var(--content-quaternary)] mt-1 pl-3.5">
              Open orders to bill · copy lines to Busy
            </p>
          )}
        </div>
        {totalCount > 0 && (
          <span className="text-sm font-mono font-semibold text-[var(--content-secondary)] bg-[var(--bg-tertiary)] px-2.5 py-0.5 rounded-full shrink-0">
            {totalCount}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div className={shellClass}>
      {embedded && queueHeader}
      <div className={innerClass}>
        {!embedded && queueHeader}

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

        {/* Available orders — grouped by submission day */}
        {available.length > 0 && (
          <>
            {availableSections.map((section) => (
              <div key={section.id}>
                <SectionHeader
                  label={section.title}
                  count={section.orders.length}
                  description={section.description}
                />
                <div className="space-y-2">
                  {section.orders.map((order) => {
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
              </div>
            ))}
          </>
        )}

        {/* Frozen — salesperson editing lines */}
        {salesLocked.length > 0 && (
          <>
            <SectionHeader label="Sales editing (frozen)" count={salesLocked.length} />
            <div className="space-y-2">
              {salesLocked.map((order) => {
                const idx = navIndex++;
                const who = order.sales_edit_claim_info?.claimed_by_name ?? 'Sales';
                return (
                  <OrderRow
                    key={order.id}
                    order={order}
                    isSelected={idx === selectedIndex}
                    isClaimed={false}
                    isStale={false}
                    freezeHint={`Locked — ${who} is editing this order`}
                    onClick={() => {}}
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
