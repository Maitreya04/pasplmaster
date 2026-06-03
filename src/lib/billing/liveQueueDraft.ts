import { supabase } from '../supabase/client';
import { normalizeSalesLineUnit } from '../salesUnit';
import type { OrderItem, SalesLineUnit } from '../../types';

/** Matches live-queue sheet flags (no stock / partial Busy qty). Keyed by `order_items.id`. */
export type BillingLiveQueueFlag = {
  type: 'no_stock' | 'partial';
  availableQty?: number;
};

/** Local edits before approve / draft persist. Keyed by `order_items.id`. */
export type BillingLineEdit = {
  qtyRequested?: number;
  priceQuoted?: number;
  salesUnit?: SalesLineUnit;
  removed?: boolean;
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

/** Rebuild flags from persisted ship/PO split (same rules as compact flow machine). Keyed by `order_items.id`. */
export function flagsFromOrderItems(items: OrderItem[]): Record<number, BillingLiveQueueFlag> {
  const next: Record<number, BillingLiveQueueFlag> = {};
  items.forEach((item) => {
    const requested = item.qty_requested;
    const shippable = item.qty_shippable ?? requested;
    if (shippable === 0 && requested > 0) {
      next[item.id] = { type: 'no_stock' };
    } else if (shippable < requested) {
      next[item.id] = { type: 'partial', availableQty: shippable };
    }
  });
  return next;
}

function computeDesiredShipPo(args: {
  item: OrderItem;
  baseline: Map<number, { qty_shippable: number; qty_po: number }>;
  flags: Record<number, BillingLiveQueueFlag>;
  qtyRequestedEffective: number;
}): { qty_shippable: number; qty_po: number } {
  const { item, baseline, flags, qtyRequestedEffective } = args;
  const b = baseline.get(item.id);
  if (!b) {
    const sh = item.qty_shippable ?? qtyRequestedEffective;
    return { qty_shippable: Math.min(sh, qtyRequestedEffective), qty_po: Math.max(0, qtyRequestedEffective - Math.min(sh, qtyRequestedEffective)) };
  }

  const f = flags[item.id];
  if (f?.type === 'no_stock') {
    return { qty_shippable: 0, qty_po: qtyRequestedEffective };
  }
  if (f?.type === 'partial' && f.availableQty != null) {
    const qty_shippable = Math.max(0, Math.min(f.availableQty, qtyRequestedEffective));
    return { qty_shippable, qty_po: qtyRequestedEffective - qty_shippable };
  }

  const qty_shippable = Math.min(b.qty_shippable, qtyRequestedEffective);
  return { qty_shippable, qty_po: qtyRequestedEffective - qty_shippable };
}

/** Ship/po-only rows that differ from current DB columns (used by callers if needed). */
export function computeBillingLiveQueueShipPoUpdates(args: {
  items: OrderItem[];
  flags: Record<number, BillingLiveQueueFlag>;
  baseline: Map<number, { qty_shippable: number; qty_po: number }>;
  lineEdits?: Record<number, BillingLineEdit>;
}): Array<{ id: number; qty_shippable: number; qty_po: number }> {
  const { items, flags, baseline, lineEdits } = args;
  const out: Array<{ id: number; qty_shippable: number; qty_po: number }> = [];

  for (const item of items) {
    if (lineEdits?.[item.id]?.removed) continue;
    const qtyRequestedEffective = lineEdits?.[item.id]?.qtyRequested ?? item.qty_requested;
    const { qty_shippable, qty_po } = computeDesiredShipPo({
      item,
      baseline,
      flags,
      qtyRequestedEffective,
    });

    const curS = item.qty_shippable ?? item.qty_requested;
    const curP = item.qty_po ?? 0;
    if (qty_shippable !== curS || qty_po !== curP) {
      out.push({ id: item.id, qty_shippable, qty_po });
    }
  }
  return out;
}

export function computeOrderItemPersistPatch(args: {
  item: OrderItem;
  flags: Record<number, BillingLiveQueueFlag>;
  baseline: Map<number, { qty_shippable: number; qty_po: number }>;
  lineEdits?: Record<number, BillingLineEdit>;
}): Record<string, unknown> | null {
  const { item, flags, baseline, lineEdits } = args;
  const ed = lineEdits?.[item.id];
  const qty_requested = ed?.qtyRequested ?? item.qty_requested;
  const priceCandidate = ed?.priceQuoted !== undefined ? ed.priceQuoted : item.price_quoted;

  const { qty_shippable, qty_po } = computeDesiredShipPo({
    item,
    baseline,
    flags,
    qtyRequestedEffective: qty_requested,
  });

  const curS = item.qty_shippable ?? item.qty_requested;
  const curP = item.qty_po ?? 0;
  const curQ = item.qty_requested;
  const curPQ = item.price_quoted ?? item.price_system ?? null;

  const patch: Record<string, unknown> = {};

  if (qty_requested !== curQ || qty_shippable !== curS || qty_po !== curP) {
    patch.qty_requested = qty_requested;
    patch.qty_shippable = qty_shippable;
    patch.qty_po = qty_po;
    patch.qty_approved = qty_shippable;
  }

  if (priceCandidate != null && curPQ !== priceCandidate) {
    patch.price_quoted = priceCandidate;
  }

  const salesUnitCandidate =
    ed?.salesUnit != null ? normalizeSalesLineUnit(ed.salesUnit) : null;
  const curUnit = normalizeSalesLineUnit(item.sales_unit);
  if (salesUnitCandidate != null && salesUnitCandidate !== curUnit) {
    patch.sales_unit = salesUnitCandidate;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

export async function persistBillingLiveQueueDraft(args: {
  items: OrderItem[];
  flags: Record<number, BillingLiveQueueFlag>;
  baseline: Map<number, { qty_shippable: number; qty_po: number }>;
  lineEdits?: Record<number, BillingLineEdit>;
}): Promise<{ error: Error | null }> {
  const lineEdits = args.lineEdits ?? {};

  const deleteIds = args.items.filter((it) => lineEdits[it.id]?.removed).map((it) => it.id);

  if (deleteIds.length > 0) {
    const delResults = await Promise.all(
      deleteIds.map((id) => supabase.from('order_items').delete().eq('id', id)),
    );
    const delErr = delResults.find((r) => r.error)?.error;
    if (delErr) return { error: new Error(delErr.message) };
  }

  const remainingItems =
    deleteIds.length === 0 ? args.items : args.items.filter((it) => !lineEdits[it.id]?.removed);

  const updates = remainingItems
    .map((item) => {
      const patch = computeOrderItemPersistPatch({
        item,
        flags: args.flags,
        baseline: args.baseline,
        lineEdits,
      });
      return patch ? { id: item.id, patch } : null;
    })
    .filter((x): x is { id: number; patch: Record<string, unknown> } => x != null);

  if (updates.length === 0) return { error: null };

  const results = await Promise.all(
    updates.map(({ id, patch }) =>
      supabase.from('order_items').update(patch).eq('id', id),
    ),
  );
  const firstErr = results.find((r) => r.error)?.error;
  return { error: firstErr ? new Error(firstErr.message) : null };
}
