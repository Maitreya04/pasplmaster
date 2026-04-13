import type { Item, OrderItem } from '../types';

function cleanCode(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

export function firstAvailableCode(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const code = cleanCode(value);
    if (code) return code;
  }
  return '';
}

export function itemPickCode(item: Pick<Item, 'alias1' | 'alias'>): string {
  return firstAvailableCode(item.alias1, item.alias);
}

export function itemAlternateCode(item: Pick<Item, 'alias1' | 'alias'>): string | null {
  const alias1 = cleanCode(item.alias1);
  const alias = cleanCode(item.alias);
  if (alias1 && alias) return alias;
  return null;
}

export function orderItemPickCode(
  item: Pick<OrderItem, 'catalog_alias1' | 'catalog_alias' | 'item_alias'>,
): string {
  return firstAvailableCode(item.catalog_alias1, item.catalog_alias, item.item_alias);
}

export function orderItemAlternateCode(
  item: Pick<OrderItem, 'catalog_alias1' | 'catalog_alias' | 'item_alias'>,
): string | null {
  const alias1 = cleanCode(item.catalog_alias1);
  const alias = cleanCode(item.catalog_alias);
  if (alias1 && alias) return alias;
  return null;
}

export function itemGroupLabel(
  item: Pick<Item, 'main_group' | 'parent_group'>,
): string {
  return cleanCode(item.main_group) || cleanCode(item.parent_group) || 'Ungrouped';
}
