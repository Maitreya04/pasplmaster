export type OfflineSalesOrderStatus =
  | 'queued'
  | 'syncing'
  | 'synced'
  | 'partial'
  | 'no_stock'
  | 'failed';

export interface SalesOrderSubmitLineResult {
  name: string;
  qty_requested: number;
  qty_ship: number;
  qty_po: number;
  qty_skipped?: number;
  is_foc?: boolean;
}

export interface SalesOrderSubmitResult {
  success?: boolean;
  error?: string;
  detail?: string;
  order_id?: number | null;
  order_number?: string | null;
  offline_outcome?: 'submitted' | 'partial' | 'no_billable_lines';
  shortage_count?: number;
  shortage_qty?: number;
  lines?: SalesOrderSubmitLineResult[];
}

export function offlineOrderStatusFromResult(
  result: SalesOrderSubmitResult,
): OfflineSalesOrderStatus {
  if (result.offline_outcome === 'no_billable_lines' || !result.order_number) {
    return 'no_stock';
  }
  if (result.offline_outcome === 'partial' || (result.shortage_qty ?? 0) > 0) {
    return 'partial';
  }
  return 'synced';
}
