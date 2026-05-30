import type { OrderItem } from '../../types';
import { orderItemConfirmedMrp } from './orderItemSplitGroups';
import { isFocOrderItem } from '../specialPricing';

/** Billing auto-flag notes prefix — must match SQL migration. */
export const LABEL_MRP_FLAG_NOTES_PREFIX = 'Label MRP at pick';

const OOS_FLAG_REASONS = new Set(['Out of Stock', 'Out of Stock (Billing)']);

export function roundBillingRupee(value: number): number {
  return Math.round(value);
}

export function billingRateForLabelMrpCompare(
  item: Pick<OrderItem, 'price_quoted' | 'price_system'>,
): number {
  return roundBillingRupee(item.price_quoted ?? item.price_system ?? 0);
}

export function isAutoLabelMrpFlagNotes(notes: string | null | undefined): boolean {
  return (notes ?? '').trim().startsWith(LABEL_MRP_FLAG_NOTES_PREFIX);
}

export function buildLabelMrpFlagNotes(labelMrp: number, billingRate: number): string {
  return `${LABEL_MRP_FLAG_NOTES_PREFIX} (₹${roundBillingRupee(labelMrp)} vs billing ₹${billingRate})`;
}

export function shouldUseLabelMrpAcceptLabel(
  item: Pick<OrderItem, 'flag_reason' | 'flag_notes' | 'flag_box_price'>,
  labelMrp: number | null,
): boolean {
  if (labelMrp == null) return false;
  const box =
    typeof item.flag_box_price === 'number' && Number.isFinite(item.flag_box_price)
      ? roundBillingRupee(item.flag_box_price)
      : null;
  if (box != null && box === roundBillingRupee(labelMrp)) return true;
  return isAutoLabelMrpFlagNotes(item.flag_notes);
}

/** Price billing should accept when resolving a label / price flag. */
export function resolvedLabelPriceForBilling(
  item: Pick<OrderItem, 'flag_box_price'>,
  labelMrp: number | null,
): number | null {
  if (labelMrp != null) return roundBillingRupee(labelMrp);
  const box =
    typeof item.flag_box_price === 'number' && Number.isFinite(item.flag_box_price)
      ? roundBillingRupee(item.flag_box_price)
      : null;
  return box;
}

export type LabelMrpBillingFlagPlan =
  | { action: 'skip'; reason: 'foc' | 'no_label' | 'matched' | 'manual_price_flag' | 'other_flag' }
  | {
      action: 'apply';
      flagReason: 'Price Mismatch';
      flagBoxPrice: number;
      flagNotes: string;
      setStateFlagged: boolean;
      preserveOosReason: boolean;
    }
  | { action: 'clear_auto'; restoreState: 'picked' };

export function planLabelMrpBillingFlag(
  item: Pick<
    OrderItem,
    | 'state'
    | 'flag_reason'
    | 'flag_notes'
    | 'flag_box_price'
    | 'price_quoted'
    | 'price_system'
    | 'is_foc'
    | 'confirmed_mrp'
    | 'scan_result'
  >,
): LabelMrpBillingFlagPlan {
  if (isFocOrderItem(item)) {
    return { action: 'skip', reason: 'foc' };
  }

  const labelMrp = orderItemConfirmedMrp(item as OrderItem);
  if (labelMrp == null) {
    if (
      item.state === 'flagged' &&
      item.flag_reason === 'Price Mismatch' &&
      isAutoLabelMrpFlagNotes(item.flag_notes)
    ) {
      return { action: 'clear_auto', restoreState: 'picked' };
    }
    return { action: 'skip', reason: 'no_label' };
  }

  const billingRate = billingRateForLabelMrpCompare(item);
  const labelRounded = roundBillingRupee(labelMrp);

  if (labelRounded === billingRate) {
    if (
      item.state === 'flagged' &&
      item.flag_reason === 'Price Mismatch' &&
      isAutoLabelMrpFlagNotes(item.flag_notes)
    ) {
      return { action: 'clear_auto', restoreState: 'picked' };
    }
    return { action: 'skip', reason: 'matched' };
  }

  const notes = item.flag_notes ?? '';
  if (
    item.flag_reason === 'Price Mismatch' &&
    notes.includes('Price mismatch detected at picking') &&
    !isAutoLabelMrpFlagNotes(notes)
  ) {
    return { action: 'skip', reason: 'manual_price_flag' };
  }

  const flagReason = item.flag_reason;
  if (
    flagReason != null &&
    flagReason !== 'Price Mismatch' &&
    !OOS_FLAG_REASONS.has(flagReason)
  ) {
    return { action: 'skip', reason: 'other_flag' };
  }

  const preserveOos = flagReason != null && OOS_FLAG_REASONS.has(flagReason);

  return {
    action: 'apply',
    flagReason: 'Price Mismatch',
    flagBoxPrice: labelRounded,
    flagNotes: buildLabelMrpFlagNotes(labelRounded, billingRate),
    setStateFlagged: !preserveOos && item.state === 'picked',
    preserveOosReason: preserveOos,
  };
}
