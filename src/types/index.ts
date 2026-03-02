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

export type OrderStatus =
  | 'submitted'
  | 'approved'
  | 'picking'
  | 'completed'
  | 'dispatched'
  | 'flagged';
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
  status: OrderStatus;
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
  qty_approved: number | null;
  price_quoted: number | null;
  price_system: number | null;
  state: OrderItemState;
  flag_reason: string | null;
  flag_notes: string | null;
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
  source: 'billing' | 'picking';
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
  timestamp: string;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

export interface CartItem {
  item: Item;
  qty: number;
  specialRate: number | null;
}

export interface AuthState {
  isAuthenticated: boolean;
  role: 'sales' | 'billing' | 'picking' | 'admin' | null;
  userName: string | null;
}
