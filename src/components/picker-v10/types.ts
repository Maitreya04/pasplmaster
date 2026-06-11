import type { StockMrpHistoryEntry } from '../../types';

export type VerifyMode = 'scan' | 'type' | 'confirm';

export type PickerV10Phase =
  | 'rack_list'
  | 'identify'
  | 'mrp'
  | 'qty'
  | 'gap'
  | 'item_complete'
  | 'session_summary';

export type PickerV10LineStatus = 'pending' | 'in_progress' | 'done' | 'flagged';

export interface PickerV10LoggedBatch {
  mrp: number;
  qty: number;
  picker_note?: string;
}

export interface PickerV10LineProgress {
  status: PickerV10LineStatus;
  loggedQty: number;
  batches: PickerV10LoggedBatch[];
  flagged?: boolean;
  flagReason?: string;
}

export interface PickerV10Line {
  id: number;
  code: string;
  name: string;
  rack: string | null;
  shelf?: string | null;
  bin?: string | null;
  qty: number;
  uom?: string;
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
  batches?: PickerV10LoggedBatch[];
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
  batches?: PickerV10LoggedBatch[];
  picker_note?: string;
}

/** Lab scenario presets for qty state testing. */
export type PickerV10DemoScenario =
  | 'edge_case_tour'
  | 'default'
  | 'single_pcs'
  | 'pair_over'
  | 'set_partial'
  | 'multi_mrp'
  | 'multi_batch_split'
  | 'extreme_over'
  | 'no_mrp'
  | 'scan_verify';

/** Step-by-step playbook entry for a demo scenario. */
export interface PickerV10ScenarioPlaybook {
  scenario: PickerV10DemoScenario;
  title: string;
  edgeCases: string[];
  steps: string[];
}
