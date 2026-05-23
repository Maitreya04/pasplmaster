import type { Order } from '../types';

export type QueueDayBucket = 'today' | 'yesterday' | 'older';

export interface QueueDaySection<T extends Order = Order> {
  id: QueueDayBucket;
  title: string;
  description?: string;
  orders: T[];
}

export function localDateKey(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Which calendar day an ISO timestamp falls on (local time). */
export function calendarDayBucket(
  iso: string | null | undefined,
  now = new Date(),
): QueueDayBucket | null {
  if (!iso) return null;

  const todayKey = localDateKey(now);
  const yesterdayKey = localDateKey(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
  );
  const valueKey = localDateKey(new Date(iso));

  if (valueKey === todayKey) return 'today';
  if (valueKey === yesterdayKey) return 'yesterday';
  return 'older';
}

/** Submitted on an earlier calendar day than billing approved it. */
export function isLateBilled(order: Order): boolean {
  if (!order.approved_at) return false;
  return (
    localDateKey(new Date(order.created_at)) <
    localDateKey(new Date(order.approved_at))
  );
}

/** Still waiting in billing — submitted before today. */
export function isLateToBill(order: Order, now = new Date()): boolean {
  return calendarDayBucket(order.created_at, now) !== 'today';
}

type SectionCopy = {
  title: string;
  description?: string | ((orders: Order[]) => string | undefined);
};

function resolveDescription(
  copy: SectionCopy,
  orders: Order[],
): string | undefined {
  if (!copy.description) return undefined;
  return typeof copy.description === 'function'
    ? copy.description(orders)
    : copy.description;
}

export function groupOrdersByCalendarDay<T extends Order>(
  orders: T[],
  referenceDate: (order: T) => string | null | undefined,
  copy: Record<QueueDayBucket, SectionCopy>,
  now = new Date(),
): QueueDaySection<T>[] {
  const today: T[] = [];
  const yesterday: T[] = [];
  const older: T[] = [];

  for (const order of orders) {
    const bucket = calendarDayBucket(referenceDate(order), now);
    if (bucket === 'today') today.push(order);
    else if (bucket === 'yesterday') yesterday.push(order);
    else older.push(order);
  }

  const sections: QueueDaySection<T>[] = [];
  const buckets: Array<{ id: QueueDayBucket; list: T[] }> = [
    { id: 'today', list: today },
    { id: 'yesterday', list: yesterday },
    { id: 'older', list: older },
  ];

  for (const { id, list } of buckets) {
    if (list.length === 0) continue;
    sections.push({
      id,
      title: copy[id].title,
      description: resolveDescription(copy[id], list),
      orders: list,
    });
  }

  return sections;
}

/** Pick queue: group by when billing approved (released to pickers). */
export function groupPickQueueByApprovalDay<T extends Order>(
  orders: T[],
  now = new Date(),
): QueueDaySection<T>[] {
  return groupOrdersByCalendarDay(
    orders,
    (order) => order.approved_at ?? order.created_at,
    {
      today: {
        title: 'Approved today',
        description: (rows) => {
          const late = rows.filter(isLateBilled).length;
          if (late === 0) return 'Billed today — ready to pick.';
          return `${late} late billed — submitted earlier, approved today.`;
        },
      },
      yesterday: {
        title: 'Approved yesterday — still waiting',
        description: 'Billed yesterday but not picked yet. Clear these first.',
      },
      older: {
        title: 'Older approvals',
        description: 'Approved before yesterday — still in the pick queue.',
      },
    },
    now,
  );
}

/** Billing queue: group by when sales submitted the order. */
export function groupBillingQueueBySubmissionDay<T extends Order>(
  orders: T[],
  now = new Date(),
): QueueDaySection<T>[] {
  return groupOrdersByCalendarDay(
    orders,
    (order) => order.created_at,
    {
      today: {
        title: 'Submitted today',
        description: 'Fresh orders from sales today.',
      },
      yesterday: {
        title: 'Waiting since yesterday',
        description: 'Late to bill — submitted yesterday, still in queue.',
      },
      older: {
        title: 'Older submissions',
        description: 'Late to bill — submitted before yesterday.',
      },
    },
    now,
  );
}
