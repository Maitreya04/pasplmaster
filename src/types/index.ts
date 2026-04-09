export interface Item {
  id: number;
  name: string;
  alias: string | null;
  alias1: string | null;
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
  customer_id: number;
  customer_name: string;
  customer_city: string | null;
  transport_id: number | null;
  transport_name: string | null;
  salesperson_name: string;
  reviewer_name: string | null;
  picker_name: string | null;
  workflow_status: WorkflowStatus;
  priority: OrderPriority;
  notes: string | null;
  item_count: number;
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
  rack_no: string | null;
  qty_requested: number;
  /** Units to pick from on-hand stock (≤ qty_requested). Omitted on legacy rows. */
  qty_shippable?: number;
  /** PO / back-order qty. Omitted on legacy rows. */
  qty_po?: number;
  qty_approved: number | null;
  price_quoted: number | null;
  price_system: number | null;
  state: OrderItemState;
  flag_reason: string | null;
  flag_notes: string | null;
  flag_box_price: number | null;
  scan_result: ScanResult | null;
}

export type PendingItemStatus = 'pending' | 'resolved' | 'cancelled';

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
  resolved_at: string | null;
  resolved_by: string | null;
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
  method?: 'local_match' | 'ai_verify' | 'manual';
  timestamp: string;
  extractedCode?: string;
  extractedDescription?: string;
  reason?: string;
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
export type NotificationEventType = 'order_ready_to_pick';

export interface AppUser {
  id: number;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  station_label: string | null;
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
