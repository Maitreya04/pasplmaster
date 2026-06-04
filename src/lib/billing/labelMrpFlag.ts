import type { OrderItem } from '../../types';
import {
  billingRateForOrderItem,
  readPickMrpSnapshot,
  roundPickMrp,
} from './pickMrpBillingContext';
import { isFocOrderItem } from '../specialPricing';

/** Billing auto-flag notes prefix — must match SQL migration. */
export const LABEL_MRP_FLAG_NOTES_PREFIX = 'Label MRP at pick';

const OOS_FLAG_REASONS = new Set(['Out of Stock', 'Out of Stock (Billing)']);

export function roundBillingRupee(value: number): number {
  return roundPickMrp(value);
}

export function billingRateForLabelMrpCompare(
  item: Pick<OrderItem, 'price_quoted' | 'price_system'>,
): number {
  return billingRateForOrderItem(item);
}

export function isAutoLabelMrpFlagNotes(notes: string | null | undefined): boolean {
  return (notes ?? '').trim().startsWith(LABEL_MRP_FLAG_NOTES_PREFIX);
}

export function buildLabelMrpFlagNotes(
  labelMrp: number,
  billingRate: number,
  suggestedMrp: number | null,
): string {
  const label = roundBillingRupee(labelMrp);
  const bill = roundBillingRupee(billingRate);
  if (suggestedMrp != null) {
    const stock = roundBillingRupee(suggestedMrp);
    return `${LABEL_MRP_FLAG_NOTES_PREFIX} · label ₹${label} · bill ₹${bill} · stock ₹${stock}`;
  }
  return `${LABEL_MRP_FLAG_NOTES_PREFIX} · label ₹${label} · bill ₹${bill}`;
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

  const snapshot = readPickMrpSnapshot(item as OrderItem);
  const labelMrp = snapshot.labelMrp;

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

  const billingRate = snapshot.billingRateAtPick ?? billingRateForLabelMrpCompare(item);

  if (!snapshot.mrpFlagged) {
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
    flagBoxPrice: labelMrp,
    flagNotes: buildLabelMrpFlagNotes(
      labelMrp,
      billingRate,
      snapshot.suggestedMrpAtPick,
    ),
    setStateFlagged: !preserveOos && item.state === 'picked',
    preserveOosReason: preserveOos,
  };
}
