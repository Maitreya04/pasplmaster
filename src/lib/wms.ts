import { supabase } from './supabase/client';
import type { BinCountLog, BinInventory } from '../types';

export const BIN_INVENTORY_QUERY_KEY = ['wms', 'bin-inventory'] as const;
export const PENDING_BIN_COUNTS_QUERY_KEY = ['wms', 'pending-bin-counts'] as const;

export interface SubmitBinCountInput {
  binId: string;
  skuBusyCode: number;
  innerPacks: number;
  looseEaQty: number;
  innerPackQty: number;
  dailyTarget: number | null;
  reorderPoint: number | null;
  countType: 'initial_setup' | 'cycle_count' | 'adjustment';
  userId: number | null;
  userName: string | null;
  note: string | null;
}

export interface RpcResult {
  success: boolean;
  reason?: string;
  status?: string;
  log_id?: number;
  requires_approval?: boolean;
  imported?: number;
  skipped?: number;
  seeded?: number;
  skipped_ambiguous?: number;
}

export interface BulkBinImportRow {
  bin_id: string;
  sku_busy_code: number;
  inner_packs: number;
  loose_ea_qty: number;
  inner_pack_qty: number;
  daily_target: number | null;
  reorder_point: number | null;
}

export async function fetchBinInventory(): Promise<BinInventory[]> {
  const { data, error } = await supabase
    .from('bin_inventory')
    .select('*')
    .order('bin_id', { ascending: true });

  if (error) throw error;
  return (data ?? []) as BinInventory[];
}

export async function fetchPendingBinCounts(): Promise<BinCountLog[]> {
  const { data, error } = await supabase
    .from('bin_count_logs')
    .select('*')
    .eq('status', 'pending_review')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as BinCountLog[];
}

export async function submitBinCount(input: SubmitBinCountInput): Promise<RpcResult> {
  const { data, error } = await supabase.rpc('submit_bin_count', {
    p_bin_id: input.binId,
    p_sku_busy_code: input.skuBusyCode,
    p_inner_packs: input.innerPacks,
    p_loose_ea_qty: input.looseEaQty,
    p_inner_pack_qty: input.innerPackQty,
    p_daily_target: input.dailyTarget,
    p_reorder_point: input.reorderPoint,
    p_count_type: input.countType,
    p_user_id: input.userId,
    p_user_name: input.userName,
    p_note: input.note,
  });

  if (error) throw error;
  return data as RpcResult;
}

export async function reviewBinCount({
  logId,
  approved,
  userId,
  userName,
  reviewNote,
}: {
  logId: number;
  approved: boolean;
  userId: number | null;
  userName: string | null;
  reviewNote: string | null;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc('review_bin_count', {
    p_log_id: logId,
    p_approved: approved,
    p_user_id: userId,
    p_user_name: userName,
    p_review_note: reviewNote,
  });

  if (error) throw error;
  return data as RpcResult;
}

export async function bulkImportBinInventory({
  rows,
  userId,
  userName,
  sourceFile,
}: {
  rows: BulkBinImportRow[];
  userId: number | null;
  userName: string | null;
  sourceFile: string | null;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc('bulk_import_bin_inventory', {
    p_rows: rows,
    p_user_id: userId,
    p_user_name: userName,
    p_source_file: sourceFile,
  });

  if (error) throw error;
  return data as RpcResult;
}

export async function seedBinInventoryFromItems({
  innerPackQty,
  userId,
  userName,
}: {
  innerPackQty: number;
  userId: number | null;
  userName: string | null;
}): Promise<RpcResult> {
  const { data, error } = await supabase.rpc('seed_bin_inventory_from_items', {
    p_inner_pack_qty: innerPackQty,
    p_user_id: userId,
    p_user_name: userName,
  });

  if (error) throw error;
  return data as RpcResult;
}
