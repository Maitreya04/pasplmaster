import { normalizeUom, uomLabel } from '../../../lib/picking/pickerMicrocopy';

export function pickQtyVariance(
  logged: number,
  ordered: number,
): { isOver: boolean; isUnder: boolean; isExact: boolean; delta: number } {
  const delta = logged - ordered;
  return {
    isOver: delta > 0,
    isUnder: delta < 0,
    isExact: delta === 0,
    delta,
  };
}

/** Human copy comparing warehouse logged qty to billing-approved order qty. */
export function pickQtyOrderCopy(
  logged: number,
  ordered: number,
  uom: string,
): string {
  const uomNorm = normalizeUom(uom);
  const u = uomLabel(uomNorm, ordered);
  const { isOver, isUnder, isExact, delta } = pickQtyVariance(logged, ordered);

  if (isExact) return `All ${ordered} ${u} on order logged`;
  if (isOver) return `${logged} logged · ${ordered} on order (+${delta} extra)`;
  if (isUnder) return `${logged} of ${ordered} ${u} on order`;
  return `${ordered} on order`;
}

export function pickQtyStripCopy(logged: number, ordered: number, uom: string): string {
  const uomNorm = normalizeUom(uom);
  const { isOver, isUnder, isExact, delta } = pickQtyVariance(logged, ordered);

  if (isExact) return `Line complete · ${logged} ${uomNorm.toLowerCase()} on order`;
  if (isOver) {
    return `Line complete · ${logged} logged (+${delta} over ${ordered} on order)`;
  }
  if (isUnder) {
    return `Partial · ${logged} of ${ordered} ${uomNorm.toLowerCase()} on order`;
  }
  return `Line complete · ${logged} ${uomNorm.toLowerCase()}`;
}
