import type { OrderItem } from '../../types';

export function deriveBusyCodeCandidates(item: OrderItem): number[] {
  const candidates = [item.item_alias, item.catalog_alias, item.catalog_alias1];
  const values = new Set<number>();
  for (const value of candidates) {
    if (!value) continue;
    const digits = value.replace(/[^\d]/g, '');
    if (!digits) continue;
    const parsed = Number(digits);
    if (Number.isFinite(parsed) && parsed > 0) values.add(parsed);
  }
  return [...values];
}
