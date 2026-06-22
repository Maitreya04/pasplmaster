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
const LOCAL_QUEUE_MIRROR_KEY = `paspl-cache:${IDB_KEY}`;
const CHANGE_EVENT = 'paspl-offline-picks-changed';
const PREPARE_RETRY_DELAYS_MS = [0, 1_000, 2_000];
const BOOTSTRAP_TIMEOUT_MS = 8_000;
const SYNC_RPC_TIMEOUT_MS = 15_000;
const SYNC_MAX_PER_RUN = 5;
const APPLIED_PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
  claimId: number | null;
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
  /** Pool orders need a server claim before bootstrap can finish. */
  fromPool?: boolean;
}

let syncPromise: Promise<OfflinePickSession[]> | null = null;
/** Serializes IDB queue writes so MRP map saves cannot clobber line transitions. */
let offlineQueueWriteChain: Promise<unknown> = Promise.resolve();

async function withOfflineQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = offlineQueueWriteChain.then(fn, fn);
  offlineQueueWriteChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function nowIso(): string {
  return new Date().toISOString();
}

function notifyChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

function normalizeSession(row: OfflinePickSession): OfflinePickSession {
  return {
    ...row,
    claimId: typeof row.claimId === 'number' && Number.isFinite(row.claimId) ? row.claimId : null,
    fromPool: row.fromPool === true,
  };
}

function normalizeQueue(rows: OfflinePickSession[] | undefined): OfflinePickSession[] {
  return Array.isArray(rows) ? rows.map(normalizeSession) : [];
}

function readLocalQueueMirror(): OfflinePickSession[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_QUEUE_MIRROR_KEY);
    const rows = raw == null ? [] : (JSON.parse(raw) as OfflinePickSession[]);
    return normalizeQueue(rows);
  } catch {
    return [];
  }
}

function writeLocalQueueMirror(rows: OfflinePickSession[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_QUEUE_MIRROR_KEY, JSON.stringify(rows));
  } catch {
    // Keep the UI responsive even if the synchronous mirror is unavailable.
  }
}

