/** Receiving / Label Studio aligned types (PASPL). */

export type SupplierCodeStatus = 'MAPPED' | 'UNMAPPED' | 'MULTIPLE';

export type ReceiveMode = 'structured' | 'inner_only' | 'loose';
export type ReceivingTriggeredBy = 'INVOICE' | 'PO' | 'MANUAL_ARRIVAL';
export type QtyBasis = 'CONFIRMED' | 'SPECULATIVE';
export type ReceiveStatus = 'PENDING' | 'MATCHED' | 'SHORT' | 'OVER';
export type SellUnitPaspl = 'EACH' | 'PACK' | 'BOTH';

export type PoVerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'DISCREPANCY';

/** Guided receiving job steps (warehouse UI). */
export type ReceivingWorkflowStep = 'truck' | 'count' | 'mrp' | 'putaway';

export type ReceivingLineStatus =
  | 'blocked_unmapped'
  | 'pending_labels'
  | 'labels_done'
  | 'mrp_missing'
  | 'ready_putaway'
  | 'putaway_done';

export interface ReceivingJobRow {
  id: number;
  job_public_id: string | null;
  envelope_code: string | null;
  triggered_by: ReceivingTriggeredBy;
  source_ref: string;
  qty_basis: QtyBasis;
  receive_status: ReceiveStatus;
  po_ref: string | null;
  asn_ref: string | null;
  purchase_order_id?: number | null;
  supplier_invoice_id?: number | null;
  dock_arrived_at?: string | null;
  dock_note?: string | null;
  reprint_of_job_id: number | null;
  created_at: string;
  created_by_user_id: number | null;
  created_by_name: string | null;
}

export interface ReceivingJobLineRow {
  id: number;
  receiving_job_id: number;
  line_no: number;
  busy_code: number;
  sku_description_snapshot: string;
  supplier_type_snapshot: string | null;
  supplier_code_resolved: string | null;
  supplier_code_status: SupplierCodeStatus;
  lot_no: string;
  receive_mode: ReceiveMode;
  master_carton_qty: number;
  inner_per_master: number | null;
  inner_pack_count: number;
  ea_per_inner: number;
  total_ea: number;
  ratio_matches_master: boolean | null;
  nominal_outer_qty: number | null;
  nominal_inner_qty: number | null;
  master_labels_count: number;
  inner_labels_count: number;
  each_labels_count: number;
  mrp_per_ea: number | null;
  invoice_rate_per_ea: number | null;
  dock_damage_note: string | null;
  loose_target_bin_id: string | null;
  ratio_verified_at: string | null;
  ratio_verified_by_user_id: number | null;
  ratio_verified_by_name: string | null;
  /** Legacy: set when inner labels print completes; use split timestamps for gate/sort. */
  labels_printed_at: string | null;
  master_labels_printed_at: string | null;
  inner_labels_printed_at: string | null;
  po_verification_status: PoVerificationStatus;
  po_verification_note: string | null;
  po_verified_at: string | null;
  po_verified_by_user_id: number | null;
  po_verified_by_name: string | null;
  sell_unit_snapshot: SellUnitPaspl;
  purchase_order_line_id?: number | null;
  purchase_roll_up_applied_at?: string | null;
  /** PO/invoice ordered qty — reference only; operators confirm total_ea via ratio. */
  po_qty_expected_ea?: number | null;
}

/** Mapper row for resolveSupplier (subset of item_barcodes). */
export interface ItemBarcodeResolveRow {
  barcode_key: string;
  barcode_raw: string;
  sku_busy_code: number;
  manufacturer: string | null;
  mapped_at: string;
}
