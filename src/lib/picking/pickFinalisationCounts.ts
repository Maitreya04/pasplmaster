import { pickQuantityTarget, pickableOrderItems } from '../cartSupply';
import type { OrderItem, ScanResult } from '../../types';

function getPickedQtyFromResult(result: ScanResult | null | undefined): number {
  return Math.max(0, result?.progress?.pickedQty ?? 0);
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
  let picked = 0;
  let flagged = 0;
  let pieceTarget = 0;
  let piecePicked = 0;

  for (const oi of pickable) {
    const lineTarget = pickQuantityTarget(oi);
    pieceTarget += lineTarget;
    if (oi.state === 'picked') {
      picked += 1;
      piecePicked += Math.min(lineTarget, getPickedQtyFromResult(oi.scan_result));
    } else if (oi.state === 'flagged') {
      flagged += 1;
    }
  }

  const total = pickable.length;
  const remaining = total - picked - flagged;

  return {
    picked,
    flagged,
    total,
    remaining,
    pieceTarget,
    piecePicked,
    allDone: total > 0 && remaining === 0,
    hasFlagged: flagged > 0,
  };
}
