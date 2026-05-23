import type { OrderItem } from '../../types';

export interface DeckPickItem {
  orderItem: OrderItem;
  uiState: string;
}

function compareRack(a: OrderItem, b: OrderItem): number {
  if (!a.rack_no && !b.rack_no) return 0;
  if (!a.rack_no) return 1;
  if (!b.rack_no) return -1;
  return a.rack_no.localeCompare(b.rack_no, undefined, { numeric: true });
}

function isDone(uiState: string): boolean {
  return uiState === 'picked' || uiState === 'flagged' || uiState === 'overridden';
}

/**
 * Build the swipe deck order: active non-skipped (rack order) → active skipped
 * (rack order) → done (rack order). Skipped lines stay pickable at the back;
 * done lines remain visible for spatial memory.
 */
export function buildDeckOrder<T extends DeckPickItem>(
  items: T[],
  skippedIds: Set<number>,
): T[] {
  const active: T[] = [];
  const done: T[] = [];
  for (const item of items) {
    if (isDone(item.uiState)) done.push(item);
    else active.push(item);
  }

  const sortByRack = (list: T[]) =>
    [...list].sort((a, b) => compareRack(a.orderItem, b.orderItem));

  const activeSorted = sortByRack(active);
  const nonSkipped = activeSorted.filter((i) => !skippedIds.has(i.orderItem.id));
  const skipped = activeSorted.filter((i) => skippedIds.has(i.orderItem.id));

  return [...nonSkipped, ...skipped, ...sortByRack(done)];
}

export function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

/** Next deck index whose line is still pickable (not terminal). */
export function nextPickableIndex<T extends DeckPickItem>(
  deck: T[],
  fromIndex: number,
): number | null {
  if (deck.length === 0) return null;
  for (let step = 1; step <= deck.length; step += 1) {
    const idx = wrapIndex(fromIndex + step, deck.length);
    if (!isDone(deck[idx]!.uiState)) return idx;
  }
  return null;
}

export function findDeckIndexByItemId<T extends DeckPickItem>(
  deck: T[],
  itemId: number,
): number {
  const idx = deck.findIndex((d) => d.orderItem.id === itemId);
  return idx >= 0 ? idx : 0;
}
