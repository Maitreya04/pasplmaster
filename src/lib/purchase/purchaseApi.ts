import { supabase } from '../supabase/client';
import type {
  PurchaseOrderLineRow,
  PurchaseOrderRow,
  SupplierInvoiceLineRow,
  SupplierInvoiceRow,
} from '../../types/purchase';
import type { OpenPoDemandLine } from '../../hooks/useOpenPoDemandLines';

export const PURCHASE_ORDERS_QUERY_KEY = ['purchase', 'orders'] as const;
export const purchaseOrderDetailKey = (id: number) => ['purchase', 'order', id] as const;
export const purchaseOrderLinesKey = (id: number) => ['purchase', 'order', id, 'lines'] as const;

export function aggregateQtyPoByItemId(lines: OpenPoDemandLine[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const l of lines) {
    const id = Number(l.item_id);
    const q = Number(l.qty_po) || 0;
    if (!Number.isFinite(id) || q <= 0) continue;
    m.set(id, (m.get(id) ?? 0) + q);
  }
  return m;
}

/** busy_code -> aggregated open sales PO qty (demand hint). */
export async function fetchSuggestedQtyByBusyCode(
  demandByItemId: Map<number, number>,
): Promise<Map<number, number>> {
  const itemIds = [...demandByItemId.keys()];
  if (itemIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('items')
    .select('id,busy_code')
    .in('id', itemIds)
    .not('busy_code', 'is', null)
    .gt('busy_code', 0);
  if (error) throw error;
  const out = new Map<number, number>();
  for (const row of data ?? []) {
    const itemId = Number((row as { id: number }).id);
    const bc = Number((row as { busy_code: number }).busy_code);
    const q = demandByItemId.get(itemId);
    if (q != null && Number.isFinite(bc)) {
      out.set(bc, (out.get(bc) ?? 0) + q);
    }
  }
  return out;
}

export async function fetchPurchaseOrders(limit = 80): Promise<PurchaseOrderRow[]> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as PurchaseOrderRow[];
}

export async function fetchPurchaseOrder(poId: number): Promise<PurchaseOrderRow | null> {
  const { data, error } = await supabase.from('purchase_orders').select('*').eq('id', poId).maybeSingle();
  if (error) throw error;
  return (data as PurchaseOrderRow) ?? null;
}

