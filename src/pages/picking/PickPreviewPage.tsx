import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eye } from '@phosphor-icons/react';
import { PageHeader, Card, Skeleton } from '../../components/shared';
import { useOrderDetail } from '../../hooks/useOrderDetail';
import type { OrderItem } from '../../types';
import { pickQuantityTarget } from '../../lib/cartSupply';
import { isAskLine } from '../../lib/picking/askBrand';

function sortByRack(items: OrderItem[]): OrderItem[] {
  return [...items].sort((a, b) => {
    if (!a.rack_no && !b.rack_no) return 0;
    if (!a.rack_no) return 1;
    if (!b.rack_no) return -1;
    return a.rack_no.localeCompare(b.rack_no, undefined, { numeric: true });
  });
}

export default function PickPreviewPage(): React.JSX.Element | null {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const orderId = id ? parseInt(id, 10) : null;
  const { data: order, isLoading, error } = useOrderDetail(orderId);

  const rows = useMemo(() => {
    if (!order?.items?.length) return [];
    return sortByRack(order.items);
  }, [order?.items]);

  if (orderId === null || !Number.isFinite(orderId) || orderId <= 0) {
    return (
      <div className="min-h-screen p-4">
        <PageHeader title="Preview" onBack={() => navigate(-1)} />
        <p className="text-sm text-[var(--content-secondary)] mt-4">Invalid order.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-8">
      <PageHeader
        title={order ? `Preview · ${order.order_number}` : 'Pick preview'}
        onBack={() => navigate('/picking')}
      />

      <div className="p-4 space-y-4">
        <Card className="border border-[var(--border-accent)] bg-[var(--bg-accent-subtle)]">
          <div className="flex items-start gap-3">
            <Eye size={22} weight="bold" className="text-[var(--content-accent)] shrink-0 mt-0.5" />
            <div className="min-w-0 space-y-1">
              <p className="font-semibold text-[var(--content-primary)]">View only</p>
              <p className="text-sm text-[var(--content-secondary)]">
                This order is not claimed. Use Start on the queue when you are ready to pick for real.
              </p>
            </div>
          </div>
        </Card>

        {isLoading && (
          <div className="space-y-3">
            <Skeleton variant="card" count={5} />
          </div>
        )}

        {error && (
          <p className="text-sm text-[var(--content-negative)]">
            Could not load this order. You may not have access, or it was removed.
          </p>
        )}

        {!isLoading && order && (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <div>
                <p className="text-sm text-[var(--content-secondary)] truncate">
                  {order.customer_name}
                </p>
                <p className="text-xs text-[var(--content-tertiary)] mt-1 tabular-nums">
                  {order.item_count} line{order.item_count === 1 ? '' : 's'}
                  {typeof order.ask_line_count === 'number' && order.ask_line_count > 0 && (
                    <span className="ml-2 font-medium text-[var(--content-primary)]">
                      · {order.ask_line_count} ASK
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/picking')}
                className="shrink-0 flex items-center gap-1.5 text-sm font-semibold text-[var(--content-accent)] min-h-11 px-2 -mr-2"
              >
                <ArrowLeft size={18} weight="bold" />
                Queue
              </button>
            </div>

            <ul className="space-y-2">
              {rows.map((line) => {
                const qty = pickQuantityTarget(line);
                const ask = isAskLine({
                  item_name: line.item_name,
                  main_group: line.catalog_main_group,
                  parent_group: line.catalog_parent_group,
                });
                return (
                  <li key={line.id}>
                    <Card className="py-3 px-4 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-mono text-base font-bold text-[var(--content-primary)] leading-tight">
                          {line.rack_no || '—'}
                        </p>
                        <div className="flex items-center gap-2 shrink-0">
                          {ask && (
                            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-[var(--bg-tertiary)] text-[var(--content-primary)] border border-[var(--border-subtle)]">
                              ASK
                            </span>
                          )}
                          <span className="text-sm font-semibold tabular-nums text-[var(--content-secondary)]">
                            ×{qty}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm font-medium text-[var(--content-primary)] leading-snug">
                        {line.item_name}
                      </p>
                      {(line.item_alias || line.catalog_alias1) && (
                        <p className="text-xs text-[var(--content-tertiary)] font-mono">
                          {line.item_alias ?? line.catalog_alias1}
                        </p>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
