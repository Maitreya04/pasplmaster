import type { PickItemTransition } from './picking/itemTransitionAdapter';
import type { PickLineMrpState } from './picking/pickLineMrp';
import { pickQuantityTarget, pickableOrderItems } from './cartSupply';
import { idbGet, idbSet } from './idb';
import {
  offlinePickStatusFromResult,
  type OfflinePickStatus,
  type OfflinePickSyncResult,
} from './offlinePickResult';
import { supabase } from './supabase/client';
import type { OrderItem, OrderWithItems, ScanResult } from '../types';

const IDB_KEY = 'offline-picks-v1';
const CHANGE_EVENT = 'paspl-offline-picks-changed';

export type { OfflinePickStatus, OfflinePickSyncResult } from './offlinePickResult';

export interface OfflinePickLine {
  order_item_id: number;
  state: OrderItem['state'];
  picked_qty: number;
  scan_result: ScanResult | null;
  confirmed_mrp: number | null;
  flag_reason: string | null;
  flag_notes: string | null;
  flag_box_price: number | null;
  stock_bin_id: string | null;
  segments?: Array<{
    qty: number;
    mrp: number;
    custom?: boolean;
    scan_result?: ScanResult | null;
  }>;
}

export interface OfflinePickPayload {
  client_pick_key: string;
  order_id: number;
  claim_id: number;
  picker_user_id: number;
  picker_name: string | null;
  started_at: string;
  completed_at: string;
  box_count: number;
  has_flags: boolean;
  lines: OfflinePickLine[];
}

export interface OfflinePickSession {
  clientPickKey: string;
  orderId: number;
  claimId: number;
  pickerUserId: number;
  pickerName: string | null;
  orderNumber: string;
  customerName: string;
  status: OfflinePickStatus;
  attempts: number;
  lastError: string | null;
  result: OfflinePickSyncResult | null;
  preparedAt: string;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
  offlineLeaseExpiresAt: string | null;
  boxCount: number | null;
  orderSnapshot: OrderWithItems;
  lineMrpByItemId: Record<string, PickLineMrpState>;
}

let syncPromise: Promise<OfflinePickSession[]> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function notifyChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

function normalizeQueue(rows: OfflinePickSession[] | undefined): OfflinePickSession[] {
  return Array.isArray(rows) ? rows : [];
}

async function writeQueue(rows: OfflinePickSession[]): Promise<void> {
  await idbSet(IDB_KEY, rows);
  notifyChanged();
}

