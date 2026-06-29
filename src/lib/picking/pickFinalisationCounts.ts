import { computePickLineProgress, pickQuantityTarget, pickableOrderItems } from '../cartSupply';
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
  const progress = computePickLineProgress(items);
  let pieceTarget = 0;
  let piecePicked = 0;

  for (const oi of pickable) {
    const lineTarget = pickQuantityTarget(oi);
    pieceTarget += lineTarget;
    if (oi.state === 'picked' || oi.state === 'overridden') {
      piecePicked += Math.min(lineTarget, getPickedQtyFromResult(oi.scan_result));
    }
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