export function createOfflinePickClientKey(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `pick-${random}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function writeQueue(rows: OfflinePickSession[]): Promise<void> {
  const normalized = normalizeQueue(rows);
  writeLocalQueueMirror(normalized);
  await idbSet(IDB_KEY, normalized);
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

export function readOfflinePicksMirror(): OfflinePickSession[] {
  return readLocalQueueMirror();
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

export function isOfflinePickSessionOpen(session: OfflinePickSession | null | undefined): boolean {
  return Boolean(session && (session.status === 'preparing' || session.status === 'active'));
}

export function isOfflinePickServerPrepared(session: OfflinePickSession | null | undefined): boolean {
  return Boolean(session?.offlineLeaseExpiresAt);
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

export function isRetryableFailedPick(session: OfflinePickSession): boolean {
  if (session.status !== 'failed') return false;
  if (!session.lastError) return true;
  return (
    isNetworkPickSyncError(new Error(session.lastError)) ||
    /offline_lease_expired|timeout|claim_lost/i.test(session.lastError)
  );
}

export async function prepareOfflinePickWithRetry(args: {
  order: OrderWithItems;
  claimId: number;
  userId: number;
  pickerName: string | null;
}): Promise<OfflinePickSession> {
  let lastError: unknown;
  for (let attempt = 0; attempt < PREPARE_RETRY_DELAYS_MS.length; attempt += 1) {
    const delay = PREPARE_RETRY_DELAYS_MS[attempt] ?? 0;
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    try {
      return await prepareOfflinePickSession(args);
    } catch (err) {
      lastError = err;
      if (!isNetworkPickSyncError(err)) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('offline_prepare_failed');
}

export function createProvisionalOfflinePickSessionImmediate(args: {
  order: OrderWithItems;
  claimId: number | null;
  userId: number;
  pickerName: string | null;
  fromPool?: boolean;
  clientPickKey?: string;
}): OfflinePickSession {
  const preparedAt = nowIso();
  const session: OfflinePickSession = {
    clientPickKey: args.clientPickKey ?? createOfflinePickClientKey(),
    orderId: args.order.id,
    claimId: args.claimId,
    pickerUserId: args.userId,
    pickerName: args.pickerName,
    orderNumber: args.order.order_number,
    customerName: args.order.customer_name,
    status: 'preparing',
    attempts: 0,
    lastError: null,
    result: null,
    preparedAt,
    startedAt: args.order.picked_at ?? preparedAt,
    completedAt: null,
    updatedAt: preparedAt,
    offlineLeaseExpiresAt: null,
    boxCount: null,
    orderSnapshot: args.order,
    lineMrpByItemId: {},
    fromPool: args.fromPool === true,
  };

  const queue = readLocalQueueMirror();
  const next = queue.filter((row) => row.orderId !== session.orderId && row.clientPickKey !== session.clientPickKey);
  next.unshift(session);
  writeLocalQueueMirror(next);
  notifyChanged();

  void (async () => {
    const persistedQueue = await readOfflinePicks();
    const merged = persistedQueue.filter(
      (row) => row.orderId !== session.orderId && row.clientPickKey !== session.clientPickKey,
    );
    merged.unshift(session);
    await writeQueue(merged);
  })().catch((error) => {
    console.error('offline pick background persist failed', error);
  });

  return session;
}

export async function persistSessionPatch(
  clientPickKey: string,
  patch: Partial<OfflinePickSession>,
): Promise<OfflinePickSession | null> {
  const queue = await readOfflinePicks();
  let updated: OfflinePickSession | null = null;
  const changedAt = nowIso();
  const next = queue.map((row) => {
    if (row.clientPickKey !== clientPickKey) return row;
    updated = { ...row, ...patch, updatedAt: changedAt };
    return updated;
  });
  if (!updated) return null;
  await writeQueue(next);
  return updated;
}

/**
 * Finishes server-side bootstrap for a local pick session: claim (pool) + prepare lease.
 */
export async function bootstrapOfflinePickSession(
  session: OfflinePickSession,
): Promise<OfflinePickSession> {
  if (session.status === 'active' && isOfflinePickServerPrepared(session)) {
    return session;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return session;
  }

  let working = session;
  if (working.fromPool && !working.claimId) {
    try {
      const claimResponse = await withTimeout(
        Promise.resolve(
          supabase.rpc('claim_order', {
            p_order_id: working.orderId,
            p_stage: 'picking',
            p_user_id: working.pickerUserId,
          }),
        ),
        BOOTSTRAP_TIMEOUT_MS,
        'bootstrap_claim',
      );
      const { data, error } = claimResponse;
      if (error) throw error;
      const claimResult = data as {
        success?: boolean;
        reason?: string;
        claim_id?: number;
      };
      if (!claimResult?.success || !claimResult.claim_id) {
        return working;
      }
      working =
        (await persistSessionPatch(working.clientPickKey, { claimId: claimResult.claim_id })) ??
        { ...working, claimId: claimResult.claim_id };
    } catch (err) {
      if (!isNetworkPickSyncError(err)) {
        const message = err instanceof Error ? err.message : 'bootstrap_claim_failed';
        return (
          (await persistSessionPatch(working.clientPickKey, { lastError: message })) ?? working
        );
      }
      return working;
    }
  }

  if (!working.claimId) {
    return working;
  }

  try {
    const prepared = await withTimeout(
      prepareOfflinePickSession({
        order: working.orderSnapshot,
        claimId: working.claimId,
        userId: working.pickerUserId,
        pickerName: working.pickerName,
        existingClientPickKey: working.clientPickKey,
        preserveStatus: working.status === 'queued' || working.status === 'syncing',
      }),
      BOOTSTRAP_TIMEOUT_MS,
      'bootstrap_prepare',
    );
    return prepared;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'bootstrap_failed';
    const updatedAt = nowIso();
    const queue = await readOfflinePicks();
    const next: OfflinePickSession[] = queue.map((row) => {
      if (row.clientPickKey !== working.clientPickKey) return row;
      const status: OfflinePickStatus =
        row.status === 'queued' || row.status === 'syncing' ? row.status : 'preparing';
      return {
        ...row,
        status,
        lastError: isNetworkPickSyncError(err) ? message : row.lastError ?? message,
        updatedAt,
      };
    });
    await writeQueue(next);
    return next.find((row) => row.clientPickKey === working.clientPickKey) ?? working;
  }
}

export async function prepareOfflinePickSession(args: {
  order: OrderWithItems;
  claimId: number;
  userId: number;
  pickerName: string | null;
  existingClientPickKey?: string;
  preserveStatus?: boolean;
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
  const existing = args.existingClientPickKey
    ? (await readOfflinePicks()).find((row) => row.clientPickKey === args.existingClientPickKey)
    : null;
  const session: OfflinePickSession = {
    clientPickKey: result.client_pick_key,
    orderId: args.order.id,
    claimId: args.claimId,
    pickerUserId: args.userId,
    pickerName: args.pickerName,
    orderNumber: args.order.order_number,
    customerName: args.order.customer_name,
    status:
      args.preserveStatus && existing && (existing.status === 'queued' || existing.status === 'syncing')
        ? existing.status
        : 'active',
    attempts: existing?.attempts ?? 0,
    lastError: null,
    result: existing?.result ?? null,
    preparedAt: existing?.preparedAt ?? preparedAt,
    startedAt: args.order.picked_at ?? existing?.startedAt ?? preparedAt,
    completedAt: existing?.completedAt ?? null,
    updatedAt: preparedAt,
    offlineLeaseExpiresAt: result.offline_lease_expires_at ?? null,
    boxCount: existing?.boxCount ?? null,
    orderSnapshot: existing?.orderSnapshot ?? args.order,
    lineMrpByItemId: existing?.lineMrpByItemId ?? {},
    fromPool: existing?.fromPool,
  };

  const queue = await readOfflinePicks();
  const withoutOrder = queue.filter(
    (row) =>
      row.clientPickKey !== session.clientPickKey &&
      !(row.orderId === session.orderId && row.status !== 'applied'),
  );
  withoutOrder.unshift(session);
  await writeQueue(withoutOrder);
  return session;
}

export async function applyOfflinePickTransition(args: {
  orderId: number;
  transition: PickItemTransition;
}): Promise<OfflinePickSession | null> {
  return withOfflineQueueLock(async () => {
    const queue = await readOfflinePicks();
    let updated: OfflinePickSession | null = null;
    const changedAt = nowIso();
    const next = queue.map((row) => {
      if (row.orderId !== args.orderId || row.status === 'applied') return row;
      updated = {
        ...row,
        status:
          row.status === 'failed'
            ? 'active'
            : row.status === 'preparing'
              ? 'preparing'
              : row.status,
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
  });
}

export async function resetOfflinePickLine(args: {
  orderId: number;
  orderItemId: number;
  scanResult: ScanResult | null;
  state: OrderItem['state'];
}): Promise<void> {
  await withOfflineQueueLock(async () => {
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
  });
}

export async function saveOfflinePickLineMrpMap(
  orderId: number,
  lineMrpMap: Map<number, PickLineMrpState>,
): Promise<void> {
  await withOfflineQueueLock(async () => {
    const queue = await readOfflinePicks();
    const changedAt = nowIso();
    let changed = false;
    const record = Object.fromEntries(
      [...lineMrpMap.entries()].map(([id, state]) => [String(id), state]),
    );
    const next = queue.map((row) => {
      if (row.orderId !== orderId || row.status === 'applied') return row;
      changed = true;
      return { ...row, lineMrpByItemId: record, updatedAt: changedAt };
    });
    if (changed) await writeQueue(next);
  });
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
  if (!session.claimId) {
    throw new Error('missing_claim_id');
  }
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
  return withOfflineQueueLock(async () => {
    const queue = await readOfflinePicks();
    const existing = queue.find((row) => row.orderId === args.orderId && row.status !== 'applied');
    if (!existing) return null;

    const completedAt = nowIso();
    let target: OfflinePickSession | null = null;
    const next = queue.map((row) => {
      if (row.orderId !== args.orderId || row.status === 'applied') return row;
      const waitingForPrepare =
        row.status === 'preparing' || !isOfflinePickServerPrepared(row);
      target = {
        ...row,
        status: 'queued',
        boxCount: args.boxCount,
        completedAt,
        updatedAt: completedAt,
        lastError: waitingForPrepare ? (row.lastError ?? 'waiting_for_server_prepare') : null,
      };
      return target;
    });
    if (!target) return null;
    await writeQueue(next);

    // Local-first finish — never block the picker on server sync.
    void syncOfflinePicks();

    return target;
  });
}

async function submitOfflinePickPayload(
  payload: OfflinePickPayload,
): Promise<OfflinePickSyncResult> {
  const response = await withTimeout(
    Promise.resolve(
      supabase.rpc('submit_offline_pick', {
        p_payload: payload as unknown as Record<string, unknown>,
      }),
    ),
    SYNC_RPC_TIMEOUT_MS,
    'submit_offline_pick',
  );
  const { data, error } = response;
  if (error) throw error;
  return data as OfflinePickSyncResult;
}

function findNextBootstrapTarget(queue: OfflinePickSession[]): OfflinePickSession | undefined {
  return queue.find((row) => row.status === 'preparing');
}

function findNextSyncTarget(queue: OfflinePickSession[]): OfflinePickSession | undefined {
  return (
    queue.find((row) => row.status === 'queued' || row.status === 'syncing') ??
    queue.find((row) => isRetryableFailedPick(row))
  );
}

async function syncSingleOfflinePick(clientPickKey: string): Promise<OfflinePickSession[]> {
  let queue = await readOfflinePicks();
  let target = queue.find((row) => row.clientPickKey === clientPickKey);
  if (!target) return queue;
  let activeKey = clientPickKey;

  if (!isOfflinePickServerPrepared(target)) {
    target = await bootstrapOfflinePickSession(target);
    activeKey = target.clientPickKey;
    if (!isOfflinePickServerPrepared(target)) {
      return readOfflinePicks();
    }
  }

  if (target.status === 'failed' && isRetryableFailedPick(target)) {
    const requeuedAt = nowIso();
    queue = queue.map((row) =>
      row.clientPickKey === activeKey
        ? { ...row, status: 'queued', lastError: null, updatedAt: requeuedAt }
        : row,
    );
    await writeQueue(queue);
    target = { ...target, status: 'queued' };
  }

  if (target.status !== 'queued' && target.status !== 'syncing') {
    return queue;
  }

  const startedAt = nowIso();
  queue = queue.map((row) =>
    row.clientPickKey === activeKey
      ? { ...row, status: 'syncing', updatedAt: startedAt }
      : row,
  );
  await writeQueue(queue);

  const session =
    (await readOfflinePicks()).find((row) => row.clientPickKey === activeKey) ?? target;

  try {
    const payload = buildOfflinePickPayload(session);
    const result = await submitOfflinePickPayload(payload);
    const status = offlinePickStatusFromResult(result);
    const updatedAt = nowIso();
    queue = (await readOfflinePicks()).map((row) =>
      row.clientPickKey === activeKey
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
    const message = err instanceof Error ? err.message : 'Sync failed';
    const retryable =
      isNetworkPickSyncError(err) || message === 'missing_claim_id';
    const updatedAt = nowIso();
    queue = (await readOfflinePicks()).map((row) =>
      row.clientPickKey === activeKey
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
}

export async function retryOfflinePickSync(orderId: number): Promise<OfflinePickSession | null> {
  const queue = await readOfflinePicks();
  const target = queue.find(
    (row) => row.orderId === orderId && row.status !== 'applied',
  );
  if (!target) return null;

  const requeuedAt = nowIso();
  const next = queue.map((row) =>
    row.clientPickKey === target.clientPickKey
      ? { ...row, status: 'queued' as const, lastError: null, updatedAt: requeuedAt }
      : row,
  );
  await writeQueue(next);
  await syncOfflinePicks();
  const after = await readOfflinePicks();
  return after.find((row) => row.orderId === orderId) ?? null;
}

export async function extendOfflinePickLease(args: {
  clientPickKey: string;
  userId: number;
}): Promise<string | null> {
  const { data, error } = await supabase.rpc('extend_offline_pick_lease', {
    p_client_pick_key: args.clientPickKey,
    p_user_id: args.userId,
  });
  if (error) throw error;
  const result = data as {
    success?: boolean;
    offline_lease_expires_at?: string | null;
    reason?: string;
  } | null;
  if (!result?.success || !result.offline_lease_expires_at) {
    throw new Error(result?.reason ?? 'lease_extend_failed');
  }

  const updatedAt = nowIso();
  const queue = await readOfflinePicks();
  const next = queue.map((row) =>
    row.clientPickKey === args.clientPickKey
      ? { ...row, offlineLeaseExpiresAt: result.offline_lease_expires_at ?? null, updatedAt }
      : row,
  );
  await writeQueue(next);
  return result.offline_lease_expires_at ?? null;
}

export async function resolveOfflinePickConflict(args: {
  submissionId: number;
  action: 'discard' | 'release_claim';
}): Promise<void> {
  const { data, error } = await supabase.rpc('resolve_offline_pick_conflict', {
    p_submission_id: args.submissionId,
    p_action: args.action,
  });
  if (error) throw error;
  const result = data as { success?: boolean; reason?: string } | null;
  if (!result?.success) {
    throw new Error(result?.reason ?? 'resolve_failed');
  }
}

export async function pruneAppliedOfflinePicks(): Promise<void> {
  const cutoff = Date.now() - APPLIED_PRUNE_AGE_MS;
  const queue = await readOfflinePicks();
  const next = queue.filter((row) => {
    if (row.status !== 'applied') return true;
    const updatedAt = new Date(row.updatedAt).getTime();
    return Number.isNaN(updatedAt) || updatedAt >= cutoff;
  });
  if (next.length !== queue.length) {
    await writeQueue(next);
  }
}

export async function syncOfflinePicks(): Promise<OfflinePickSession[]> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return readOfflinePicks();
    }

    let queue = await readOfflinePicks();
    let processed = 0;

    while (processed < SYNC_MAX_PER_RUN) {
      const bootstrapTarget = findNextBootstrapTarget(queue);
      if (bootstrapTarget) {
        queue = await bootstrapOfflinePickSession(bootstrapTarget).then(() => readOfflinePicks());
        processed += 1;
        continue;
      }

      const target = findNextSyncTarget(queue);
      if (!target) break;
      queue = await syncSingleOfflinePick(target.clientPickKey);
      processed += 1;
    }

    await pruneAppliedOfflinePicks();
    return queue;
  })().finally(() => {
    syncPromise = null;
  });

  return syncPromise;
}
