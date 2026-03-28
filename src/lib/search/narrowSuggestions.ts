import type { Item } from '../../types';
import { normalizeQuery } from './itemSearch';

export type NarrowSuggestionType = 'brand' | 'group';

export interface NarrowSuggestion {
  type: NarrowSuggestionType;
  value: string;
  label: string;
  count: number;
}

export function hasTokenPrefix(value: string | null | undefined, token: string): boolean {
  if (!value) return false;
  const v = value.toLowerCase();
  const t = token.toLowerCase();
  return v.split(/\s+/).some(word => word.startsWith(t));
}

export interface NarrowIndex {
  itemCountByMainGroup: Map<string, number>;
  parentGroupCountsGlobal: Map<string, number>;
  uniqueMainGroups: string[];
  uniqueParentGroups: string[];
  itemsByBrand: Map<string, Item[]>;
  itemsByParentGroup: Map<string, Item[]>;
  /** main_group → parent_group → item count */
  countsByBrandGroup: Map<string, Map<string, number>>;
}

/** Precomputed maps so narrow-by avoids scanning the full catalog each keystroke. */
export function buildNarrowIndex(items: Item[]): NarrowIndex {
  const itemCountByMainGroup = new Map<string, number>();
  const parentGroupCountsGlobal = new Map<string, number>();
  const countsByBrandGroup = new Map<string, Map<string, number>>();
  const itemsByBrand = new Map<string, Item[]>();
  const itemsByParentGroup = new Map<string, Item[]>();

  for (const it of items) {
    const b = it.main_group;
    const p = it.parent_group;
    if (b) {
      itemCountByMainGroup.set(b, (itemCountByMainGroup.get(b) ?? 0) + 1);
      if (!itemsByBrand.has(b)) itemsByBrand.set(b, []);
      itemsByBrand.get(b)!.push(it);
    }
    if (p) {
      parentGroupCountsGlobal.set(p, (parentGroupCountsGlobal.get(p) ?? 0) + 1);
      if (!itemsByParentGroup.has(p)) itemsByParentGroup.set(p, []);
      itemsByParentGroup.get(p)!.push(it);
    }
    if (b && p) {
      if (!countsByBrandGroup.has(b)) countsByBrandGroup.set(b, new Map());
      const g = countsByBrandGroup.get(b)!;
      g.set(p, (g.get(p) ?? 0) + 1);
    }
  }

  return {
    itemCountByMainGroup,
    parentGroupCountsGlobal,
    uniqueMainGroups: [...itemCountByMainGroup.keys()],
    uniqueParentGroups: [...parentGroupCountsGlobal.keys()],
    itemsByBrand,
    itemsByParentGroup,
    countsByBrandGroup,
  };
}

/**
 * Brand / subcategory chips for the "Narrow by" row (prefix on last query token).
 * Behavior matches the original O(n) scan; unfiltered queries use unique brands/groups only.
 */
export function buildNarrowSuggestions(
  idx: NarrowIndex,
  rawQuery: string,
  activeBrand: string | null,
  activeGroup: string | null,
): NarrowSuggestion[] {
  const q = normalizeQuery(rawQuery);
  const tokens = q.split(' ').filter(Boolean);
  if (!tokens.length) return [];
  const last = tokens[tokens.length - 1];
  if (last.length < 2) return [];

  const brandCounts = new Map<string, number>();
  const groupCounts = new Map<string, number>();

  if (!activeBrand && !activeGroup) {
    for (const mg of idx.uniqueMainGroups) {
      if (hasTokenPrefix(mg, last)) {
        brandCounts.set(mg, idx.itemCountByMainGroup.get(mg) ?? 0);
      }
    }
    for (const pg of idx.uniqueParentGroups) {
      if (hasTokenPrefix(pg, last)) {
        groupCounts.set(pg, idx.parentGroupCountsGlobal.get(pg) ?? 0);
      }
    }
  } else if (activeBrand && !activeGroup) {
    for (const it of idx.itemsByBrand.get(activeBrand) ?? []) {
      if (hasTokenPrefix(it.main_group, last)) {
        brandCounts.set(it.main_group!, (brandCounts.get(it.main_group!) ?? 0) + 1);
      }
      if (hasTokenPrefix(it.parent_group, last)) {
        groupCounts.set(it.parent_group!, (groupCounts.get(it.parent_group!) ?? 0) + 1);
      }
    }
  } else if (!activeBrand && activeGroup) {
    for (const it of idx.itemsByParentGroup.get(activeGroup) ?? []) {
      if (hasTokenPrefix(it.main_group, last)) {
        brandCounts.set(it.main_group!, (brandCounts.get(it.main_group!) ?? 0) + 1);
      }
      if (hasTokenPrefix(it.parent_group, last)) {
        groupCounts.set(it.parent_group!, (groupCounts.get(it.parent_group!) ?? 0) + 1);
      }
    }
  } else {
    for (const it of idx.itemsByBrand.get(activeBrand!) ?? []) {
      if (activeGroup && it.parent_group !== activeGroup) continue;
      if (hasTokenPrefix(it.main_group, last)) {
        brandCounts.set(it.main_group!, (brandCounts.get(it.main_group!) ?? 0) + 1);
      }
      if (hasTokenPrefix(it.parent_group, last)) {
        groupCounts.set(it.parent_group!, (groupCounts.get(it.parent_group!) ?? 0) + 1);
      }
    }
  }

  let focusedBrand: string | null = activeBrand;
  if (!focusedBrand && brandCounts.size) {
    const sorted = [...brandCounts.entries()].sort((a, b) => b[1] - a[1]);
    const topCount = sorted[0][1];
    const secondCount = sorted.length > 1 ? sorted[1][1] : 0;
    if (sorted.length === 1 || topCount > secondCount * 3) {
      focusedBrand = sorted[0][0];
    }
  }
  if (focusedBrand && !activeGroup) {
    for (const it of idx.itemsByBrand.get(focusedBrand) ?? []) {
      if (!it.parent_group) continue;
      groupCounts.set(it.parent_group, (groupCounts.get(it.parent_group) ?? 0) + 1);
    }
  }

  const brandSuggestions: NarrowSuggestion[] = [...brandCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([value, count]) => ({
      type: 'brand' as const,
      value,
      label: value,
      count,
    }));

  const groupSuggestions: NarrowSuggestion[] = [...groupCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([value, count]) => ({
      type: 'group' as const,
      value,
      label: value,
      count,
    }));

  return [...brandSuggestions, ...groupSuggestions];
}
