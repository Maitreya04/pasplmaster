import { supabase } from '../supabase/client';
import type { FlagReason } from '../../utils/constants';
import type { ScanResult } from '../../types';

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
    case 'picked':
      return {
        state: 'picked',
        scan_result: (input.scanResult ?? null) as unknown as Record<string, unknown> | null,
      };
    case 'scan_saved':
      return {
        scan_result: input.scanResult as unknown as Record<string, unknown>,
      };
    case 'flagged':
      return {
        state: 'flagged',
        flag_reason: input.reason,
        flag_notes: input.notes,
        flag_box_price: input.boxPrice,
        scan_result: (input.scanResult ?? null) as unknown as Record<string, unknown> | null,
      };
  }
}

class SupabasePickItemTransitionAdapter implements PickItemTransitionAdapter {
  async applyTransition(input: PickItemTransition): Promise<PickTransitionResult> {
    const { error } = await supabase
      .from('order_items')
      .update(toUpdatePayload(input))
      .eq('id', input.itemId);
    if (error) throw error;

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