export function subscribeOfflinePicks(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

export async function readOfflinePicks(): Promise<OfflinePickSession[]> {
  return normalizeQueue(await idbGet<OfflinePickSession[]>(IDB_KEY));
}

export async function readOfflinePickSession(
  orderId: number | null,
): Promise<OfflinePickSession | null> {
  if (!orderId) return null;
  const rows = await readOfflinePicks();
  return rows.find((row) => row.orderId === orderId && row.status !== 'applied') ?? null;
}

export function isOfflinePickUsable(session: OfflinePickSession | null | undefined): boolean {
  return Boolean(session && session.status !== 'applied');
}

function getPickedQtyFromResult(result: ScanResult | null | undefined): number {
  return Math.max(0, result?.progress?.pickedQty ?? 0);
}

function confirmedMrpFromScan(scanResult: ScanResult | null | undefined): number | null {
  const raw = scanResult?.confirmedMrp;
  if (raw == null || !Number.isFinite(Number(raw))) return null;
  const n = Number(raw);
  return n >= 0 ? n : null;
}

function updatedOrderItemFromTransition(
  item: OrderItem,
  transition: PickItemTransition,
): OrderItem {
  if (item.id !== transition.itemId) return item;
  switch (transition.kind) {
    case 'scan_saved': {
      return {
        ...item,
        scan_result: transition.scanResult,
        confirmed_mrp: confirmedMrpFromScan(transition.scanResult) ?? item.confirmed_mrp,
      };
    }
    case 'picked': {
      return {
        ...item,
        state: 'picked',
        scan_result: transition.scanResult ?? null,
        confirmed_mrp: confirmedMrpFromScan(transition.scanResult) ?? item.confirmed_mrp,
      };
    }
    case 'flagged': {
      return {
        ...item,
        state: 'flagged',
        flag_reason: transition.reason,
        flag_notes: transition.notes,
        flag_box_price: transition.boxPrice,
        scan_result: transition.scanResult ?? null,
        confirmed_mrp: confirmedMrpFromScan(transition.scanResult) ?? item.confirmed_mrp,
      };
    }
  }
}

function withUpdatedOrderItem(
  order: OrderWithItems,
  update: (item: OrderItem) => OrderItem,
): OrderWithItems {
  return {
    ...order,
    items: order.items.map(update),
  };
}

export async function prepareOfflinePickSession(args: {
  order: OrderWithItems;
  claimId: number;
  userId: number;
  pickerName: string | null;
}): Promise<OfflinePickSession> {
  const { data, error } = await supabase.rpc('prepare_offline_pick', {
    p_order_id: args.order.id,
    p_claim_id: args.claimId,
    p_user_id: args.userId,
  });
  if (error) throw error;
  const result = data as {
    success?: boolean;
    reason?: string;
    client_pick_key?: string;
    offline_lease_expires_at?: string | null;
  } | null;
  if (!result?.success || !result.client_pick_key) {
    throw new Error(result?.reason ?? 'offline_prepare_failed');
  }

  const preparedAt = nowIso();
  const session: OfflinePickSession = {
    clientPickKey: result.client_pick_key,
    orderId: args.order.id,
    claimId: args.claimId,
    pickerUserId: args.userId,
    pickerName: args.pickerName,
    orderNumber: args.order.order_number,
    customerName: args.order.customer_name,
    status: 'active',
    attempts: 0,
    lastError: null,
    result: null,
    preparedAt,
    startedAt: args.order.picked_at ?? preparedAt,
    completedAt: null,
    updatedAt: preparedAt,
    offlineLeaseExpiresAt: result.offline_lease_expires_at ?? null,
    boxCount: null,
    orderSnapshot: args.order,
    lineMrpByItemId: {},
  };

  const queue = await readOfflinePicks();
  const next = queue.filter((row) => row.clientPickKey !== session.clientPickKey);
  next.unshift(session);
  await writeQueue(next);
  return session;
}

export async function applyOfflinePickTransition(args: {
  orderId: number;
  transition: PickItemTransition;
}): Promise<OfflinePickSession | null> {
  const queue = await readOfflinePicks();
  let updated: OfflinePickSession | null = null;
  const changedAt = nowIso();
  const next = queue.map((row) => {
    if (row.orderId !== args.orderId || row.status === 'applied') return row;
    updated = {
      ...row,
      status: row.status === 'failed' ? 'active' : row.status,
      lastError: null,
      updatedAt: changedAt,
      orderSnapshot: withUpdatedOrderItem(row.orderSnapshot, (item) =>
        updatedOrderItemFromTransition(item, args.transition),
      ),
    };
    return updated;
  });
  if (updated) await writeQueue(next);
  return updated;
}

export async function resetOfflinePickLine(args: {
  orderId: number;
  orderItemId: number;
  scanResult: ScanResult | null;
  state: OrderItem['state'];
}): Promise<void> {
  const queue = await readOfflinePicks();
  const changedAt = nowIso();
  let changed = false;
  const next = queue.map((row) => {
    if (row.orderId !== args.orderId || row.status === 'applied') return row;
    changed = true;
    return {
      ...row,
      updatedAt: changedAt,
      orderSnapshot: withUpdatedOrderItem(row.orderSnapshot, (item) =>
        item.id === args.orderItemId
          ? {
              ...item,
              state: args.state,
              scan_result: args.scanResult,
              flag_reason: args.state === 'flagged' ? item.flag_reason : null,
              flag_notes: args.state === 'flagged' ? item.flag_notes : null,
              flag_box_price: args.state === 'flagged' ? item.flag_box_price : null,
            }
          : item,
      ),
    };
  });
  if (changed) await writeQueue(next);
}

export async function saveOfflinePickLineMrpMap(
  orderId: number,
  lineMrpMap: Map<number, PickLineMrpState>,
): Promise<void> {
  const queue = await readOfflinePicks();
  const changedAt = nowIso();
  let changed = false;
  const record = Object.fromEntries([...lineMrpMap.entries()].map(([id, state]) => [String(id), state]));
  const next = queue.map((row) => {
    if (row.orderId !== orderId || row.status === 'applied') return row;
    changed = true;
    return { ...row, lineMrpByItemId: record, updatedAt: changedAt };
  });
  if (changed) await writeQueue(next);
}

function lineSegmentsForPayload(
  item: OrderItem,
  lineMrpByItemId: Record<string, PickLineMrpState>,
): OfflinePickLine['segments'] {
  const state = lineMrpByItemId[String(item.id)];
  if (state?.mode !== 'split') return undefined;
  const segments = state.segments
    .filter((segment) => segment.committed && segment.qty > 0 && segment.mrp >= 0)
    .map((segment) => ({
      qty: Math.floor(segment.qty),
      mrp: segment.mrp,
      custom: segment.custom,
      scan_result: item.scan_result,
    }));
  return segments.length > 0 ? segments : undefined;
}

export function buildOfflinePickPayload(session: OfflinePickSession): OfflinePickPayload {
  const completedAt = session.completedAt ?? nowIso();
  const lines: OfflinePickLine[] = pickableOrderItems(session.orderSnapshot.items).map((item) => {
    const targetQty = pickQuantityTarget(item);
    const pickedQty =
      item.state === 'picked'
        ? Math.min(targetQty, getPickedQtyFromResult(item.scan_result) || targetQty)
        : Math.min(targetQty, getPickedQtyFromResult(item.scan_result));
    return {
      order_item_id: item.id,
      state: item.state,
      picked_qty: pickedQty,
      scan_result: item.scan_result,
      confirmed_mrp: item.confirmed_mrp ?? confirmedMrpFromScan(item.scan_result),
      flag_reason: item.flag_reason,
      flag_notes: item.flag_notes,
      flag_box_price: item.flag_box_price,
      stock_bin_id: item.rack_no,
      segments: lineSegmentsForPayload(item, session.lineMrpByItemId),
    };
  });

  return {
    client_pick_key: session.clientPickKey,
    order_id: session.orderId,
    claim_id: session.claimId,
    picker_user_id: session.pickerUserId,
    picker_name: session.pickerName,
    started_at: session.startedAt,
    completed_at: completedAt,
    box_count: session.boxCount ?? 1,
    has_flags: lines.some((line) => line.state === 'flagged'),
    lines,
  };
}

export function isNetworkPickSyncError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err ?? '');
  return /failed to fetch|network|fetch failed|timeout|load failed|request/i.test(message);
}

