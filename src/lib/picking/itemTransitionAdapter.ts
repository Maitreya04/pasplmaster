import { syncLabelMrpFlagForOrderItem } from '../billing/syncLabelMrpFlag';
import { recordPickerLabelMrpForOrderItem } from './recordPickerLabelMrp';
import { supabase } from '../supabase/client';
import type { FlagReason } from '../../utils/constants';
import type { ScanResult } from '../../types';

function confirmedMrpFromScan(scanResult: ScanResult | null | undefined): number | null {
  const raw = scanResult?.confirmedMrp;
  if (raw == null || !Number.isFinite(Number(raw))) return null;
  const n = Number(raw);
  return n >= 0 ? n : null;
}

function shouldSyncLabelMrpAfterTransition(input: PickItemTransition): boolean {
  return input.kind === 'picked' || input.kind === 'flagged';
}

export type PickItemTransition =
  | {
      kind: 'picked';
      itemId: number;
      scanResult?: ScanResult | null;
    }
  | {
      kind: 'scan_saved';
      itemId: number;
      scanResult: ScanResult;
    }
  | {
      kind: 'flagged';
      itemId: number;
      reason: FlagReason;
      notes: string | null;
      boxPrice: number | null;
      scanResult?: ScanResult | null;
    };

export interface PickTransitionResult {
  success: boolean;
  qtyAdded: number;
  remainingQty: number | null;
  lineComplete: boolean;
  requiresBreakConfirmation: boolean;
}

export interface PickItemTransitionAdapter {
  applyTransition(input: PickItemTransition): Promise<PickTransitionResult>;
}

export type PickTransitionBackendMode = 'direct_order_items' | 'rpc_scan_ledger';

function toUpdatePayload(input: PickItemTransition): Record<string, unknown> {
  switch (input.kind) {
    case 'picked': {
      const confirmed = confirmedMrpFromScan(input.scanResult);
      const billMrp = confirmed != null ? Math.round(confirmed) : null;
      return {
        state: 'picked',
        scan_result: (input.scanResult ?? null) as unknown as Record<string, unknown> | null,
        ...(confirmed != null ? { confirmed_mrp: confirmed } : {}),
        ...(billMrp != null ? { price_quoted: billMrp } : {}),
      };
    }
    case 'scan_saved': {
      const confirmed = confirmedMrpFromScan(input.scanResult);
      return {
        scan_result: input.scanResult as unknown as Record<string, unknown>,
        ...(confirmed != null ? { confirmed_mrp: confirmed } : {}),
      };
    }
    case 'flagged': {
      const confirmed = confirmedMrpFromScan(input.scanResult);
      const billMrp = confirmed != null ? Math.round(confirmed) : null;
      return {
        state: 'flagged',
        flag_reason: input.reason,
        flag_notes: input.notes,
        flag_box_price: input.boxPrice,
        scan_result: (input.scanResult ?? null) as unknown as Record<string, unknown> | null,
        ...(confirmed != null ? { confirmed_mrp: confirmed } : {}),
        ...(billMrp != null ? { price_quoted: billMrp } : {}),
      };
    }
  }
}

class SupabasePickItemTransitionAdapter implements PickItemTransitionAdapter {
  async applyTransition(input: PickItemTransition): Promise<PickTransitionResult> {
    const { error } = await supabase
      .from('order_items')
      .update(toUpdatePayload(input))
      .eq('id', input.itemId);
    if (error) throw error;

    if (shouldSyncLabelMrpAfterTransition(input)) {
      await syncLabelMrpFlagForOrderItem(input.itemId);
      await recordPickerLabelMrpForOrderItem(input.itemId);
    }

    return {
      success: true,
      qtyAdded: input.kind === 'picked' ? 1 : 0,
      remainingQty: null,
      lineComplete: input.kind === 'picked',
      requiresBreakConfirmation: false,
    };
  }
}

function resolveBackendMode(): PickTransitionBackendMode {
  const raw = (import.meta.env.VITE_PICK_TRANSITION_MODE ?? '')
    .trim()
    .toLowerCase();
  return raw === 'rpc_scan_ledger'
    ? 'rpc_scan_ledger'
    : 'direct_order_items';
}

export const PICK_TRANSITION_BACKEND_MODE = resolveBackendMode();

export const defaultPickItemTransitionAdapter: PickItemTransitionAdapter =
  new SupabasePickItemTransitionAdapter();

/** Lab / UX sandbox — local UI only, never writes order_items. */
export const sandboxPickItemTransitionAdapter: PickItemTransitionAdapter = {
  async applyTransition(): Promise<PickTransitionResult> {
    return {
      success: true,
      qtyAdded: 0,
      remainingQty: null,
      lineComplete: false,
      requiresBreakConfirmation: false,
    };
  },
};
