/** Supplier purchase orders & invoices (PASPL). */

export type PurchaseOrderStatus = 'draft' | 'sent' | 'partially_received' | 'closed' | 'cancelled';

export type PurchaseOrderSource = 'excel_upload' | 'manual' | 'invoice_pdf';

export type PurchaseLineMatchStatus = 'pending' | 'matched' | 'short' | 'over';

export type SupplierInvoiceStatus = 'draft' | 'reviewed' | 'matched' | 'discrepancy';

export interface PurchaseOrderRow {
  id: number;
  po_number: string;
  supplier_name: string | null;
  status: PurchaseOrderStatus;
  source: PurchaseOrderSource;
  notes: string | null;
  created_at: string;
  created_by_user_id: number | null;
  created_by_name: string | null;
}

export interface PurchaseOrderLineRow {
  id: number;
  purchase_order_id: number;
  line_no: number;
  busy_code: number;
  description_snapshot: string;
  qty_ordered: number;
  qty_received: number;
  suggested_qty_from_demand: number | null;
  unit_rate: number | null;
  match_status: PurchaseLineMatchStatus;
}

export interface SupplierInvoiceRow {
  id: number;
  purchase_order_id: number;
  invoice_number: string | null;
  invoice_date: string | null;
  status: SupplierInvoiceStatus;
  storage_path: string | null;
  file_name: string | null;
  extracted_at: string | null;
  raw_extract_json: unknown;
  created_at: string;
  created_by_user_id: number | null;
  created_by_name: string | null;
}

export interface SupplierInvoiceLineRow {
  id: number;
  supplier_invoice_id: number;
  line_no: number;
  part_no_raw: string | null;
  description_raw: string | null;
  qty_billed: number;
  rate_per_ea: number | null;
  busy_code: number | null;
  purchase_order_line_id: number | null;
  match_status: PurchaseLineMatchStatus;
  review_note: string | null;
}
