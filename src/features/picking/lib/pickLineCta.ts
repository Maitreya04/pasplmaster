import { uomLabel } from '../../../lib/picking/pickerMicrocopy';

/** Semantic line states for footer CTAs — one label per intent. */
export type PickLineUiState =
  | 'fresh'
  | 'in_progress'
  | 'complete'
  | 'marked_picked'
  | 'marked_partial'
  | 'flagged';

export function derivePickLineUiState(
  markedStatus: 'picked' | 'partial' | 'flagged' | undefined,
  totalLogged: number,
  targetQty: number,
  isComplete: boolean,
): PickLineUiState {
  if (markedStatus === 'flagged') return 'flagged';
  if (markedStatus === 'picked') return 'marked_picked';
  if (markedStatus === 'partial') return 'marked_partial';
  if (isComplete) return 'complete';
  if (totalLogged > 0) return 'in_progress';
  return 'fresh';
}

export type PickPrimaryCta =
  | { kind: 'pick'; label: string }
  | { kind: 'next'; label: string }
  | { kind: 'edit'; label: string }
  | { kind: 'finish'; label: string };

export function pickPrimaryCta(
  state: PickLineUiState,
  remaining: number,
  targetQty: number,
  uom: string,
  lineIndex: number,
  totalLines: number,
  revisitComplete: boolean,
): PickPrimaryCta {
  const u = uomLabel(uom, remaining > 0 ? remaining : targetQty);
  const isLastLine = lineIndex >= totalLines - 1;

  if (state === 'marked_picked' || state === 'marked_partial') {
    if (revisitComplete) {
      return { kind: 'edit', label: 'Edit pick' };
    }
    if (isLastLine) {
      return { kind: 'finish', label: 'Finish order' };
    }
    return { kind: 'next', label: 'Next line →' };
  }

  if (state === 'complete') {
    if (isLastLine) {
      return { kind: 'finish', label: 'Finish order' };
    }
    return { kind: 'next', label: 'Next line →' };
  }

  if (state === 'in_progress') {
    return { kind: 'pick', label: `Pick ${remaining} more ${u}` };
  }

  return { kind: 'pick', label: `Pick ${targetQty} ${uomLabel(uom, targetQty)}` };
}

export function pickSecondaryCta(
  state: PickLineUiState,
  revisitComplete: boolean,
  lineIndex: number,
  totalLines: number,
): PickPrimaryCta | null {
  if (!revisitComplete) return null;
  if (state !== 'marked_picked' && state !== 'marked_partial') return null;
  if (lineIndex >= totalLines - 1) return null;
  return { kind: 'next', label: 'Next line →' };
}
