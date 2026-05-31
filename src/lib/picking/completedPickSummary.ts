import type { Order } from '../../types';
import type { OrderItemEmbedRow } from '../orderItemCount';
import {
  pickQuantityTarget,
  pickableOrderItems,
  type PickLineQty,
} from '../cartSupply';
import { deskLineFlagChipLabel } from '../billing/deskLineFlagKind';

export type CompletedPickOutcome = 'clean' | 'flagged';

export type PickerCompletedDay = 'today' | 'yesterday';

export interface CompletedPickLineDetail {
  itemId: number | null;
  itemName: string;
  rackNo: string | null;
  state: 'picked' | 'flagged';
  flagReason: string | null;
  flagNotes: string | null;
  targetQty: number;
}

export interface CompletedPickSummary {
  outcome: CompletedPickOutcome;
  pickedCount: number;
  flaggedCount: number;
  totalLines: number;
  pieceTarget: number;
  piecePicked: number;
  flagReasonCounts: Record<string, number>;
  flagReasonLabels: string[];
  lines: CompletedPickLineDetail[];
}

/** Indore warehouse pick queue — excludes direct-bill and non–main-store orders. */
export function isPickQueueEligible(order: Order): boolean {
  if (order.fulfillment_path === 'direct_bill') return false;
  if (order.stock_location_code === 'jabalpur') return false;
  return true;
}

export function getPickerCompletedDayRange(day: PickerCompletedDay): {
  start: string;
  end: string;
} {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (day === 'yesterday') {
    start.setDate(start.getDate() - 1);
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function toPickLineQty(row: OrderItemEmbedRow): PickLineQty {
  return {
    qty_requested: row.qty_requested ?? 0,
    qty_shippable: row.qty_shippable,
    qty_po: row.qty_po,
    qty_approved: row.qty_approved,
  };
}

/** Short chip label for picker completed rows. */
export function pickerFlagChipLabel(flagReason: string | null | undefined): string {
  if (!flagReason) return 'Flagged';
  const full = deskLineFlagChipLabel(flagReason);
  if (full === 'Out of stock') return 'OOS';
  if (full === 'Price mismatch') return 'Price';
  if (flagReason === 'Damaged') return 'Damaged';
  if (flagReason === 'Wrong Part') return 'Wrong part';
  if (flagReason === "Can't Find") return "Can't find";
  if (flagReason === 'Other') return 'Other';
  return full.length > 18 ? `${full.slice(0, 16)}…` : full;
}

type CompletedEmbedRow = OrderItemEmbedRow & {
  flag_notes?: string | null;
  split_from_id?: number | null;
};

export function buildCompletedPickSummary(
  embed: CompletedEmbedRow[] | null | undefined,
): CompletedPickSummary {
  const pickable = pickableOrderItems(
    (embed ?? []).map((row) => ({
      ...toPickLineQty(row),
      split_from_id: row.split_from_id,
      item_id: row.item_id,
      item_name: row.item_name,
      state: row.state,
      flag_reason: row.flag_reason,
      flag_notes: row.flag_notes,
      rack_no: row.rack_no,
    })),
  );

  let pickedCount = 0;
  let flaggedCount = 0;
  let pieceTarget = 0;
  let piecePicked = 0;
  const flagReasonCounts: Record<string, number> = {};
  const lines: CompletedPickLineDetail[] = [];

  for (const row of pickable) {
    const targetQty = pickQuantityTarget(row);
    pieceTarget += targetQty;
    const state = row.state === 'flagged' ? 'flagged' : row.state === 'picked' ? 'picked' : null;
    if (state === 'picked') {
      pickedCount += 1;
      piecePicked += targetQty;
    } else if (state === 'flagged') {
      flaggedCount += 1;
      const reason = (row as CompletedEmbedRow).flag_reason?.trim() || 'Flagged';
      flagReasonCounts[reason] = (flagReasonCounts[reason] ?? 0) + 1;
    }

    if (state === 'picked' || state === 'flagged') {
      lines.push({
        itemId: (row as CompletedEmbedRow).item_id ?? null,
        itemName: (row as CompletedEmbedRow).item_name?.trim() || 'Unknown item',
        rackNo: (row as CompletedEmbedRow).rack_no ?? null,
        state,
        flagReason: (row as CompletedEmbedRow).flag_reason ?? null,
        flagNotes: (row as CompletedEmbedRow).flag_notes ?? null,
        targetQty,
      });
    }
  }

  const flagReasonLabels = Object.entries(flagReasonCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([reason]) => pickerFlagChipLabel(reason));

  return {
    outcome: flaggedCount > 0 ? 'flagged' : 'clean',
    pickedCount,
    flaggedCount,
    totalLines: pickable.length,
    pieceTarget,
    piecePicked,
    flagReasonCounts,
    flagReasonLabels,
    lines,
  };
}

export function formatPickingCompletedTime(
  pickingCompletedAt: string | null | undefined,
): string {
  if (!pickingCompletedAt) return '';
  const d = new Date(pickingCompletedAt);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return time;
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${date}, ${time}`;
}
