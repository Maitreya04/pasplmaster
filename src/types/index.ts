export interface Item {
  id: number;
  name: string;
  alias: string | null;
  alias1: string | null;
  busy_code?: number | null;
  parent_group: string | null;
  main_group: string | null;
  item_category: string | null;
  gst_percent?: number;
  hsn_code?: string | null;
  sales_price: number;
  mrp?: number;
  stock_qty: number;
  rack_no: string | null;
  is_active?: boolean;
}

export interface Customer {
  id: number;
  name: string;
  address: string | null;
  mobile: string | null;
  parent_group: string | null;
  city: string | null;
  salesman: string | null;
  gstin: string | null;
  dealer_type: string | null;
  is_active: boolean;
}

export interface Transport {
  id: number;
  name: string;
  is_active: boolean;
}

export type WorkflowStatus =
  | 'submitted'
  | 'approved'
  | 'picking'
  | 'completed'
  | 'rejected'
  | 'flagged';

/** @deprecated Use WorkflowStatus instead */
export type OrderStatus = WorkflowStatus;
export type OrderPriority = 'normal' | 'urgent';
export type OrderItemState = 'pending' | 'picked' | 'flagged';

export interface Order {
  id: number;
  order_number: string;
  order_kind?: 'standard' | 'recovery';
  customer_id: number;
  customer_name: string;
  customer_mobile?: string | null;
  customer_city: string | null;
  customer_address?: string | null;
  transport_id: number | null;
  transport_name: string | null;
  salesperson_name: string;
  salesperson_user_id?: number | null;
  stock_location_code?: StockLocationCode | null;
  reviewer_name: string | null;
  picker_name: string | null;
  workflow_status: WorkflowStatus;
  priority: OrderPriority;
  notes: string | null;
  /** Busy “items”: number of invoice rows (distinct order_lines), not sum of qty. Prefer live count from order_items when available. */
  item_count: number;
  /** Lines whose catalog or line text resolves to ASK (see `isAskLine`). Set when loading queue embeds. */
  ask_line_count?: number;
  total_value: number;
  created_at: string;
  approved_at: string | null;
  picked_at: string | null;
  completed_at: string | null;
  dispatched_at: string | null;
}

export interface OrderItem {
  id: number;
  order_id: number;
  item_id: number;
  item_name: string;
  item_alias: string | null;
  /** From `items` join in useOrderDetail — catalog `alias` at read time. */
  catalog_alias?: string | null;
  /** From `items` join — same as New Order search primary code (`alias1`). */
  catalog_alias1?: string | null;
  /** From `items` join — Busy main group (often brand). */
  catalog_main_group?: string | null;
  /** From `items` join — Busy parent group. */
  catalog_parent_group?: string | null;
  rack_no: string | null;
  qty_requested: number;
  /** Units to pick from on-hand stock (≤ qty_requested). Omitted on legacy rows. */
  qty_shippable?: number;
  /** PO / back-order qty. Omitted on legacy rows. */
  qty_po?: number;
  qty_approved: number | null;
  stock_location_code?: StockLocationCode | null;
  price_quoted: number | null;
  price_system: number | null;
  state: OrderItemState;
  flag_reason: string | null;
  flag_notes: string | null;
  flag_box_price: number | null;
  scan_result: ScanResult | null;
}

export type PendingItemStatus = 'pending' | 'resolved' | 'cancelled';
export type PendingRecoveryStatus =
  | 'waiting_stock'
  | 'back_in_stock'
  | 'needs_checked'
  | 'reviewed';

export type PendingRecoveryResponse = 'confirmed' | 'not_now' | 'declined';

