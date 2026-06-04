import type { OrderItem, ScanResult } from '../../types';
import { getQuotedPrice } from '../specialPricing';
import { orderItemConfirmedMrp } from './orderItemSplitGroups';

export function roundPickMrp(value: number): number {
  return Math.round(value);
}

/** Order line rate used for billing (quoted wins over system). */
export function billingRateForOrderItem(
  item: Pick<OrderItem, 'price_quoted' | 'price_system'>,
): number {
  return roundPickMrp(getQuotedPrice(item) ?? 0);
}

/** Label MRP ≠ stock suggestion at pick (rounded). */
export function isPickLabelVsStockAtPick(
  labelMrp: number | null,
  suggestedMrp: number | null,
): boolean {
  if (labelMrp == null || suggestedMrp == null) return false;
  return roundPickMrp(labelMrp) !== roundPickMrp(suggestedMrp);
}

export type PickMrpSnapshot = {
  labelMrp: number | null;
  suggestedMrpAtPick: number | null;
  billingRateAtPick: number | null;
  /** Frozen at pick — picker saw label ≠ stock suggestion. */
  mrpFlagged: boolean;
};

export const isPickLineMrpFlagged = isPickLabelVsStockAtPick;

export function suggestedMrpFromScan(scan: ScanResult | null | undefined): number | null {
  const raw = scan?.suggestedMrpAtPick ?? scan?.stockMrpAtPick;
  if (raw == null || !Number.isFinite(Number(raw))) return null;
  return roundPickMrp(Number(raw));
}

export function billingRateFromScan(scan: ScanResult | null | undefined): number | null {
  const raw = scan?.billingRateAtPick;
  if (raw == null || !Number.isFinite(Number(raw))) return null;
  return roundPickMrp(Number(raw));
}

export function readPickMrpSnapshot(item: OrderItem): PickMrpSnapshot {
  const labelMrp = orderItemConfirmedMrp(item);
  const scan = item.scan_result;
  const suggestedMrpAtPick = suggestedMrpFromScan(scan);
  const billingRateAtPick =
    billingRateFromScan(scan) ??
    (labelMrp != null ? billingRateForOrderItem(item) : null);
  const mrpFlagged =
    scan?.mrpFlagged === true ||
    (labelMrp != null &&
      suggestedMrpAtPick != null &&
      isPickLabelVsStockAtPick(labelMrp, suggestedMrpAtPick));

  return {
    labelMrp: labelMrp != null ? roundPickMrp(labelMrp) : null,
    suggestedMrpAtPick,
    billingRateAtPick,
    mrpFlagged,
  };
}

export function buildPickMrpSnapshotForMerge(
  orderItem: OrderItem,
  labelMrp: number | null,
  suggestedMrp: number | null,
): PickMrpSnapshot {
  const label = labelMrp != null ? roundPickMrp(labelMrp) : null;
  const suggested =
    suggestedMrp != null && Number.isFinite(suggestedMrp)
      ? roundPickMrp(suggestedMrp)
      : null;
  const billingRateAtPick = billingRateForOrderItem(orderItem);
  return {
    labelMrp: label,
    suggestedMrpAtPick: suggested,
    billingRateAtPick,
    mrpFlagged: isPickLabelVsStockAtPick(label, suggested),
  };
}

export type PickMrpQtyBand = { mrp: number; qty: number };

function linePickQty(item: OrderItem): number {
  const shippable = item.qty_shippable;
  if (shippable != null && shippable > 0) return shippable;
  const picked = item.scan_result?.progress?.pickedQty;
  if (picked != null && picked > 0) return picked;
  return Math.max(0, item.qty_requested ?? 0);
}

/** Qty picked at each label MRP for a root line + MRP-split siblings. */
export function pickMrpQtyBandsForGroup(
  root: OrderItem,
  siblings: OrderItem[],
): PickMrpQtyBand[] {
  const lines = [root, ...siblings];
  const byMrp = new Map<number, number>();
  for (const line of lines) {
    const mrp = orderItemConfirmedMrp(line);
    if (mrp == null) continue;
    const key = roundPickMrp(mrp);
    byMrp.set(key, (byMrp.get(key) ?? 0) + linePickQty(line));
  }
  return [...byMrp.entries()]
    .map(([mrp, qty]) => ({ mrp, qty }))
    .filter((b) => b.qty > 0)
    .sort((a, b) => b.qty - a.qty || b.mrp - a.mrp);
}

export function pickMrpGroupForItem(
  item: OrderItem,
  allItems: OrderItem[],
): { root: OrderItem; siblings: OrderItem[] } {
  const rootId = item.split_from_id ?? item.id;
  const root = allItems.find((i) => i.id === rootId) ?? item;
  const siblings = allItems
    .filter((i) => i.split_from_id === rootId && i.id !== root.id)
    .sort((a, b) => a.id - b.id);
  return { root, siblings };
}

export function formatPickMrpQtyBreakdown(
  bands: PickMrpQtyBand[],
  totalQty?: number,
): string | null {
  if (bands.length === 0) return null;
  const parts = bands.map((b) => `${b.qty} pcs @ ₹${b.mrp.toLocaleString('en-IN')}`);
  const picked = bands.reduce((s, b) => s + b.qty, 0);
  if (bands.length === 1) {
    const only = bands[0]!;
    if (totalQty != null && totalQty > only.qty) {
      return `${only.qty} of ${totalQty} pcs @ ₹${only.mrp.toLocaleString('en-IN')}`;
    }
    return `${only.qty} pcs @ ₹${only.mrp.toLocaleString('en-IN')}`;
  }
  const mix = parts.join(' · ');
  if (totalQty != null && picked > 0 && picked < totalQty) {
    return `${mix} (${picked} of ${totalQty} pcs picked)`;
  }
  return mix;
}

export function pickMrpQtyBreakdownForItem(
  item: OrderItem,
  allItems: OrderItem[],
): string | null {
  const { root, siblings } = pickMrpGroupForItem(item, allItems);
  const bands = pickMrpQtyBandsForGroup(root, siblings);
  if (bands.length <= 1 && item.split_from_id == null) return null;
  const target =
    (root.qty_requested ?? 0) +
    siblings.reduce((sum, line) => sum + (line.qty_requested ?? 0), 0);
  return formatPickMrpQtyBreakdown(bands, target > 0 ? target : undefined);
}

export function labelDiffersFromBillingRate(snapshot: PickMrpSnapshot): boolean {
  if (snapshot.labelMrp == null || snapshot.billingRateAtPick == null) return false;
  return snapshot.labelMrp !== snapshot.billingRateAtPick;
}