export async function completeOfflinePick(args: {
  orderId: number;
  boxCount: number;
}): Promise<OfflinePickSession | null> {
  const queue = await readOfflinePicks();
  const completedAt = nowIso();
  let target: OfflinePickSession | null = null;
  const next = queue.map((row) => {
    if (row.orderId !== args.orderId || row.status === 'applied') return row;
    target = {
      ...row,
      status: 'queued',
      boxCount: args.boxCount,
      completedAt,
      updatedAt: completedAt,
      lastError: null,
    };
    return target;
  });
  if (!target) return null;
  await writeQueue(next);
  await syncOfflinePicks();
  const after = await readOfflinePicks();
  return after.find((row) => row.orderId === args.orderId) ?? target;
}

async function submitOfflinePickPayload(
  payload: OfflinePickPayload,
): Promise<OfflinePickSyncResult> {
  const { data, error } = await supabase.rpc('submit_offline_pick', {
    p_payload: payload as unknown as Record<string, unknown>,
  });
  if (error) throw error;
  return data as OfflinePickSyncResult;
}

export async function syncOfflinePicks(): Promise<OfflinePickSession[]> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return readOfflinePicks();
    }

    let queue = await readOfflinePicks();
    const target = queue.find((row) => row.status === 'queued' || row.status === 'syncing');
    if (!target) return queue;

    const startedAt = nowIso();
    queue = queue.map((row) =>
      row.clientPickKey === target.clientPickKey
        ? { ...row, status: 'syncing', updatedAt: startedAt }
        : row,
    );
    await writeQueue(queue);

    try {
      const result = await submitOfflinePickPayload(buildOfflinePickPayload(target));
      const status = offlinePickStatusFromResult(result);
      const updatedAt = nowIso();
      queue = (await readOfflinePicks()).map((row) =>
        row.clientPickKey === target.clientPickKey
          ? {
              ...row,
              status,
              attempts: row.attempts + 1,
              lastError: result.success ? null : result.reason ?? result.error ?? 'Sync failed',
              result,
              updatedAt,
            }
          : row,
      );
      await writeQueue(queue);
      return queue;
    } catch (err) {
      const retryable = isNetworkPickSyncError(err);
      const message = err instanceof Error ? err.message : 'Sync failed';
      const updatedAt = nowIso();
      queue = (await readOfflinePicks()).map((row) =>
        row.clientPickKey === target.clientPickKey
          ? {
              ...row,
              status: retryable ? 'queued' : 'failed',
              attempts: row.attempts + 1,
              lastError: message,
              updatedAt,
            }
          : row,
      );
      await writeQueue(queue);
      return queue;
    }
  })().finally(() => {
    syncPromise = null;
  });

  return syncPromise;
}
