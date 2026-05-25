import { Flag, Package, Warning } from '@phosphor-icons/react';
import { formatTimeAgo } from '../../../utils/formatters';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';

function flagTypeLabel(
  order: DeskOrderRow,
): { label: string; tone: 'red' | 'amber' | 'blue' } {
  const reason = order.pickerFlags[0]?.flagReason ?? order.notes ?? '';
  const lower = reason.toLowerCase();
  if (lower.includes('stock') || lower.includes('out of stock')) {
    return { label: 'Out of stock', tone: 'red' };
  }
  if (lower.includes('price') || lower.includes('mrp')) {
    return { label: 'Price query', tone: 'blue' };
  }
  if (order.pickerFlags[0]?.flagReason) {
    return { label: order.pickerFlags[0].flagReason, tone: 'amber' };
  }
  if (order.notes?.toLowerCase().includes('price')) {
    return { label: 'Price query', tone: 'blue' };
  }
  return { label: 'Qty mismatch', tone: 'amber' };
}

function flagDescription(order: DeskOrderRow): string {
  const first = order.pickerFlags[0];
  if (first) {
    const extra =
      order.pickerFlags.length > 1 ? ` (+${order.pickerFlags.length - 1} more)` : '';
    return `${first.itemName} — ${first.flagReason ?? 'needs review'}${extra}`;
  }
  if (order.notes?.trim()) return `${order.customer_name} — ${order.notes.trim()}`;
  return `${order.customer_name} — picker raised an issue during pick`;
}

function flagTimeSource(order: DeskOrderRow): string {
  return order.picked_at ?? order.approved_at ?? order.created_at;
}

interface DeskFlagsStripProps {
  orders: DeskOrderRow[];
  onSelect: (order: DeskOrderRow) => void;
}

export function DeskFlagsStrip({ orders, onSelect }: DeskFlagsStripProps): React.JSX.Element | null {
  if (orders.length === 0) return null;

  return (
    <div className="shrink-0 bg-[var(--bg-warning-subtle)] border-b-[1.5px] border-[var(--border-warning)]">
      <div className="flex items-center justify-between px-3.5 py-1.5">
        <div className="flex items-center gap-1.5">
          <Flag size={12} weight="fill" className="text-[var(--content-warning-on-light)]" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--content-warning-on-light)]">
            Picker flags — needs action
          </span>
          <span className="text-[9px] font-semibold px-1.5 rounded-full bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)] border border-[var(--border-warning)]">
            {orders.length}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 px-3.5 pb-2">
        {orders.slice(0, 4).map((order) => {
          const type = flagTypeLabel(order);
          const isCritical = type.tone === 'red';
          const stillPicking = order.workflow_status === 'picking';
          return (
            <button
              key={order.id}
              type="button"
              onClick={() => onSelect(order)}
              className="flex items-center gap-2.5 rounded-lg border border-[var(--border-warning)] bg-[var(--bg-secondary)] px-2.5 py-2 text-left hover:bg-[var(--bg-warning-subtle)] transition-colors"
            >
              <span
                className={`w-[7px] h-[7px] rounded-full shrink-0 animate-pulse ${
                  isCritical ? 'bg-[var(--bg-negative)]' : 'bg-[var(--content-warning-on-light)]'
                }`}
              />
              {isCritical ? (
                <Package size={15} className="text-[var(--content-warning-on-light)] shrink-0" />
              ) : (
                <Warning size={15} className="text-[var(--content-warning-on-light)] shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-[var(--content-warning-on-light)]">
                  {order.order_number} · {formatTimeAgo(flagTimeSource(order))}
                  {stillPicking && (
                    <span className="ml-1 font-medium text-[var(--content-warning)]">
                      · still picking
                    </span>
                  )}
                </p>
                <p className="text-xs font-medium text-[var(--content-warning)] truncate">
                  {flagDescription(order)}
                </p>
                {order.picker_name && (
                  <p className="text-[10px] text-[var(--content-warning-on-light)]">
                    Flagged by {order.picker_name}
                  </p>
                )}
              </div>
              <span
                className={`shrink-0 text-[9px] font-medium px-2 py-0.5 rounded-full ${
                  type.tone === 'red'
                    ? 'bg-[var(--bg-negative-subtle)] text-[var(--content-negative)]'
                    : type.tone === 'blue'
                      ? 'bg-[var(--bg-accent-subtle)] text-[var(--content-accent)]'
                      : 'bg-[var(--bg-warning-subtle)] text-[var(--content-warning-on-light)]'
                }`}
              >
                {type.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DeskFlagsSeparatorNote({ count }: { count: number }): React.JSX.Element | null {
  if (count <= 0) return null;
  return (
    <p className="mx-3.5 mt-1.5 mb-0 rounded-lg bg-[var(--bg-tertiary)] px-2.5 py-1.5 text-[10px] text-[var(--content-quaternary)]">
      {count} flagged order{count === 1 ? '' : 's'} shown above · click any order below to edit
    </p>
  );
}