export interface PendingItem {
  id: number;
  order_id: number;
  order_number: string;
  customer_id: number | null;
  customer_name: string;
  item_id: number | null;
  item_name: string;
  qty_pending: number;
  source: 'billing' | 'picking' | 'sales';
  created_by: string | null;
  created_at: string;
  note: string | null;
  status: PendingItemStatus;
  recovery_status: PendingRecoveryStatus;
  back_in_stock_at: string | null;
  contacted_at?: string | null;
  contacted_by?: string | null;
  contacted_by_user_id?: number | null;
  customer_response?: PendingRecoveryResponse | null;
  recovery_order_id?: number | null;
  recovery_reviewed_at: string | null;
  recovery_reviewed_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  stock_location_code?: StockLocationCode | null;
}

export interface ScanSignal {
  signal: string;
  score: number;
  maxScore: number;
  detail: string;
}

export interface ScanResult {
  scannedText: string;
  confidence: number;
  isMatch: boolean;
  matchedAgainst: string;
  matchStrategy: string;
  ocrExtracted: {
    partNumber: string | null;
    mrp: number | null;
    brand?: string | null;
    vehicleModel?: string | null;
  };
  signals?: ScanSignal[];
  method?: 'local_match' | 'ai_verify' | 'manual' | 'qr_scan';
  timestamp: string;
  extractedCode?: string;
  extractedDescription?: string;
  reason?: string;
  codeType?: 'rack' | 'pack' | 'lpn' | 'sku' | 'unknown';
  suggestedQty?: number;
  requiresBreakConfirmation?: boolean;
  lpnCode?: string | null;
  progress?: {
    pickedQty: number;
    remainingQty: number;
    targetQty: number;
  };
  packAssist?: {
    packType: 'inner' | 'outer';
    packQty: number;
    suggestedQty: number;
    requiresBreakConfirmation: boolean;
    busyCode: number;
  };
  operatorContext?: {
    pickerName: string | null;
    pickerUserId: number | null;
    source: 'manual' | 'scanner';
  };
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

export interface CartItem {
  lineId: string;
  item: Item;
  qty: number;
  specialRate: number | null;
}

export interface AuthState {
  isAuthenticated: boolean;
  role: 'sales' | 'billing' | 'picking' | 'admin' | null;
  userName: string | null;
  userId: number | null;
}

// ─── Work Claims System Types ───────────────────────────────

export type UserRole = 'sales' | 'billing' | 'picking' | 'admin';
export type StockLocationCode = 'main_store' | 'jabalpur';
export type NotificationEventType =
  | 'order_ready_to_pick'
  | 'pending_item_back_in_stock'
  | 'pending_item_ready_for_billing';

export interface AppUser {
  id: number;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  station_label: string | null;
  stock_location_code?: StockLocationCode | null;
  created_at: string;
}

export type ClaimStatus = 'active' | 'released' | 'completed' | 'expired';
export type ClaimStage = 'billing' | 'picking';

export interface WorkClaim {
  id: number;
  order_id: number;
  stage: ClaimStage;
  claimed_by_user_id: number;
  claimed_at: string;
  last_heartbeat_at: string;
  released_at: string | null;
  completed_at: string | null;
  status: ClaimStatus;
  claim_version: number;
  /** Joined from users table — available when fetched with useClaimableOrders */
  claimed_by_name?: string;
}

export interface OrderEvent {
  id: number;
  order_id: number;
  event_type: string;
  actor_user_id: number | null;
  stage: ClaimStage | null;
  payload: Record<string, unknown>;
  created_at: string;
}

/** Order enriched with its active claim info (used by queue views) */
export interface OrderWithClaim extends Order {
  active_claim?: WorkClaim | null;
}

export interface PushSubscriptionRecord {
  id: number;
  user_id: number | null;
  user_name: string | null;
  role: UserRole;
  device_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  enabled: boolean;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface PushCapabilityState {
  supported: boolean;
  standalone: boolean;
  permission: NotificationPermission;
  enabled: boolean;
  loading: boolean;
  error: string | null;
}

export interface ItemPackDefinition {
  busy_code: number;
  item_id_snapshot: number | null;
  item_name_snapshot: string;
  inner_pack_qty: number | null;
  outer_pack_qty: number | null;
  source_file: string | null;
  updated_at: string;
}

export interface LicensePlateBatch {
  id: number;
  batch_code: string;
  created_by_user_id: number | null;
  created_by_name: string | null;
  created_at?: string;
  printed_at?: string | null;
}

export type LicensePlatePackType = 'inner' | 'outer';
export type LicensePlateStatus = 'available' | 'opened' | 'depleted' | 'voided';

export interface LicensePlate {
  id?: number;
  lpn_code: string;
  batch_id: number | null;
  parent_lp_id?: number | null;
  batch_code?: string;
  busy_code: number;
  item_id_snapshot: number | null;
  item_name_snapshot: string;
  pack_type: LicensePlatePackType;
  pack_qty: number;
  remaining_qty: number;
  status: LicensePlateStatus;
  created_at?: string;
  printed_at?: string | null;
  opened_at?: string | null;
  depleted_at?: string | null;
  voided_at?: string | null;
}

export type PickScanKind = 'sku' | 'lpn' | 'pack' | 'manual';
export type PickScanConsumption = 'full' | 'partial' | 'adjustment';

export interface OrderItemPickScan {
  id: number;
  order_id: number;
  order_item_id: number;
  busy_code: number | null;
  scan_kind: PickScanKind;
  consumption: PickScanConsumption;
  lpn_id: number | null;
  qty_delta: number;
  qr_payload: string | null;
  bin_id?: string | null;
  reason: string | null;
  picker_user_id: number | null;
  claim_id: number | null;
  created_at: string;
}

export type BinInventoryStatus = 'healthy' | 'low' | 'empty' | 'pending_review' | 'inactive';
export type BinCountType = 'initial_setup' | 'cycle_count' | 'adjustment';
export type BinCountStatus = 'auto_approved' | 'pending_review' | 'approved' | 'rejected';

export interface BinInventory {
  bin_id: string;
  sku_busy_code: number;
  item_id_snapshot: number | null;
  item_name_snapshot: string | null;
  inner_packs: number;
  loose_ea_qty: number;
  inner_pack_qty: number;
  total_qty: number;
  reorder_point: number | null;
  daily_target: number | null;
  status: BinInventoryStatus;
  last_counted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BinCountLog {
  id: number;
  bin_id: string;
  count_type: BinCountType;
  sku_busy_code: number;
  item_id_snapshot: number | null;
  item_name_snapshot: string | null;
  expected_inner_packs: number;
  expected_loose_ea_qty: number;
  counted_inner_packs: number;
  counted_loose_ea_qty: number;
  inner_pack_qty: number;
  variance_inner_packs: number;
  variance_loose_ea_qty: number;
  status: BinCountStatus;
  note: string | null;
  source_file: string | null;
  created_by_user_id: number | null;
  created_by_name: string | null;
  reviewed_by_user_id: number | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

export interface PickerPushPayload {
  type: NotificationEventType;
  orderId: number;
  orderNumber: string;
  customerName: string;
  priority: OrderPriority;
  url: string;
  approvedAt: string | null;
}

/** In-app notification row (see `user_notifications` table) */
export interface UserNotification {
  id: number;
  user_id: number;
  title: string;
  body: string;
  type: string;
  order_id: number | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface BillingCustomerUpdateLineSummary {
  item_id: number | null;
  item_name: string;
  qty_requested: number;
  qty_billed: number;
  qty_pending: number;
  classification: 'billed' | 'partial' | 'pending';
}

export interface BillingCustomerUpdateSummary {
  order_number: string;
  customer_name: string;
  message_type: 'billed_pending_blocks';
  lines: BillingCustomerUpdateLineSummary[];
}

export interface BillingCustomerUpdate {
  id: number;
  order_id: number;
  message_text: string;
  summary_json: BillingCustomerUpdateSummary;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
  sent_by_user_id: number | null;
}
