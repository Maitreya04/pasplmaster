import type { OrderItem, ScanResult } from '../../../types';
import { roundPickMrp } from '../../../lib/billing/pickMrpBillingContext';
import type { MrpSuggestionSource } from '../../../types';

export type PriceGroupMrpContext = {
  suggestedMrpAtPick: number | null;
  stockMrpAtPick: number | null;
  suggestionSource: MrpSuggestionSource;
  historyCount: number;
  acceptedSuggestion: boolean;
};

export function buildPriceGroupScanResult(options: {
  orderItem: OrderItem;
  mrp: number;
  qty: number;
  totalLogged: number;
  targetQty: number;
  pickerName: string | null;
  pickerUserId: number | null;
  pickerNote?: string | null;
  isOverTarget?: boolean;
  mrpContext?: PriceGroupMrpContext;
}): ScanResult {
  const {
    orderItem,
    mrp,
    qty,
    totalLogged,
    targetQty,
    pickerName,
    pickerUserId,
    pickerNote,
    isOverTarget,
    mrpContext,
  } = options;

  const labelRounded = roundPickMrp(mrp);
  const stockRounded =
    mrpContext?.stockMrpAtPick != null && mrpContext.stockMrpAtPick > 0
      ? roundPickMrp(mrpContext.stockMrpAtPick)
      : null;

  const mrpSource: ScanResult['mrpSource'] = mrpContext?.acceptedSuggestion
    ? mrpContext.suggestionSource === 'picker_30d'
      ? 'picker_30d'
      : mrpContext.suggestionSource === 'stock_mrpwise'
        ? 'stock_mrpwise'
        : mrpContext.suggestionSource === 'items_fallback'
          ? 'items_fallback'
          : mrpContext.suggestionSource === 'picker_verified'
            ? 'picker_verified'
            : 'stock_mrpwise'
    : 'custom';

  const mrpFlagged =
    stockRounded != null && labelRounded !== stockRounded;

  const reason = isOverTarget
    ? `Over-target pick · label ₹${labelRounded} × ${qty}${pickerNote ? ` · ${pickerNote}` : ''}`
    : `Label ₹${labelRounded} × ${qty}`;
  const overTargetQty = Math.max(0, totalLogged - targetQty);
  const cleanPickerNote = pickerNote?.trim() || null;

  return {
    scannedText: 'PRICE_GROUP',
    confidence: 100,
    isMatch: true,
    matchedAgainst: orderItem.item_alias ?? String(orderItem.item_id),
    matchStrategy: 'price_group',
    ocrExtracted: { partNumber: null, mrp: labelRounded },
    method: 'manual',
    timestamp: new Date().toISOString(),
    reason,
    confirmedMrp: labelRounded,
    mrpSource,
    mrpFlagged,
    mrpHistoryCount: mrpContext?.historyCount ?? 0,
    billingRateAtPick: labelRounded,
    suggestedMrpAtPick: stockRounded ?? mrpContext?.suggestedMrpAtPick ?? undefined,
    stockMrpAtPick: stockRounded ?? undefined,
    progress: {
      pickedQty: totalLogged,
      remainingQty: Math.max(0, targetQty - totalLogged),
      targetQty,
    },
    originalTargetQty: targetQty,
    isOverTarget: isOverTarget === true || undefined,
    overTargetQty: isOverTarget ? overTargetQty : undefined,
    pickerNote: cleanPickerNote,
    operatorContext: {
      pickerName,
      pickerUserId,
      source: 'manual',
    },
  };
}

export function applyShortPickScanResult(
  scanResult: ScanResult | null | undefined,
  options: {
    pickedQty: number;
    targetQty: number;
    reason: string;
    note?: string | null;
  },
): ScanResult | null {
  if (!scanResult) return null;
  const pickedQty = Math.max(0, Math.floor(options.pickedQty));
  const targetQty = Math.max(0, Math.floor(options.targetQty));
  const shortQty = Math.max(0, targetQty - pickedQty);
  const note = options.note?.trim() || null;
  const reason = options.reason.trim() || 'Short pick';

  return {
    ...scanResult,
    reason: `Short pick · ${pickedQty} of ${targetQty} · ${reason}${note ? ` · ${note}` : ''}`,
    progress: {
      pickedQty,
      remainingQty: shortQty,
      targetQty,
    },
    originalTargetQty: targetQty,
    isShortPick: true,
    shortQty,
    shortReason: reason,
    pickerNote: note,
  };
}
