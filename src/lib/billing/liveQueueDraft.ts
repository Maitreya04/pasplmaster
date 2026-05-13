import { supabase } from '../supabase/client';
import type { OrderItem } from '../../types';

/** Matches live-queue sheet flags (no stock / partial Busy qty). */
export type BillingLiveQueueFlag = {
  type: 'no_stock' | 'partial';
  availableQty?: number;
};

export function captureBillingLiveQueueBaseline(
  items: OrderItem[],
): Map<number, { qty_shippable: number; qty_po: number }> {
  const m = new Map<number, { qty_shippable: number; qty_po: number }>();
  for (const it of items) {
    m.set(it.id, {
      qty_shippable: it.qty_shippable ?? it.qty_requested,
      qty_po: it.qty_po ?? 0,
    });
  }
  return m;
}

/** Rebuild flags from persisted ship/PO split (same rules as compact flow machine). */
export function flagsFromOrderItems(items: OrderItem[]): Record<number, BillingLiveQueueFlag> {
  const next: Record<number, BillingLiveQueueFlag> = {};
  items.forEach((item, index) => {
    const requested = item.qty_requested;
    const shippable = item.qty_shippable ?? requested;
    if (shippable === 0 && requested > 0) {
      next[index] = { type: 'no_stock' };
    } else if (shippable < requested) {
      next[index] = { type: 'partial', availableQty: shippable };
    }
  });
  return next;
}

export function computeBillingLiveQueueShipPoUpdates(args: {
  items: OrderItem[];
  flags: Record<number, BillingLiveQueueFlag>;
  baseline: Map<number, { qty_shippable: number; qty_po: number }>;
}): Array<{ id: number; qty_shippable: number; qty_po: number }> {
  const { items, flags, baseline } = args;
  const out: Array<{ id: number; qty_shippable: number; qty_po: number }> = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const b = baseline.get(item.id);
    if (!b) continue;

    const f = flags[i];
    let qty_shippable: number;
    let qty_po: number;
    if (f?.type === 'no_stock') {
      qty_shippable = 0;
      qty_po = item.qty_requested;
    } else if (f?.type === 'partial' && f.availableQty != null) {
      qty_shippable = Math.max(0, Math.min(f.availableQty, item.qty_requested));
      qty_po = item.qty_requested - qty_shippable;
    } else {
      qty_shippable = b.qty_shippable;
      qty_po = b.qty_po;
    }

    const curS = item.qty_shippable ?? item.qty_requested;
    const curP = item.qty_po ?? 0;
    if (qty_shippable !== curS || qty_po !== curP) {
      out.push({ id: item.id, qty_shippable, qty_po });
    }
  }
  return out;
}

export async function persistBillingLiveQueueDraft(args: {
  items: OrderItem[];
  flags: Record<number, BillingLiveQueueFlag>;
  baseline: Map<number, { qty_shippable: number; qty_po: number }>;
}): Promise<{ error: Error | null }> {
  const updates = computeBillingLiveQueueShipPoUpdates(args);
  if (updates.length === 0) return { error: null };

  const results = await Promise.all(
    updates.map((u) =>
      supabase
        .from('order_items')
        .update({ qty_shippable: u.qty_shippable, qty_po: u.qty_po })
        .eq('id', u.id),
    ),
  );
  const firstErr = results.find((r) => r.error)?.error;
  return { error: firstErr ? new Error(firstErr.message) : null };
}
