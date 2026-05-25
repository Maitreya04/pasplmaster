import type { PickLineStatusKind } from '../../components/picking/PickLineStatusPanel';

export type PickLineClosureKind = 'picked' | 'partial' | 'flagged';

export interface ResolvePickLineStatusInput {
  isCurrent: boolean;
  uiState: string;
  pickedQty: number;
  targetQty: number;
  isSkipped?: boolean;
  /** Transient closure beat before server state catches up */
  lineClosure?: PickLineClosureKind | null;
}

/**
 * Line status for the pick queue strip — terminal states win over "current card".
 * (A done line must not appear under "Still to pick" just because it is on screen.)
 */
export function resolvePickLineStatus(input: ResolvePickLineStatusInput): PickLineStatusKind {
  const {
    isCurrent,
    uiState,
    pickedQty,
    targetQty,
    isSkipped = false,
    lineClosure = null,
  } = input;

  const safeTarget = Math.max(0, targetQty);
  const safePicked = Math.max(0, Math.min(safeTarget, pickedQty));

  if (uiState === 'flagged' || lineClosure === 'flagged') return 'flagged';

  const lineComplete =
    uiState === 'picked' ||
    uiState === 'overridden' ||
    safePicked >= safeTarget ||
    lineClosure === 'picked';

  if (lineComplete) return 'picked';

  const partial =
    (safePicked > 0 && safePicked < safeTarget) || lineClosure === 'partial';
  if (partial) return 'partial';

  if (isSkipped) return 'skipped';
  if (isCurrent) return 'now';
  return 'pending';
}

export type QueueSheetLineStatus = 'now' | 'picked' | 'flagged' | 'skipped' | 'next';

export function resolveQueueSheetLineStatus(
  input: ResolvePickLineStatusInput,
): QueueSheetLineStatus {
  const kind = resolvePickLineStatus(input);
  if (kind === 'picked') return 'picked';
  if (kind === 'flagged') return 'flagged';
  if (kind === 'skipped') return 'skipped';
  if (kind === 'now') return 'now';
  return 'next';
}
