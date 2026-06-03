import type { OrderItem, SalesLineUnit } from '../../../types';
import type { DeskOrderRow } from '../../../hooks/useBillingDeskOrders';

export interface DeskDraftLine {
  id: string;
  itemId: number | null;
  name: string;
  qty: number;
  mrp: number;
  mrpOverridden: boolean;
}

export interface DeskDraftState {
  customerName: string;
  lines: DeskDraftLine[];
  selectedPickerId: number | null;
  orderSeq: number;
}

export type OverlayStep = 'idle' | 'saved' | 'notified';

export interface DeskOverlayTarget {
  order: DeskOrderRow;
  flaggedMode: boolean;
}

export type ChangeReason =
  | 'no_changes'
  | 'out_of_stock'
  | 'qty_adjusted'
  | 'old_stock_rate'
  | 'customer_changed_mind'
  | 'data_correction';

export const CHANGE_REASON_OPTIONS: { value: ChangeReason; label: string }[] = [
  { value: 'no_changes', label: 'No changes — sending as is' },
  { value: 'out_of_stock', label: 'Item out of stock' },
  { value: 'qty_adjusted', label: 'Quantity adjusted' },
  { value: 'old_stock_rate', label: 'Old stock — different rate' },
  { value: 'customer_changed_mind', label: 'Customer changed mind' },
  { value: 'data_correction', label: 'Data entry correction' },
];

export type OverlayLineResolution =
  | 'accept_price'
  | 'keep_quoted'
  | 'removed'
  | 'manual_override';

export interface OverlayLineEdit {
  priceQuoted: number;
  salesUnit: SalesLineUnit;
  removed: boolean;
  priceTouched: boolean;
  /** Set when billing resolves a flagged line via quick action or manual edit. */
  resolution: OverlayLineResolution | null;
}

export interface OverlayEditorState {
  items: OrderItem[];
  edits: Record<number, OverlayLineEdit>;
  reason: ChangeReason;
  pendingRemoveId: number | null;
  step: OverlayStep;
}
