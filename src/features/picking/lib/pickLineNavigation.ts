import type { LineCompletionStatus } from './hydrateLineDraft';

export function isLineClosed(status: LineCompletionStatus | undefined): boolean {
  return status === 'picked' || status === 'partial' || status === 'flagged';
}

/** Next pick line index that still needs work, scanning forward from `fromIndex`. */
export function findNextPendingLineIndex(
  pickItems: ReadonlyArray<{ id: number }>,
  fromIndex: number,
  completedLines: Readonly<Record<number, LineCompletionStatus>>,
): number | null {
  if (pickItems.length === 0) return null;
  for (let step = 1; step <= pickItems.length; step += 1) {
    const idx = (fromIndex + step) % pickItems.length;
    const item = pickItems[idx];
    if (!item) continue;
    if (!isLineClosed(completedLines[item.id])) return idx;
  }
  return null;
}
