import type { FulfillmentPath, StockLocationCode } from '../../types';

export function defaultFulfillmentPath(
  stockLocationCode: StockLocationCode | null | undefined,
  pickLineCount?: number | null,
): FulfillmentPath {
  if (stockLocationCode === 'jabalpur') return 'direct_bill';
  if (pickLineCount != null && pickLineCount <= 0) return 'direct_bill';
  return 'warehouse_pick';
}

export function canChooseWarehousePick(
  stockLocationCode: StockLocationCode | null | undefined,
  pickLineCount?: number | null,
): boolean {
  if (stockLocationCode === 'jabalpur') return false;
  if (pickLineCount != null && pickLineCount <= 0) return false;
  return true;
}

export function fulfillmentPathLabel(path: FulfillmentPath): string {
  return path === 'warehouse_pick' ? 'Send to pick' : 'Direct bill';
}

export function fulfillmentPathDescription(
  path: FulfillmentPath,
  stockLocationCode: StockLocationCode | null | undefined,
): string {
  if (path === 'warehouse_pick') {
    return stockLocationCode === 'jabalpur'
      ? 'Warehouse will pick (unusual for Jabalpur).'
      : 'Indore warehouse will pick from racks.';
  }
  return stockLocationCode === 'jabalpur'
    ? 'Bill in Busy only — Jabalpur stock, no Indore pick queue.'
    : 'Skip warehouse pick — bill in Busy only.';
}

export function shouldNotifyPickers(path: FulfillmentPath): boolean {
  return path === 'warehouse_pick';
}
