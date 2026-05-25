import type { OrderItem } from '../../types';
import { orderItemPickCode } from '../../utils/itemCodes';

/** Brand label from order line snapshot (Busy main_group, then parent_group). */
export function orderItemBrandLabel(
  item: Pick<OrderItem, 'catalog_main_group' | 'catalog_parent_group'>,
): string {
  const main = item.catalog_main_group?.trim();
  if (main) return main;
  const parent = item.catalog_parent_group?.trim();
  if (parent) return parent;
  return 'Other';
}

type RackSortKey = readonly [missing: 0 | 1, rack: string];

function rackSortKey(rack: string | null | undefined): RackSortKey {
  const trimmed = rack?.trim();
  if (!trimmed) return [1, ''];
  return [0, trimmed];
}

function compareRackKeys(a: RackSortKey, b: RackSortKey): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  return a[1].localeCompare(b[1], undefined, { numeric: true });
}

/** Rack order within a brand block — missing racks last. */
export function comparePickRack(a: OrderItem, b: OrderItem): number {
  const rackCmp = compareRackKeys(rackSortKey(a.rack_no), rackSortKey(b.rack_no));
  if (rackCmp !== 0) return rackCmp;
  return orderItemPickCode(a).localeCompare(orderItemPickCode(b), undefined, {
    numeric: true,
  });
}

function brandBlockSortKey(brand: string, minRack: RackSortKey): readonly [other: 0 | 1, ...RackSortKey] {
  if (brand === 'Other') return [1, minRack[0], minRack[1]];
  return [0, minRack[0], minRack[1]];
}

function compareBrandBlockKeys(
  a: readonly [other: 0 | 1, ...RackSortKey],
  b: readonly [other: 0 | 1, ...RackSortKey],
): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2].localeCompare(b[2], undefined, { numeric: true });
}

function buildBrandMinRackMap(items: OrderItem[]): Map<string, RackSortKey> {
  const map = new Map<string, RackSortKey>();
  for (const item of items) {
    const brand = orderItemBrandLabel(item);
    const key = rackSortKey(item.rack_no);
    const existing = map.get(brand);
    if (!existing || compareRackKeys(key, existing) < 0) {
      map.set(brand, key);
    }
  }
  return map;
}

/**
 * Walk order: brand blocks (by earliest rack in each brand) → rack within brand → item code.
 * Keeps all Varroc lines together, then the next brand, etc.
 */
export function comparePickWalkOrder(
  a: OrderItem,
  b: OrderItem,
  brandMinRack: Map<string, RackSortKey>,
): number {
  const brandA = orderItemBrandLabel(a);
  const brandB = orderItemBrandLabel(b);

  const brandCmp = compareBrandBlockKeys(
    brandBlockSortKey(brandA, brandMinRack.get(brandA) ?? [1, '']),
    brandBlockSortKey(brandB, brandMinRack.get(brandB) ?? [1, '']),
  );
  if (brandCmp !== 0) return brandCmp;

  if (brandA !== brandB) {
    return brandA.localeCompare(brandB, undefined, { sensitivity: 'base' });
  }

  return comparePickRack(a, b);
}

export function sortPickWalkOrder(items: OrderItem[]): OrderItem[] {
  if (items.length <= 1) return [...items];
  const brandMinRack = buildBrandMinRackMap(items);
  return [...items].sort((a, b) => comparePickWalkOrder(a, b, brandMinRack));
}

export interface PickWalkRackStop {
  rack: string | null;
  lines: number;
  pieces: number;
}

export interface PickWalkBrandSection {
  brand: string;
  lines: number;
  pieces: number;
  racks: PickWalkRackStop[];
}

/** Trip brief: brand blocks with rack stops in walk order. */
export function buildPickWalkBrandSections(
  items: OrderItem[],
  pieceCount: (item: OrderItem) => number,
): PickWalkBrandSection[] {
  const sorted = sortPickWalkOrder(items);
  const sections: PickWalkBrandSection[] = [];

  for (const item of sorted) {
    const brand = orderItemBrandLabel(item);
    const pieces = pieceCount(item);
    let section = sections[sections.length - 1];
    if (!section || section.brand !== brand) {
      section = { brand, lines: 0, pieces: 0, racks: [] };
      sections.push(section);
    }
    section.lines += 1;
    section.pieces += pieces;

    const rackKey = item.rack_no?.trim() ?? '—';
    let stop = section.racks[section.racks.length - 1];
    if (!stop || (stop.rack ?? '—') !== rackKey) {
      stop = { rack: item.rack_no, lines: 0, pieces: 0 };
      section.racks.push(stop);
    }
    stop.lines += 1;
    stop.pieces += pieces;
  }

  return sections;
}

/** Deck position copy: "Varroc · 2 of 4 in brand". */
export function buildDeckBrandPositionLabels(
  items: OrderItem[],
): Map<number, string> {
  const labels = new Map<number, string>();
  const brandTotals = new Map<string, number>();
  for (const item of items) {
    const brand = orderItemBrandLabel(item);
    brandTotals.set(brand, (brandTotals.get(brand) ?? 0) + 1);
  }

  const brandSeen = new Map<string, number>();
  for (const item of items) {
    const brand = orderItemBrandLabel(item);
    const idx = (brandSeen.get(brand) ?? 0) + 1;
    brandSeen.set(brand, idx);
    const total = brandTotals.get(brand) ?? 1;
    labels.set(item.id, `${brand} · ${idx} of ${total}`);
  }

  return labels;
}
