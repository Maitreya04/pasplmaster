import type { PickLineOutcomeKind } from '../../components/picking/PickLineResolvedDock';

/** Full pick = green; short pick = amber partial. */
export function resolvePickOutcomeKind(
  pickedQty: number,
  targetQty: number,
): PickLineOutcomeKind {
  if (targetQty <= 0) return 'picked';
  return pickedQty >= targetQty ? 'picked' : 'partial';
}

export function pickOutcomeHeadline(
  kind: PickLineOutcomeKind,
  pickedQty: number,
  targetQty: number,
  flagReason?: string | null,
): string {
  if (kind === 'flagged') {
    return `Flagged · ${flagReason ?? 'Needs review'}`;
  }
  if (kind === 'partial') {
    return `${pickedQty} of ${targetQty} pcs picked`;
  }
  return `${pickedQty} pcs picked ✓`;
}

export function pickOutcomeDetail(kind: PickLineOutcomeKind, targetQty: number, pickedQty: number): string {
  if (kind === 'flagged') return 'Billing will review this line';
  if (kind === 'partial') {
    const short = Math.max(0, targetQty - pickedQty);
    return `${short} short — billing will see the partial qty`;
  }
  return 'Tap Confirm & next when you are ready for the next rack';
}
