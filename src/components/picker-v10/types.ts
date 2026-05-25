import type { StockMrpHistoryEntry } from '../../types';

export type VerifyMode = 'scan' | 'type' | 'confirm';

export interface PickerV10Line {
  id: number;
  code: string;
  name: string;
  rack: string | null;
  shelf?: string | null;
  bin?: string | null;
  qty: number;
  verifyMode: VerifyMode;
  busyCode?: number | null;
  stockLocationCode?: 'main_store' | 'jabalpur' | null;
  /** When set (demo), skip RPC fetch. */
  mrpHistory?: StockMrpHistoryEntry[];
  orderItemId?: number;
}

export interface PickerV10DoneEntry {
  code: string;
  qty: number;
  confirmedMrp: number | null;
  latestMrp: number | null;
  mrpFlagged: boolean;
  outOfStock: boolean;
  historyCount: number;
}

export type PickerV10Sheet = 'verify' | 'verify-type' | 'mrp-history' | 'qty' | 'flag' | null;

export type PickDockStep = 'verify' | 'mrp' | 'done';

export interface PickerV10PickResult {
  line: PickerV10Line;
  qty: number;
  confirmedMrp: number | null;
  latestMrp: number | null;
  mrpFlagged: boolean;
  outOfStock: boolean;
  mrpSource: 'stock_mrpwise' | 'custom' | 'items_fallback';
  historyCount: number;
}
