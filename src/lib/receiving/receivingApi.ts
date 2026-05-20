import { supabase } from '../supabase/client';
import type { ItemBarcodeResolveRow, ReceivingJobLineRow, ReceivingJobRow } from '../../types/receiving';

export const RECEIVING_JOBS_QUERY_KEY = ['receiving', 'jobs'] as const;

export async function fetchBarcodesForBusyCode(busyCode: number): Promise<ItemBarcodeResolveRow[]> {
  const { data, error } = await supabase
    .from('item_barcodes')
    .select('barcode_key,barcode_raw,sku_busy_code,manufacturer,mapped_at')
    .eq('sku_busy_code', busyCode)
    .order('mapped_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as ItemBarcodeResolveRow[];
}

export async function createManualArrivalJob(
  sourceRef: string | undefined,
  userId: number | null,
  userName: string | null,
): Promise<{ receiving_job_id: number; job_public_id: string; envelope_code: string }> {
  const { data, error } = await supabase.rpc('create_receiving_job_manual_arrival', {
    p_source_ref: sourceRef ?? 'WALK-IN',
    p_user_id: userId,
    p_user_name: userName,
  });
  if (error) throw error;
  const o = data as { success?: boolean; receiving_job_id?: number; job_public_id?: string; envelope_code?: string };
  if (!o.success || !o.receiving_job_id || !o.job_public_id || !o.envelope_code) {
    throw new Error('create_receiving_job_manual_arrival failed');
  }
  return {
    receiving_job_id: o.receiving_job_id,
    job_public_id: o.job_public_id,
    envelope_code: o.envelope_code,
  };
}

export async function fetchReceivingJob(jobId: number): Promise<ReceivingJobRow | null> {
  const { data, error } = await supabase.from('receiving_jobs').select('*').eq('id', jobId).maybeSingle();
  if (error) throw error;
  return (data as ReceivingJobRow) ?? null;
}

export async function fetchReceivingJobs(limit = 50): Promise<ReceivingJobRow[]> {
  const { data, error } = await supabase
    .from('receiving_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ReceivingJobRow[];
}

export async function confirmDockArrival(args: {
  jobId: number;
  userId: number | null;
  userName: string | null;
  asnRef?: string | null;
  dockNote?: string | null;
}): Promise<{ success: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc('receiving_confirm_dock_arrival', {
    p_job_id: args.jobId,
    p_user_id: args.userId,
    p_user_name: args.userName,
    p_asn_ref: args.asnRef ?? null,
    p_dock_note: args.dockNote ?? null,
  });
  if (error) throw error;
  return data as { success: boolean; reason?: string };
}

export async function fetchLicensePlatesForJob(jobId: number) {
  const lines = await fetchJobLines(jobId);
  const lineIds = lines.map((l) => l.id);
  if (lineIds.length === 0) return new Map<number, Record<string, unknown>[]>();

  const { data, error } = await supabase
    .from('license_plates')
    .select('id,receiving_job_line_id,receiving_lp_state,receiving_putaway_ea_remaining,pack_qty,pack_type,lpn_code')
    .in('receiving_job_line_id', lineIds);
  if (error) throw error;

  const m = new Map<number, Record<string, unknown>[]>();
  for (const row of data ?? []) {
    const lid = Number((row as { receiving_job_line_id: number }).receiving_job_line_id);
    if (!m.has(lid)) m.set(lid, []);
    m.get(lid)!.push(row as Record<string, unknown>);
  }
  return m;
}

export async function fetchJobLines(jobId: number): Promise<ReceivingJobLineRow[]> {
  const { data, error } = await supabase
    .from('receiving_job_lines')
    .select('*')
    .eq('receiving_job_id', jobId)
    .order('line_no', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ReceivingJobLineRow[];
}

export async function fetchJobLinesForJobIds(jobIds: number[]): Promise<ReceivingJobLineRow[]> {
  if (jobIds.length === 0) return [];
  const { data, error } = await supabase
    .from('receiving_job_lines')
    .select('*')
    .in('receiving_job_id', jobIds)
    .order('line_no', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ReceivingJobLineRow[];
}

export async function fetchLicensePlatesForLine(jobLineId: number) {
  const { data, error } = await supabase
    .from('license_plates')
    .select('*')
    .eq('receiving_job_line_id', jobLineId)
    .order('id', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function insertReceivingJobLine(row: Partial<ReceivingJobLineRow>): Promise<ReceivingJobLineRow> {
  const { data, error } = await supabase.from('receiving_job_lines').insert(row).select().single();
  if (error) throw error;
  return data as ReceivingJobLineRow;
}

export async function deleteReceivingJobLine(lineId: number): Promise<void> {
  const { error } = await supabase.from('receiving_job_lines').delete().eq('id', lineId);
  if (error) throw error;
}

export async function updateReceivingJobLineRatio(lineId: number, patch: Partial<ReceivingJobLineRow>): Promise<void> {
  const { error } = await supabase.from('receiving_job_lines').update(patch).eq('id', lineId);
  if (error) throw error;
}

/** Convert a PO loose line to structured carton receiving (keeps po_qty_expected_ea). */
export async function convertReceivingLineToStructured(line: ReceivingJobLineRow): Promise<void> {
  const poRef =
    line.po_qty_expected_ea != null && line.po_qty_expected_ea > 0
      ? line.po_qty_expected_ea
      : line.total_ea > 0
        ? line.total_ea
        : null;
  await updateReceivingJobLineRatio(line.id, {
    receive_mode: 'structured',
    master_carton_qty: 0,
    inner_pack_count: 0,
    inner_labels_count: 0,
    master_labels_count: 0,
    total_ea: 0,
    loose_target_bin_id: null,
    ratio_verified_at: null,
    po_qty_expected_ea: poRef,
  });
}

/** Save pack size to catalog so outer/inner scans show qty (receiving label plan). */
export async function upsertPackDefinitionFromReceiving(args: {
  busyCode: number;
  itemName: string;
  itemId?: number | null;
  pcsPerInner: number;
  innersPerOuter?: number | null;
}): Promise<void> {
  const pcs = Math.max(1, Math.floor(args.pcsPerInner));
  const ipm = args.innersPerOuter != null ? Math.max(1, Math.floor(args.innersPerOuter)) : null;
  // 2-level (no inner cartons): outer_pack_qty = pcs per outer box
  const outer = ipm != null ? ipm * pcs : pcs;
  const { error } = await supabase.rpc('upsert_item_pack_definitions', {
    p_rows: [
      {
        busy_code: args.busyCode,
        item_id: args.itemId ?? null,
        item_name: args.itemName,
        inner_pack_qty: pcs,
        outer_pack_qty: outer,
      },
    ],
    p_source_file: 'receiving_label_plan',
  });
  if (error) throw error;
}

/** Gate: create outer/master license_plates only (structured mode). */
export async function receivingPrintMasterLabels(jobLineId: number, userId: number | null, userName: string | null) {
  const { data, error } = await supabase.rpc('receiving_print_master_labels', {
    p_job_line_id: jobLineId,
    p_user_id: userId,
    p_user_name: userName,
  });
  if (error) throw error;
  return data as {
    success: boolean;
    reason?: string;
    master_inserted?: number;
  };
}

/** Sort: create inner license_plates after ratio_verified_at is set. */
export async function receivingPrintInnerLabels(jobLineId: number, userId: number | null, userName: string | null) {
  const { data, error } = await supabase.rpc('receiving_print_inner_labels', {
    p_job_line_id: jobLineId,
    p_user_id: userId,
    p_user_name: userName,
  });
  if (error) throw error;
  return data as {
    success: boolean;
    reason?: string;
    inner_inserted?: number;
  };
}

export async function receivingApplyInnerOverflow(
  lpId: number,
  overflowBinId: string,
  jobId: number,
  lineId: number,
  userId: number | null,
  userName: string | null,
) {
  const { data, error } = await supabase.rpc('receiving_apply_inner_overflow', {
    p_lp_id: lpId,
    p_overflow_bin_id: overflowBinId,
    p_job_id: jobId,
    p_job_line_id: lineId,
    p_user_id: userId,
    p_user_name: userName,
  });
  if (error) throw error;
  return data as { success: boolean; reason?: string };
}

export async function receivingApplyInnerBreak(
  lpId: number,
  jobId: number,
  lineId: number,
  userId: number | null,
  userName: string | null,
) {
  const { data, error } = await supabase.rpc('receiving_apply_inner_break', {
    p_lp_id: lpId,
    p_job_id: jobId,
    p_job_line_id: lineId,
    p_user_id: userId,
    p_user_name: userName,
  });
  if (error) throw error;
  return data as { success: boolean; reason?: string; each_label_batch_ea?: number };
}

export async function receivingInvalidateLpBeforeReprint(lpId: number) {
  const { data, error } = await supabase.rpc('receiving_invalidate_license_plate_before_reprint', {
    p_lp_id: lpId,
  });
  if (error) throw error;
  return data as { success: boolean; reason?: string };
}

export async function insertReceivingScanEvent(row: {
  receiving_job_id: number;
  receiving_job_line_id: number | null;
  license_plate_id?: number | null;
  event_type: string;
  overflow_location_bin_id?: string | null;
  qty_delta?: number | null;
  bin_id?: string | null;
  created_by_user_id?: number | null;
  created_by_name?: string | null;
}) {
  const { error } = await supabase.from('receiving_scan_events').insert(row);
  if (error) throw error;
}

export type ReceivingLpCandidate = {
  id: number;
  lpn_code: string;
  receiving_pack_seq: number | null;
  receiving_lot: string | null;
  pack_qty: number;
};

export async function receivingResolveLpScan(scanRaw: string, jobLineId?: number) {
  const { data, error } = await supabase.rpc('receiving_resolve_lp_scan', {
    p_scan_raw: scanRaw,
    p_job_line_id: jobLineId ?? null,
  });
  if (error) throw error;
  return data as Record<string, unknown> & {
    success: boolean;
    reason?: string;
    license_plate?: Record<string, unknown>;
    job_line?: ReceivingJobLineRow;
    job?: ReceivingJobRow;
    allowed_dispositions?: string[];
    mrp_required?: boolean;
    putaway_ea_remaining?: number | null;
    candidates?: ReceivingLpCandidate[];
    resolved_by?: 'lpn' | 'pack';
  };
}

export async function promoteStagingLayer(input: {
  layerId: number;
  toBinId: string;
  qtyEa: number;
  userId: number | null;
  userName: string | null;
}) {
  const { data, error } = await supabase.rpc('wms_promote_staging_layer', {
    p_layer_id: input.layerId,
    p_to_bin_id: input.toBinId,
    p_qty_ea: input.qtyEa,
    p_user_id: input.userId,
    p_user_name: input.userName,
  });
  if (error) throw error;
  return data as { success: boolean; reason?: string; qty_ea?: number };
}

export async function fetchStagingLayersForBusy(busyCode: number) {
  const { data, error } = await supabase
    .from('bin_inventory_layers')
    .select('id,bin_id,sku_busy_code,qty_ea,mrp_per_ea,lot_no,fifo_received_at')
    .eq('sku_busy_code', busyCode)
    .gt('qty_ea', 0)
    .like('bin_id', 'STG%');
  if (error) throw error;
  return data ?? [];
}

export async function receivingPutawayInnerWhole(
  lpId: number,
  binId: string,
  jobId: number,
  lineId: number,
  userId: number | null,
  userName: string | null,
) {
  const { data, error } = await supabase.rpc('receiving_putaway_inner_whole', {
    p_lp_id: lpId,
    p_bin_id: binId,
    p_job_id: jobId,
    p_job_line_id: lineId,
    p_user_id: userId,
    p_user_name: userName,
  });
  if (error) throw error;
  return data as {
    success: boolean;
    reason?: string;
    layer_id?: number;
    qty_ea?: number;
    bin_id?: string;
  };
}

export async function receivingPutawayToBinBulk(
  lpId: number,
  binId: string,
  qtyEa: number,
  jobId: number,
  lineId: number,
  userId: number | null,
  userName: string | null,
) {
  const { data, error } = await supabase.rpc('receiving_putaway_to_bin_bulk', {
    p_lp_id: lpId,
    p_bin_id: binId,
    p_qty_ea: qtyEa,
    p_job_id: jobId,
    p_job_line_id: lineId,
    p_user_id: userId,
    p_user_name: userName,
  });
  if (error) throw error;
  return data as {
    success: boolean;
    reason?: string;
    layer_id?: number;
    qty_ea?: number;
    bin_id?: string;
    putaway_ea_remaining?: number;
  };
}

export async function receivingPutawayToBinEachScan(
  lpId: number,
  binId: string,
  itemScanRaw: string,
  jobId: number,
  lineId: number,
  userId: number | null,
  userName: string | null,
) {
  const { data, error } = await supabase.rpc('receiving_putaway_to_bin_each_scan', {
    p_lp_id: lpId,
    p_bin_id: binId,
    p_item_scan: itemScanRaw,
    p_job_id: jobId,
    p_job_line_id: lineId,
    p_user_id: userId,
    p_user_name: userName,
  });
  if (error) throw error;
  return data as {
    success: boolean;
    reason?: string;
    layer_id?: number;
    qty_ea?: number;
    bin_id?: string;
    putaway_ea_remaining?: number;
  };
}

export async function receivingTryRollUpPoForJobLine(jobLineId: number): Promise<{
  success: boolean;
  skipped?: boolean;
  reason?: string;
  qty_added?: number;
}> {
  const { data, error } = await supabase.rpc('receiving_try_roll_up_po_for_job_line', {
    p_job_line_id: jobLineId,
  });
  if (error) throw error;
  return data as {
    success: boolean;
    skipped?: boolean;
    reason?: string;
    qty_added?: number;
  };
}
