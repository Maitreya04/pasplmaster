export type OfflinePickStatus =
  | 'preparing'
  | 'active'
  | 'queued'
  | 'syncing'
  | 'applied'
  | 'conflict'
  | 'failed';

export interface OfflinePickSyncResult {
  success: boolean;
  status: 'applied' | 'already_applied' | 'conflict' | 'failed';
  order_id?: number;
  reason?: string;
  error?: string;
  detail?: string;
  stock_results?: unknown;
}

export function offlinePickStatusFromResult(
  result: OfflinePickSyncResult | null | undefined,
): OfflinePickStatus {
  if (!result) return 'failed';
  if (result.success && (result.status === 'applied' || result.status === 'already_applied')) {
    return 'applied';
  }
  if (result.status === 'conflict') return 'conflict';
  return 'failed';
}
