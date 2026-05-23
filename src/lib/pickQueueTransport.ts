import type { Order } from '../types';

export const NO_TRANSPORT_LABEL = 'No transport set';

type PickQueueOrder = Pick<
  Order,
  'priority' | 'transport_name' | 'approved_at' | 'created_at' | 'id'
>;

export function transportQueueKey(transportName: string | null | undefined): string {
  const trimmed = transportName?.trim();
  return trimmed ? trimmed : NO_TRANSPORT_LABEL;
}

/** SQL-friendly sort key: unnamed transports sort last. */
export function transportSortKey(transportName: string | null | undefined): string {
  const trimmed = transportName?.trim();
  return trimmed ? trimmed.toLowerCase() : 'zzz_no_transport';
}

/**
 * Pick queue order: urgent first, then group by transport, FIFO within each
 * transport (oldest approved first — matches dispatch cut-off pressure).
 */
export function comparePickQueueOrders(a: PickQueueOrder, b: PickQueueOrder): number {
  if (a.priority === 'urgent' && b.priority !== 'urgent') return -1;
  if (a.priority !== 'urgent' && b.priority === 'urgent') return 1;

  const transportCmp = transportSortKey(a.transport_name).localeCompare(
    transportSortKey(b.transport_name),
  );
  if (transportCmp !== 0) return transportCmp;

  const aTime = new Date(a.approved_at ?? a.created_at).getTime();
  const bTime = new Date(b.approved_at ?? b.created_at).getTime();
  if (aTime !== bTime) return aTime - bTime;

  return a.id - b.id;
}

export function sortPickQueueOrders<T extends PickQueueOrder>(orders: T[]): T[] {
  return [...orders].sort(comparePickQueueOrders);
}

export interface PickQueueTransportSection<T extends Order = Order> {
  transportName: string;
  orders: T[];
  urgentCount: number;
  oldestApprovedAt: string | null;
}

/** Group already-sorted orders into transport sections for queue UI. */
export function groupOrdersByTransport<T extends Order>(
  orders: T[],
): PickQueueTransportSection<T>[] {
  const byTransport = new Map<string, T[]>();
  for (const order of orders) {
    const key = transportQueueKey(order.transport_name);
    const list = byTransport.get(key) ?? [];
    list.push(order);
    byTransport.set(key, list);
  }

  const sections: PickQueueTransportSection<T>[] = [];
  for (const [transportName, list] of byTransport) {
    const sorted = sortPickQueueOrders(list);
    sections.push({
      transportName,
      orders: sorted,
      urgentCount: sorted.filter((o) => o.priority === 'urgent').length,
      oldestApprovedAt: sorted.reduce<string | null>((oldest, o) => {
        const t = o.approved_at ?? o.created_at;
        if (!oldest) return t;
        return new Date(t).getTime() < new Date(oldest).getTime() ? t : oldest;
      }, null),
    });
  }

  return sections.sort((a, b) => {
    if (a.urgentCount > 0 && b.urgentCount === 0) return -1;
    if (a.urgentCount === 0 && b.urgentCount > 0) return 1;
    const aTime = a.oldestApprovedAt ? new Date(a.oldestApprovedAt).getTime() : Infinity;
    const bTime = b.oldestApprovedAt ? new Date(b.oldestApprovedAt).getTime() : Infinity;
    if (aTime !== bTime) return aTime - bTime;
    return a.transportName.localeCompare(b.transportName, undefined, { sensitivity: 'base' });
  });
}
