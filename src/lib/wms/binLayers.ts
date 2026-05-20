import { supabase } from '../supabase/client';
import type { BinPickerShelf, OrderItem } from '../../types';
import { deriveBusyCodeCandidates } from '../scanner/deriveBusyCodeCandidates';
import { STAGING_BIN_DEFAULT, isStagingBinId } from './stagingBin';

/** @internal exported for PickPage tests */
export function binIdForPickItem(orderItem: OrderItem, explicitBinId?: string | null): string | null {
  const raw = (explicitBinId ?? orderItem.rack_no ?? '').trim();
  return raw || null;
}

/** Rack gate target: real rack, or staging when SKU has no rack yet. */
export function rackGateBinIdForPickItem(orderItem: OrderItem): string | null {
  const rack = binIdForPickItem(orderItem);
  if (rack) return rack;
  return STAGING_BIN_DEFAULT;
}

export function orderItemUsesStagingOnly(orderItem: OrderItem): boolean {
  return !binIdForPickItem(orderItem);
}

export { isStagingBinId, STAGING_BIN_DEFAULT };

export async function fetchBinPickerShelf(
  binId: string,
  skuBusyCode: number,
): Promise<BinPickerShelf | null> {
  const { data, error } = await supabase.rpc('wms_get_bin_picker_shelf', {
    p_bin_id: binId,
    p_sku_busy_code: skuBusyCode,
  });
  if (error) throw error;
  const o = data as {
    success?: boolean;
    total_ea?: number;
    layers?: BinPickerShelf['layers'];
    bin_id?: string;
    sku_busy_code?: number;
  };
  if (!o?.success) return null;
  const rawLayers = Array.isArray(o.layers) ? (o.layers as unknown[]) : [];
  const layers: BinPickerShelf['layers'] = rawLayers.map((row) => {
    const r = row as Record<string, unknown>;
    return {
    id: Number(r.id),
    mrp_per_ea: Number(r.mrp_per_ea),
    qty_ea: Number(r.qty_ea),
    fifo_received_at: String(r.fifo_received_at ?? ''),
    is_fifo_recommended: Boolean(r.is_fifo_recommended),
    lot_no: r.lot_no != null ? String(r.lot_no) : null,
  };
  });
  return {
    bin_id: o.bin_id ?? binId,
    sku_busy_code: Number(o.sku_busy_code ?? skuBusyCode),
    total_ea: Number(o.total_ea ?? 0),
    layers,
  };
}

export type ConsumeBinLayerRpcResult =
  | { success: true; events?: unknown; bin_id?: string }
  | {
      success: false;
      reason: string;
      fifo_head_layer_id?: number;
      short_by?: number;
    };

export async function consumeBinLayerForPick(input: {
  orderItemId: number;
  qtyEa: number;
  userId: number | null;
  binId?: string | null;
  preferredLayerId?: number | null;
  overrideReason?: string | null;
  orderItemPickScanId?: number | null;
}): Promise<ConsumeBinLayerRpcResult> {
  const { data, error } = await supabase.rpc('wms_consume_bin_layer_for_pick', {
    p_order_item_id: input.orderItemId,
    p_qty_ea: input.qtyEa,
    p_user_id: input.userId,
    p_preferred_layer_id: input.preferredLayerId ?? null,
    p_override_reason: input.overrideReason ?? null,
    p_bin_id: input.binId ?? null,
    p_order_item_pick_scan_id: input.orderItemPickScanId ?? null,
  });
  if (error) {
    return { success: false, reason: error.message };
  }
  const o = data as ConsumeBinLayerRpcResult & Record<string, unknown>;
  if (o && typeof o === 'object' && o.success === true) {
    return { success: true, events: o.events, bin_id: o.bin_id as string | undefined };
  }
  return {
    success: false,
    reason: String((o as { reason?: string })?.reason ?? 'consume_failed'),
    fifo_head_layer_id: (o as { fifo_head_layer_id?: number }).fifo_head_layer_id,
    short_by: (o as { short_by?: number }).short_by,
  };
}

/** Returns primary catalog busy code for an order line, or null. */
export function primaryBusyCodeForOrderItem(orderItem: OrderItem): number | null {
  const c = deriveBusyCodeCandidates(orderItem);
  return c.length > 0 ? c[0]! : null;
}
