import { supabase } from './supabase/client';
import type {
  ItemPackDefinition,
  LicensePlate,
  LicensePlateBatch,
  LicensePlatePackType,
} from '../types';

export const PACK_DEFINITIONS_QUERY_KEY = ['item-pack-definitions'] as const;

export interface CreateLicensePlateBatchRow {
  busy_code: number;
  pack_type: LicensePlatePackType;
  count: number;
}

export interface CreateLicensePlateBatchResult {
  success: boolean;
  reason?: string;
  batch?: LicensePlateBatch;
  license_plates?: LicensePlate[];
  created_count?: number;
}

export async function fetchItemPackDefinitions(): Promise<ItemPackDefinition[]> {
  const { data, error } = await supabase
    .from('item_pack_definitions')
    .select('*')
    .order('item_name_snapshot', { ascending: true });

  if (error) throw error;
  return (data ?? []) as ItemPackDefinition[];
}

export async function createLicensePlateBatch({
  rows,
  userId,
  userName,
}: {
  rows: CreateLicensePlateBatchRow[];
  userId: number | null;
  userName: string | null;
}): Promise<CreateLicensePlateBatchResult> {
  const { data, error } = await supabase.rpc('create_license_plate_batch', {
    p_rows: rows,
    p_user_id: userId,
    p_user_name: userName,
  });

  if (error) throw error;
  return data as CreateLicensePlateBatchResult;
}

export async function markLicensePlateBatchPrinted(batchId: number): Promise<void> {
  const { error: batchError } = await supabase
    .from('license_plate_batches')
    .update({ printed_at: new Date().toISOString() })
    .eq('id', batchId);

  if (batchError) throw batchError;

  const { error: lpnError } = await supabase
    .from('license_plates')
    .update({ printed_at: new Date().toISOString() })
    .eq('batch_id', batchId);

  if (lpnError) throw lpnError;
}
