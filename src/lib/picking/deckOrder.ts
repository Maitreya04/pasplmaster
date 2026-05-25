import type { OrderItem } from '../../types';
import { sortPickWalkOrder } from './pickWalkOrder';

export {
  sortPickWalkOrder,
  orderItemBrandLabel,
  buildPickWalkBrandSections,
  buildDeckBrandPositionLabels,
} from './pickWalkOrder';
export type { PickWalkBrandSection, PickWalkRackStop } from './pickWalkOrder';

export interface DeckPickItem {
  orderItem: OrderItem;
  uiState: string;
}

function isDone(uiState: string): boolean {
  return uiState === 'picked' || uiState === 'flagged' || uiState === 'overridden';
}

function sortDeckItemsByWalk<T extends DeckPickItem>(list: T[]): T[] {
  if (list.length <= 1) return [...list];
  const sortedItems = sortPickWalkOrder(list.map((entry) => entry.orderItem));
  const byId = new Map(list.map((entry) => [entry.orderItem.id, entry]));
  return sortedItems.map((item) => byId.get(item.id)!);
}

/**
 * Build the swipe deck order: active non-skipped (brand walk order) → active skipped
 * (brand walk order) → done (brand walk order). Skipped lines stay pickable at the back;
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

  const activeSorted = sortDeckItemsByWalk(active);
  const nonSkipped = activeSorted.filter((i) => !skippedIds.has(i.orderItem.id));
  const skipped = activeSorted.filter((i) => skippedIds.has(i.orderItem.id));

  return [...nonSkipped, ...skipped, ...sortDeckItemsByWalk(done)];
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

export function orderItemPickCode(item: OrderItem): string {
  return (
    item.catalog_alias1 ??
    item.catalog_alias ??
    item.item_alias ??
    String(item.item_id)
  );
}

export interface NextPickLinePreview {
  code: string;
  rackNo: string | null;
  itemName: string;
  deckIndex: number;
}

/** Human-readable target for the confirm-and-advance CTA. */
export function nextPickLinePreview<T extends DeckPickItem>(
  deck: T[],
  fromIndex: number,
): NextPickLinePreview | null {
  const deckIndex = nextPickableIndex(deck, fromIndex);
  if (deckIndex == null) return null;
  const entry = deck[deckIndex]!;
  return {
    code: orderItemPickCode(entry.orderItem),
    rackNo: entry.orderItem.rack_no,
    itemName: entry.orderItem.item_name,
    deckIndex,
  };
}
