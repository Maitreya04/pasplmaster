import type { QtyState } from './qtyEntryState';
import { isExtremeOverTarget } from './qtyEntryState';

/** Normalize UOM for display (uppercase badge). */
export function normalizeUom(uom: string | null | undefined): string {
  const raw = (uom ?? 'PCS').trim().toUpperCase();
  return raw || 'PCS';
}

/** Pluralized UOM label for qty copy — never hardcode plurals. */
export function uomLabel(uom: string, n: number): string {
  const u = normalizeUom(uom);
  if (n === 1) return u.toLowerCase();
  if (u === 'PAIR') return 'pairs';
  if (u === 'PCS') return 'pcs';
  return u.toLowerCase() + 's';
}

/** "{uom} ordered" label on identity strip — singular lowercase. */
export function uomOrderedLabel(uom: string): string {
  return `${uomLabel(uom, 1)} ordered`;
}

export function qtyFeedbackText(
  state: QtyState,
  n: number,
  target: number,
  uom: string,
  loggedQty: number,
): string {
  switch (state) {
    case 'empty':
      return 'tap a number';
    case 'partial': {
      const remaining = Math.max(0, target - loggedQty - n);
      return `${remaining} ${uomLabel(uom, remaining)} still to log`;
    }
    case 'exact':
      return 'Fills the order exactly ✓';
    case 'over': {
      const overBy = n - target;
      return `Over order by ${overBy} ${uomLabel(uom, overBy)}`;
    }
  }
}

export function qtyCtaLabel(
  state: QtyState,
  n: number,
  mrp: number | null,
  uom: string,
  hasNote: boolean,
): string {
  if (state === 'empty') return 'Log batch →';
  if (state === 'over' && !hasNote) return 'Add a note first →';
  const u = uomLabel(uom, n);
  const price = mrp != null ? ` @ ₹${Math.round(mrp)}` : '';
  if (state === 'exact') return `${n} ${u}${price} ✓`;
  if (state === 'over') return `${n} ${u}${price} →`;
  return `${n} ${u}${price}`;
}

export function overTargetBannerText(
  n: number,
  target: number,
  uom: string,
): string {
  const u = uomLabel(uom, 1);
  const extra = n - target;
  if (isExtremeOverTarget(n, target)) {
    return `Order is for ${target} ${u}. You're picking ${extra} extra — billing will need to adjust the invoice. Note is required.`;
  }
  return `Order is for ${target} ${u}. Picking ${extra} extra. Add a note below so billing knows why.`;
}

export function gapHeroSubLabel(remaining: number, target: number, uom: string): string {
  if (remaining <= 0) {
    return `All ${target} ${uomLabel(uom, target)} logged ✓`;
  }
  return `${remaining} ${uomLabel(uom, remaining)} still unlogged`;
}

export function commitPreviewSentence(n: number, mrp: number | null, uom: string): string {
  const price = mrp != null ? ` at ₹${Math.round(mrp)}` : '';
  return `${n} ${uomLabel(uom, n)}${price}`;
}

export function mrpEntryCtaLabel(mrp: number | null): string {
  if (mrp == null || mrp <= 0) return 'Enter MRP →';
  return `How many at ₹${Math.round(mrp)} →`;
}

export function notePlaceholder(isOver: boolean): string {
  return isOver
    ? 'Why are you picking more than ordered?'
    : 'Reason or observation (optional)';
}

export function noteButtonLabel(hasNote: boolean): string {
  return hasNote ? 'noted ✓' : '+ note';
}
