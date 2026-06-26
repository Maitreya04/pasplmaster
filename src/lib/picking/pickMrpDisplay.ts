import type { OrderItem, ScanResult } from '../../types';
import type { StockMrpHistoryResult } from '../../types';
import {
  billingRateForOrderItem,
  isPickLabelVsStockAtPick,
  roundPickMrp,
} from '../billing/pickMrpBillingContext';
import { scanMrpSourceFromSuggestion, stockMrpFromHistory } from '../stockMrpSuggestion';
import type { PickLineMrpState } from './pickLineMrp';
import { pickLineMrpFinal } from './pickLineMrp';

export function pickLineBillingRate(
  orderItem: Pick<OrderItem, 'price_quoted' | 'price_system'>,
): number | null {
  const rate = billingRateForOrderItem(orderItem);
  return rate > 0 ? rate : null;
}

export function pickLabelMrpRounded(
  state: PickLineMrpState | undefined,
  segmentMrp?: number | null,
): number | null {
  const raw = segmentMrp ?? pickLineMrpFinal(state);
  if (raw == null || !Number.isFinite(raw)) return null;
  return roundPickMrp(raw);
}

export function isPickLabelVsBillingMismatch(
  labelMrp: number | null,
  billingRate: number | null,
): boolean {
  if (labelMrp == null || billingRate == null || billingRate <= 0) return false;
  return roundPickMrp(labelMrp) !== roundPickMrp(billingRate);
}

export function isPickLabelVsStockMismatch(
  labelMrp: number | null,
  stockMrp: number | null,
): boolean {
  return isPickLabelVsStockAtPick(labelMrp, stockMrp);
}

/** Picker ⚠ at pick — label on product ≠ stock suggestion (billing desk input). */
export function pickMrpNeedsBillingReview(
  state: PickLineMrpState | undefined,
  stockMrp: number | null,
  segmentMrp?: number | null,
): boolean {
  return isPickLabelVsStockMismatch(
    pickLabelMrpRounded(state, segmentMrp),
    stockMrp,
  );
}

/** Billing rate + stock band snapshot when writing scan_result at pick. */
export function pickMrpMergeInputs(
  orderItem: OrderItem,
  itemId: number,
  focusItemId: number | undefined,
  history: StockMrpHistoryResult | undefined,
): {
  billingRate: number | null;
  stockMrp: number | null;
  historyCount: number;
  mrpSource: ScanResult['mrpSource'];
} {
  const billingRate = pickLineBillingRate(orderItem);
  const focused = focusItemId != null && itemId === focusItemId;
  if (!focused) {
    return { billingRate, stockMrp: null, historyCount: 0, mrpSource: null };
  }
  return {
    billingRate,
    stockMrp: stockMrpFromHistory(history),
    historyCount: history?.history.length ?? 0,
    mrpSource: scanMrpSourceFromSuggestion(history?.suggestion_source ?? 'empty'),
  };
}

export function pickMetricMrpFlagged(
  labelMrp: number | null,
  stockMrp: number | null,
): boolean {
  return isPickLabelVsStockMismatch(labelMrp, stockMrp);
}
