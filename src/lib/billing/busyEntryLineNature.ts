import { isFocOrderItem, isSpecialRateItem } from '../specialPricing';
import type { OrderItem } from '../../types';

export type BusyEntryLineNature = 'normal' | 'foc' | 'special_rate' | 'scheme';

/** Visual stripe + tag for busy-entry rows (no business logic change). */
export function busyEntryLineNature(
  item: Pick<OrderItem, 'is_foc' | 'price_quoted' | 'price_system'>,
): BusyEntryLineNature {
  if (isFocOrderItem(item)) return 'foc';
  if (isSpecialRateItem(item)) return 'special_rate';
  return 'normal';
}

export function busyEntryBrandLabel(
  item: Pick<OrderItem, 'catalog_main_group'>,
): string | null {
  const brand = item.catalog_main_group?.trim();
  return brand && brand.length > 0 ? brand : null;
}