export async function fetchPurchaseOrderLines(poId: number): Promise<PurchaseOrderLineRow[]> {
  const { data, error } = await supabase
    .from('purchase_order_lines')
    .select('*')
    .eq('purchase_order_id', poId)
    .order('line_no', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PurchaseOrderLineRow[];
}

export interface CreatePoLineInput {
  busy_code: number;
  description_snapshot: string;
  qty_ordered: number;
  suggested_qty_from_demand?: number | null;
  unit_rate?: number | null;
}

/** Create PO (sent) + PO lines + supplier invoice/lines from OCR-reviewed invoice draft (no prior PO). */
export async function createPurchaseOrderFromInvoiceDraft(args: {
  supplier_name: string;
  invoice_number?: string | null;
  invoice_date?: string | null;
  file_name?: string | null;
  raw_extract_json?: unknown;
  lines: Array<{
    busy_code: number;
    description_snapshot: string;
    qty_billed: number;
    rate_per_ea?: number | null;
    part_no_raw?: string | null;
    description_raw?: string | null;
  }>;
  userId: number | null;
  userName: string | null;
}): Promise<{ purchase_order_id: number; po_number: string; supplier_invoice_id: number }> {
  const supplier = args.supplier_name?.trim();
  if (!supplier) throw new Error('Supplier name is required');

  const normalized = args.lines.filter((l) => Number.isFinite(Number(l.busy_code)) && Number(l.busy_code) > 0);
  if (normalized.length === 0) throw new Error('At least one line with a valid busy code is required');

  const { data: poRow, error: poErr } = await supabase
    .from('purchase_orders')
    .insert({
      supplier_name: supplier,
      source: 'invoice_pdf',
      status: 'sent',
      notes: null,
      created_by_user_id: args.userId,
      created_by_name: args.userName,
    })
    .select('id,po_number')
    .single();
  if (poErr) throw poErr;
  const poId = Number((poRow as { id: number }).id);
  const poNumber = String((poRow as { po_number: string }).po_number);

  const poLinePayload = normalized.map((l, i) => {
    const q = Math.max(0, Math.round(Number(l.qty_billed) || 0));
    return {
      purchase_order_id: poId,
      line_no: i + 1,
      busy_code: Number(l.busy_code),
      description_snapshot: (l.description_snapshot?.trim() || `Line ${i + 1}`).slice(0, 2000),
      qty_ordered: q,
      suggested_qty_from_demand: null as number | null,
      unit_rate: l.rate_per_ea != null && Number.isFinite(Number(l.rate_per_ea)) ? Number(l.rate_per_ea) : null,
      qty_received: 0,
      match_status: 'matched' as const,
    };
  });

  const { data: insertedPoLines, error: linesErr } = await supabase
    .from('purchase_order_lines')
    .insert(poLinePayload)
    .select('id,line_no');
  if (linesErr) throw linesErr;
  const poLineRows = (insertedPoLines ?? []) as { id: number; line_no: number }[];
  const poLineIdByLineNo = new Map<number, number>();
  for (const r of poLineRows) {
    poLineIdByLineNo.set(Number(r.line_no), Number(r.id));
  }

  const { data: inv, error: invErr } = await supabase
    .from('supplier_invoices')
    .insert({
      purchase_order_id: poId,
      invoice_number: args.invoice_number?.trim() || null,
      invoice_date: args.invoice_date || null,
      status: 'reviewed',
      file_name: args.file_name ?? null,
      raw_extract_json: args.raw_extract_json ?? null,
      extracted_at: new Date().toISOString(),
      created_by_user_id: args.userId,
      created_by_name: args.userName,
    })
    .select('id')
    .single();
  if (invErr) throw invErr;
  const invoiceId = Number((inv as { id: number }).id);

  const invoiceLineRows = normalized.map((l, i) => {
    const lineNo = i + 1;
    const poLineId = poLineIdByLineNo.get(lineNo) ?? null;
    return {
      supplier_invoice_id: invoiceId,
      line_no: lineNo,
      part_no_raw: l.part_no_raw?.trim() || null,
      description_raw: l.description_raw?.trim() || null,
      qty_billed: Math.max(0, Number(l.qty_billed) || 0),
      rate_per_ea: l.rate_per_ea != null && Number.isFinite(Number(l.rate_per_ea)) ? Number(l.rate_per_ea) : null,
      busy_code: Number(l.busy_code),
      purchase_order_line_id: poLineId,
      match_status: 'matched' as const,
      review_note: null as string | null,
    };
  });

  const { error: invLinesErr } = await supabase.from('supplier_invoice_lines').insert(invoiceLineRows);
  if (invLinesErr) throw invLinesErr;

  return { purchase_order_id: poId, po_number: poNumber, supplier_invoice_id: invoiceId };
}

export async function createPurchaseOrderWithLines(args: {
  supplier_name?: string | null;
  source: 'excel_upload' | 'manual';
  notes?: string | null;
  lines: CreatePoLineInput[];
  userId: number | null;
  userName: string | null;
}): Promise<{ purchase_order_id: number; po_number: string }> {
  const { data: poRow, error: poErr } = await supabase
    .from('purchase_orders')
    .insert({
      supplier_name: args.supplier_name?.trim() || null,
      source: args.source,
      notes: args.notes?.trim() || null,
      status: 'draft',
      created_by_user_id: args.userId,
      created_by_name: args.userName,
    })
    .select('id,po_number')
    .single();
  if (poErr) throw poErr;
  const poId = Number((poRow as { id: number }).id);
  const poNumber = String((poRow as { po_number: string }).po_number);

  const lineRows = args.lines.map((l, i) => ({
    purchase_order_id: poId,
    line_no: i + 1,
    busy_code: l.busy_code,
    description_snapshot: l.description_snapshot,
    qty_ordered: l.qty_ordered,
    suggested_qty_from_demand: l.suggested_qty_from_demand ?? null,
    unit_rate: l.unit_rate ?? null,
    qty_received: 0,
    match_status: 'pending' as const,
  }));

  const { error: linesErr } = await supabase.from('purchase_order_lines').insert(lineRows);
  if (linesErr) throw linesErr;

  return { purchase_order_id: poId, po_number: poNumber };
}

export async function markPurchaseOrderSent(poId: number): Promise<void> {
  const { error } = await supabase.from('purchase_orders').update({ status: 'sent' }).eq('id', poId);
  if (error) throw error;
}

export async function updatePurchaseOrderNotes(poId: number, notes: string | null): Promise<void> {
  const { error } = await supabase.from('purchase_orders').update({ notes }).eq('id', poId);
  if (error) throw error;
}

export async function updatePurchaseOrderSupplier(poId: number, supplier_name: string | null): Promise<void> {
  const { error } = await supabase.from('purchase_orders').update({ supplier_name }).eq('id', poId);
  if (error) throw error;
}

export interface DraftInvoiceLineInput {
  line_no: number;
  part_no_raw?: string | null;
  description_raw?: string | null;
  qty_billed: number;
  rate_per_ea?: number | null;
  busy_code?: number | null;
  purchase_order_line_id?: number | null;
  match_status?: string;
  review_note?: string | null;
}

export async function saveSupplierInvoiceDraft(args: {
  purchase_order_id: number;
  invoice_number?: string | null;
  invoice_date?: string | null;
  file_name?: string | null;
  raw_extract_json?: unknown;
  lines: DraftInvoiceLineInput[];
  userId: number | null;
  userName: string | null;
}): Promise<{ supplier_invoice_id: number }> {
  const { data: inv, error: invErr } = await supabase
    .from('supplier_invoices')
    .insert({
      purchase_order_id: args.purchase_order_id,
      invoice_number: args.invoice_number?.trim() || null,
      invoice_date: args.invoice_date || null,
      status: 'reviewed',
      file_name: args.file_name ?? null,
      raw_extract_json: args.raw_extract_json ?? null,
      extracted_at: new Date().toISOString(),
      created_by_user_id: args.userId,
      created_by_name: args.userName,
    })
    .select('id')
    .single();
  if (invErr) throw invErr;
  const invoiceId = Number((inv as { id: number }).id);

  const lineRows = args.lines.map((l) => ({
    supplier_invoice_id: invoiceId,
    line_no: l.line_no,
    part_no_raw: l.part_no_raw ?? null,
    description_raw: l.description_raw ?? null,
    qty_billed: l.qty_billed,
    rate_per_ea: l.rate_per_ea ?? null,
    busy_code: l.busy_code ?? null,
    purchase_order_line_id: l.purchase_order_line_id ?? null,
    match_status: (l.match_status ?? 'pending') as string,
    review_note: l.review_note ?? null,
  }));

  const { error: lineErr } = await supabase.from('supplier_invoice_lines').insert(lineRows);
  if (lineErr) throw lineErr;

  for (const l of args.lines) {
    if (l.purchase_order_line_id != null && l.rate_per_ea != null && Number(l.rate_per_ea) > 0) {
      await supabase
        .from('purchase_order_lines')
        .update({ unit_rate: l.rate_per_ea })
        .eq('id', l.purchase_order_line_id);
    }
  }

  return { supplier_invoice_id: invoiceId };
}

export async function fetchLatestSupplierInvoiceForPo(poId: number): Promise<SupplierInvoiceRow | null> {
  const { data, error } = await supabase
    .from('supplier_invoices')
    .select('*')
    .eq('purchase_order_id', poId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as SupplierInvoiceRow) ?? null;
}

export async function fetchSupplierInvoiceLines(invoiceId: number): Promise<SupplierInvoiceLineRow[]> {
  const { data, error } = await supabase
    .from('supplier_invoice_lines')
    .select('*')
    .eq('supplier_invoice_id', invoiceId)
    .order('line_no', { ascending: true });
  if (error) throw error;
  return (data ?? []) as SupplierInvoiceLineRow[];
}

export async function createReceivingJobFromInvoice(
  supplierInvoiceId: number,
  userId: number | null,
  userName: string | null,
): Promise<{
  receiving_job_id: number;
  job_public_id: string;
  envelope_code: string;
  lines_inserted: number;
}> {
  const { data, error } = await supabase.rpc('create_receiving_job_from_invoice', {
    p_supplier_invoice_id: supplierInvoiceId,
    p_user_id: userId,
    p_user_name: userName,
  });
  if (error) throw error;
  const o = data as {
    success?: boolean;
    receiving_job_id?: number;
    job_public_id?: string;
    envelope_code?: string;
    lines_inserted?: number;
    reason?: string;
  };
  if (!o.success || !o.receiving_job_id || !o.job_public_id || !o.envelope_code) {
    throw new Error(o.reason ?? 'create_receiving_job_from_invoice failed');
  }
  return {
    receiving_job_id: o.receiving_job_id,
    job_public_id: o.job_public_id,
    envelope_code: o.envelope_code,
    lines_inserted: o.lines_inserted ?? 0,
  };
}

export const RECEIVING_HUB_POS_QUERY_KEY = ['purchase', 'receiving-hub', 'sent-pos'] as const;

export interface PurchaseOrderHubLine {
  line_no: number;
  busy_code: number;
  description_snapshot: string;
  qty_ordered: number;
  unit_rate: number | null;
}

export interface PurchaseOrderReceivingHubCard {
  po: PurchaseOrderRow;
  lines: PurchaseOrderHubLine[];
  skuCount: number;
  totalPieces: number;
  estimatedValue: number | null;
}

/** Sent POs with no receiving job yet — warehouse hub "expected" cards. */
export async function fetchSentPurchaseOrdersForReceivingHub(): Promise<PurchaseOrderReceivingHubCard[]> {
  const { data: pos, error: poErr } = await supabase
    .from('purchase_orders')
    .select('*')
    .eq('status', 'sent')
    .order('created_at', { ascending: false })
    .limit(40);
  if (poErr) throw poErr;
  const sent = (pos ?? []) as PurchaseOrderRow[];
  if (sent.length === 0) return [];

  const poIds = sent.map((p) => p.id);
  const { data: jobs, error: jobErr } = await supabase
    .from('receiving_jobs')
    .select('purchase_order_id')
    .in('purchase_order_id', poIds);
  if (jobErr) throw jobErr;
  const withJob = new Set(
    (jobs ?? [])
      .map((j) => (j as { purchase_order_id: number | null }).purchase_order_id)
      .filter((id): id is number => id != null),
  );

  const pending = sent.filter((p) => !withJob.has(p.id));
  if (pending.length === 0) return [];

  const { data: allLines, error: lineErr } = await supabase
    .from('purchase_order_lines')
    .select('purchase_order_id,line_no,busy_code,description_snapshot,qty_ordered,unit_rate')
    .in('purchase_order_id', pending.map((p) => p.id))
    .order('line_no', { ascending: true });
  if (lineErr) throw lineErr;

  const linesByPo = new Map<number, PurchaseOrderHubLine[]>();
  for (const row of allLines ?? []) {
    const r = row as PurchaseOrderHubLine & { purchase_order_id: number };
    const poId = r.purchase_order_id;
    if (!linesByPo.has(poId)) linesByPo.set(poId, []);
    linesByPo.get(poId)!.push({
      line_no: r.line_no,
      busy_code: r.busy_code,
      description_snapshot: r.description_snapshot,
      qty_ordered: r.qty_ordered,
      unit_rate: r.unit_rate,
    });
  }

  return pending.map((po) => {
    const lines = linesByPo.get(po.id) ?? [];
    let estimatedValue: number | null = 0;
    let hasRate = false;
    for (const l of lines) {
      if (l.unit_rate != null && l.unit_rate > 0) {
        hasRate = true;
        estimatedValue! += l.qty_ordered * l.unit_rate;
      }
    }
    const totalPieces = lines.reduce((s, l) => s + (Number(l.qty_ordered) || 0), 0);
    return {
      po,
      lines,
      skuCount: lines.length,
      totalPieces,
      estimatedValue: hasRate ? estimatedValue : null,
    };
  });
}

export async function createReceivingJobFromPurchaseOrder(
  purchaseOrderId: number,
  userId: number | null,
  userName: string | null,
): Promise<{
  receiving_job_id: number;
  job_public_id: string;
  envelope_code: string;
  lines_inserted: number;
}> {
  const { data, error } = await supabase.rpc('create_receiving_job_from_purchase_order', {
    p_purchase_order_id: purchaseOrderId,
    p_user_id: userId,
    p_user_name: userName,
  });
  if (error) throw error;
  const o = data as {
    success?: boolean;
    receiving_job_id?: number;
    job_public_id?: string;
    envelope_code?: string;
    lines_inserted?: number;
    reason?: string;
  };
  if (!o.success || !o.receiving_job_id || !o.job_public_id || !o.envelope_code) {
    throw new Error(o.reason ?? 'create_receiving_job_from_purchase_order failed');
  }
  return {
    receiving_job_id: o.receiving_job_id,
    job_public_id: o.job_public_id,
    envelope_code: o.envelope_code,
    lines_inserted: o.lines_inserted ?? 0,
  };
}
