import { computePickLineProgress, pickQuantityTarget, pickableOrderItems } from '../cartSupply';
import type { OrderItem, ScanResult } from '../../types';

function getPickedQtyFromResult(result: ScanResult | null | undefined): number {
  return Math.max(0, result?.progress?.pickedQty ?? 0);
}

function segmentPickQty(item: OrderItem): number {
  if (item.qty_shippable != null && item.qty_shippable > 0) {
    return Math.max(0, Math.floor(item.qty_shippable));
  }
  if (item.qty_requested > 0) return Math.max(0, Math.floor(item.qty_requested));
  return getPickedQtyFromResult(item.scan_result);
}

function originalTargetQty(root: OrderItem, siblings: OrderItem[]): number {
  const fromScan = [root, ...siblings]
    .map((row) => row.scan_result?.originalTargetQty ?? row.scan_result?.progress?.targetQty)
    .filter((qty): qty is number => qty != null && Number.isFinite(qty) && qty > 0);
  return Math.max(pickQuantityTarget(root), ...fromScan);
}

function pickedQtyForGroup(root: OrderItem, siblings: OrderItem[]): number {
  const rows = [root, ...siblings].filter(
    (row) => row.state === 'picked' || row.state === 'overridden',
  );
  if (rows.length === 0) return 0;

  const segmentTotal = rows.reduce((sum, row) => sum + segmentPickQty(row), 0);
  const scanTotal = Math.max(...rows.map((row) => getPickedQtyFromResult(row.scan_result)), 0);
  return Math.max(segmentTotal, scanTotal);
}

export interface PickFinalisationCounts {
  picked: number;
  flagged: number;
  total: number;
  remaining: number;
  pieceTarget: number;
  piecePicked: number;
  allDone: boolean;
  hasFlagged: boolean;
}

export function pickFinalisationCounts(items: OrderItem[]): PickFinalisationCounts {
  const pickable = pickableOrderItems(items);
  const progress = computePickLineProgress(items);
  const splitChildren = new Map<number, OrderItem[]>();
  for (const item of items) {
    if (item.split_from_id == null) continue;
    const list = splitChildren.get(item.split_from_id) ?? [];
    list.push(item);
    splitChildren.set(item.split_from_id, list);
  }
  let pieceTarget = 0;
  let piecePicked = 0;

  for (const oi of pickable) {
    const siblings = splitChildren.get(oi.id) ?? [];
    const lineTarget = originalTargetQty(oi, siblings);
    pieceTarget += lineTarget;
    piecePicked += pickedQtyForGroup(oi, siblings);
  }

  return {
    picked: progress.picked,
    flagged: progress.flagged,
    total: progress.total,
    remaining: progress.remaining,
    pieceTarget,
    piecePicked,
    allDone: progress.total > 0 && progress.remaining === 0,
    hasFlagged: progress.flagged > 0,
  };
}
