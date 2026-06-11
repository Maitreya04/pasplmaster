import type { OrderWithItems } from '../../types';
import { pickerBillingHandoffLine } from './pickerBillingHandoff';
import type { PickFinalisationCounts } from './pickFinalisationCounts';

export type PickCompletionSaveState = 'saved' | 'already_saved' | 'queued' | 'needs_review';

export interface PickCompletionSnapshot {
  orderNumber: string;
  customerName: string;
  customerCity: string | null;
  transportName: string | null;
  pickedLineCount: number;
  flaggedLineCount: number;
  totalLineCount: number;
  pickedPieceCount: number;
  totalPieceCount: number;
  boxCount: number;
  billingNotified: boolean;
  billingHandoffLine: string;
  finishedAtIso: string;
  startedAtIso: string | null;
  flagReasonLabels: string[];
  saveState: PickCompletionSaveState;
}

function shortFlagReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) return 'Flagged';
  if (trimmed === 'Out of Stock') return 'OOS';
  if (trimmed === 'Price Mismatch') return 'Price';
  if (trimmed === "Can't Find") return "Can't find";
  return trimmed.length > 18 ? `${trimmed.slice(0, 16)}...` : trimmed;
}

function flagReasonLabels(order: OrderWithItems): string[] {
  const counts = new Map<string, number>();
  for (const item of order.items) {
    if (item.state !== 'flagged') continue;
    const reason = item.flag_reason?.trim() || 'Flagged';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => {
      const label = shortFlagReason(reason);
      return count > 1 ? `${label} x${count}` : label;
    });
}

export function buildPickCompletionSnapshot(options: {
  order: OrderWithItems;
  counts: PickFinalisationCounts;
  boxCount: number;
  billingNotified: boolean;
  finishedAtIso?: string;
  saveState?: PickCompletionSaveState;
}): PickCompletionSnapshot {
  const { order, counts } = options;
  return {
    orderNumber: order.order_number,
    customerName: order.customer_name,
    customerCity: order.customer_city,
    transportName: order.transport_name,
    pickedLineCount: counts.picked,
    flaggedLineCount: counts.flagged,
    totalLineCount: counts.total,
    pickedPieceCount: counts.piecePicked,
    totalPieceCount: counts.pieceTarget,
    boxCount: options.boxCount,
    billingNotified: options.billingNotified,
    billingHandoffLine: pickerBillingHandoffLine(counts.flagged > 0),
    finishedAtIso: options.finishedAtIso ?? new Date().toISOString(),
    startedAtIso: order.picked_at ?? null,
    flagReasonLabels: flagReasonLabels(order),
    saveState: options.saveState ?? 'saved',
  };
}

export function withPickCompletionSaveState(
  snapshot: PickCompletionSnapshot,
  saveState: PickCompletionSaveState,
): PickCompletionSnapshot {
  return { ...snapshot, saveState };
}
