import type { CartItem, Customer, OrderPriority, Transport } from '../types';
import { getCustomerCity } from './customerDisplay';
import { idbGet, idbSet } from './idb';
import {
  offlineOrderStatusFromResult,
  type OfflineSalesOrderStatus,
  type SalesOrderSubmitResult,
} from './offlineSalesOrderResult';
import { normalizeSalesLineUnit } from './salesUnit';
import { supabase } from './supabase/client';

const IDB_KEY = 'offline-sales-orders-v1';
const CHANGE_EVENT = 'paspl-offline-sales-orders-changed';
const SYNC_MAX_PER_RUN = 5;
const SYNCED_PRUNE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type {
  OfflineSalesOrderStatus,
  SalesOrderSubmitLineResult,
  SalesOrderSubmitResult,
} from './offlineSalesOrderResult';

export interface SalesOrderPayloadLine {
  item_id: number;
  qty_requested: number;
  sales_unit: string;
  price_quoted: number;
  price_system: number;
  is_foc: boolean;
}

export interface SalesOrderPayload {
  client_order_key?: string;
  submission_mode?: 'online' | 'offline_replay';
  shortage_policy?: 'po_pending' | 'bill_available_skip_rest';
  customer_id: number;
  customer_name: string;
  customer_city: string | null;
  transport_id: number | null;
  transport_name: string | null;
  salesperson_name: string;
  salesperson_user_id: number | null;
  priority: OrderPriority;
  notes: string | null;
  lines: SalesOrderPayloadLine[];
}

export interface OfflineSalesOrderSummary {
  customerName: string;
  itemCount: number;
  totalPieces: number;
  totalValue: number;
  createdAt: string;
}

export interface OfflineSalesOrder {
  clientOrderKey: string;
  payload: SalesOrderPayload;
  summary: OfflineSalesOrderSummary;
  status: OfflineSalesOrderStatus;
  attempts: number;
  lastError: string | null;
  result: SalesOrderSubmitResult | null;
  createdAt: string;
  updatedAt: string;
}

let syncPromise: Promise<OfflineSalesOrder[]> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function notifyChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

export function createSalesOrderClientKey(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `offline-${random}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringOrNow(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value : nowIso();
}

function normalizePayload(value: unknown): SalesOrderPayload | null {
  if (!isObject(value)) return null;
  const lines = Array.isArray(value.lines) ? value.lines : [];
  if (typeof value.customer_name !== 'string' || value.customer_name.trim() === '') return null;
  if (typeof value.salesperson_name !== 'string' || value.salesperson_name.trim() === '') return null;
  if (lines.length === 0) return null;

  return value as unknown as SalesOrderPayload;
}

function summaryFromPayload(payload: SalesOrderPayload, createdAt: string): OfflineSalesOrderSummary {
  let totalPieces = 0;
  let totalValue = 0;
  for (const line of payload.lines) {
    const qty = numberOrZero(line.qty_requested);
    totalPieces += qty;
    if (!line.is_foc) {
      totalValue += qty * numberOrZero(line.price_quoted);
    }
  }
  return {
    customerName: payload.customer_name,
    itemCount: payload.lines.length,
    totalPieces,
    totalValue,
    createdAt,
  };
}

function normalizeSummary(
  value: unknown,
  payload: SalesOrderPayload,
  createdAt: string,
): OfflineSalesOrderSummary {
  if (!isObject(value)) return summaryFromPayload(payload, createdAt);
  return {
    customerName:
      typeof value.customerName === 'string' && value.customerName.trim() !== ''
        ? value.customerName
        : payload.customer_name,
    itemCount:
      typeof value.itemCount === 'number' && Number.isFinite(value.itemCount)
        ? value.itemCount
        : payload.lines.length,
    totalPieces: numberOrZero(value.totalPieces),
    totalValue: numberOrZero(value.totalValue),
    createdAt: stringOrNow(value.createdAt),
  };
}

function normalizeStatus(value: unknown): OfflineSalesOrderStatus {
  return value === 'queued' ||
    value === 'syncing' ||
    value === 'synced' ||
    value === 'partial' ||
    value === 'no_stock' ||
    value === 'failed'
    ? value
    : 'queued';
}

function normalizeOfflineOrder(value: unknown): OfflineSalesOrder | null {
  if (!isObject(value)) return null;
  const payload = normalizePayload(value.payload);
  if (!payload) return null;
  const createdAt = stringOrNow(value.createdAt);
  const clientOrderKey =
    typeof value.clientOrderKey === 'string' && value.clientOrderKey.trim() !== ''
      ? value.clientOrderKey
      : payload.client_order_key ?? createSalesOrderClientKey();

  return {
    clientOrderKey,
    payload: { ...payload, client_order_key: clientOrderKey },
    summary: normalizeSummary(value.summary, payload, createdAt),
    status: normalizeStatus(value.status),
    attempts:
      typeof value.attempts === 'number' && Number.isFinite(value.attempts)
        ? Math.max(0, value.attempts)
        : 0,
    lastError: typeof value.lastError === 'string' ? value.lastError : null,
    result: isObject(value.result) ? (value.result as unknown as SalesOrderSubmitResult) : null,
    createdAt,
    updatedAt: stringOrNow(value.updatedAt),
  };
}

function normalizeQueue(rows: OfflineSalesOrder[] | undefined): OfflineSalesOrder[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const normalized = normalizeOfflineOrder(row);
    return normalized ? [normalized] : [];
  });
}

async function writeQueue(rows: OfflineSalesOrder[]): Promise<void> {
  await idbSet(IDB_KEY, rows);
  notifyChanged();
}

export function subscribeOfflineSalesOrders(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

export async function readOfflineSalesOrders(): Promise<OfflineSalesOrder[]> {
  return normalizeQueue(await idbGet<OfflineSalesOrder[]>(IDB_KEY));
}

export function buildSalesOrderPayload(args: {
  customer: Customer;
  transport: Transport | null;
  userId: number | null;
  userName: string;
  priority: OrderPriority;
  notes: string;
  items: CartItem[];
  clientOrderKey?: string;
  submissionMode?: 'online' | 'offline_replay';
  shortagePolicy?: 'po_pending' | 'bill_available_skip_rest';
}): SalesOrderPayload {
  return {
    client_order_key: args.clientOrderKey,
    submission_mode: args.submissionMode,
    shortage_policy: args.shortagePolicy,
    customer_id: args.customer.id,
    customer_name: args.customer.name,
    customer_city: getCustomerCity(args.customer),
    transport_id: args.transport?.id ?? null,
    transport_name: args.transport?.name ?? null,
    salesperson_name: args.userName,
    salesperson_user_id: args.userId,
    priority: args.priority,
    notes: args.notes.trim() || null,
    lines: args.items.flatMap((ci) => {
      const foc = Math.max(0, ci.focQty ?? 0);
      const paid = ci.qty;
      const sys = ci.item.sales_price;
      const salesUnit = normalizeSalesLineUnit(ci.salesUnit);
      const rows: SalesOrderPayloadLine[] = [];
      if (paid > 0) {
        rows.push({
          item_id: ci.item.id,
          qty_requested: paid,
          sales_unit: salesUnit,
          price_quoted: ci.specialRate ?? sys,
          price_system: sys,
          is_foc: false,
        });
      }
      if (foc > 0) {
        rows.push({
          item_id: ci.item.id,
          qty_requested: foc,
          sales_unit: salesUnit,
          price_quoted: 0,
          price_system: sys,
          is_foc: true,
        });
      }
      return rows;
    }),
  };
}

export function buildOfflineOrderSummary(args: {
  customer: Customer;
  items: CartItem[];
}): OfflineSalesOrderSummary {
  let totalPieces = 0;
  let totalValue = 0;
  for (const c of args.items) {
    totalPieces += c.qty + (c.focQty ?? 0);
    totalValue += (c.specialRate ?? c.item.sales_price) * c.qty;
  }
  return {
    customerName: args.customer.name,
    itemCount: args.items.length,
    totalPieces,
    totalValue,
    createdAt: nowIso(),
  };
}

export const SALES_SUBMIT_TIMEOUT_MS = 2_000;
const SALES_SYNC_TIMEOUT_MS = 12_000;

export function isNetworkSubmitError(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err ?? '');
  return /failed to fetch|network|fetch failed|timeout|load failed|request|submit_timeout/i.test(
    message,
  );
}

export async function submitSalesOrderPayload(
  payload: SalesOrderPayload,
): Promise<SalesOrderSubmitResult> {
  const { data, error } = await supabase.rpc('submit_sales_order', {
    p_payload: payload,
  });
  if (error) throw error;
  return data as SalesOrderSubmitResult;
}

/** Avoid long hangs when the device reports online but the network is dead. */
export async function submitSalesOrderPayloadWithTimeout(
  payload: SalesOrderPayload,
  timeoutMs = SALES_SUBMIT_TIMEOUT_MS,
): Promise<SalesOrderSubmitResult> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      submitSalesOrderPayload(payload),
      new Promise<SalesOrderSubmitResult>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('submit_timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function enqueueOfflineSalesOrder(args: {
  customer: Customer;
  transport: Transport | null;
  userId: number | null;
  userName: string;
  priority: OrderPriority;
  notes: string;
  items: CartItem[];
  clientOrderKey?: string;
  payload?: SalesOrderPayload;
}): Promise<OfflineSalesOrder> {
  const row = createOfflineSalesOrder(args);
  const queue = await readOfflineSalesOrders();
  const next = queue.filter((q) => q.clientOrderKey !== row.clientOrderKey);
  next.unshift(row);
  await writeQueue(next);
  return row;
}

const LOCAL_QUEUE_MIRROR_KEY = `paspl-cache:${IDB_KEY}`;

function readLocalQueueMirror(): OfflineSalesOrder[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_QUEUE_MIRROR_KEY);
    const rows = raw == null ? [] : (JSON.parse(raw) as OfflineSalesOrder[]);
    return normalizeQueue(rows);
  } catch {
    return [];
  }
}

function writeLocalQueueMirror(rows: OfflineSalesOrder[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_QUEUE_MIRROR_KEY, JSON.stringify(rows));
  } catch {
    // If even the synchronous mirror is unavailable, keep the UI responsive.
  }
}

export function createOfflineSalesOrder(args: {
  customer: Customer;
  transport: Transport | null;
  userId: number | null;
  userName: string;
  priority: OrderPriority;
  notes: string;
  items: CartItem[];
  clientOrderKey?: string;
  payload?: SalesOrderPayload;
}): OfflineSalesOrder {
  const clientOrderKey = args.clientOrderKey ?? createSalesOrderClientKey();
  const payload =
    args.payload ??
    buildSalesOrderPayload({
      ...args,
      clientOrderKey,
      submissionMode: 'offline_replay',
      shortagePolicy: 'bill_available_skip_rest',
    });
  const createdAt = nowIso();
  const row: OfflineSalesOrder = {
    clientOrderKey,
    payload: args.payload
      ? { ...payload, client_order_key: clientOrderKey }
      : {
          ...payload,
          client_order_key: clientOrderKey,
          submission_mode: 'offline_replay',
          shortage_policy: 'bill_available_skip_rest',
        },
    summary: buildOfflineOrderSummary({ customer: args.customer, items: args.items }),
    status: 'queued',
    attempts: 0,
    lastError: null,
    result: null,
    createdAt,
    updatedAt: createdAt,
  };
  return row;
}

export function enqueueOfflineSalesOrderImmediate(args: {
  customer: Customer;
  transport: Transport | null;
  userId: number | null;
  userName: string;
  priority: OrderPriority;
  notes: string;
  items: CartItem[];
  clientOrderKey?: string;
  payload?: SalesOrderPayload;
}): OfflineSalesOrder {
  const row = createOfflineSalesOrder(args);
  const queue = readLocalQueueMirror();
  const next = queue.filter((q) => q.clientOrderKey !== row.clientOrderKey);
  next.unshift(row);
  writeLocalQueueMirror(next);
  notifyChanged();

  void (async () => {
    const persistedQueue = await readOfflineSalesOrders();
    const merged = persistedQueue.filter((q) => q.clientOrderKey !== row.clientOrderKey);
    merged.unshift(row);
    await writeQueue(merged);
  })().catch((error) => {
    console.error('offline sales order background persist failed', error);
  });

  return row;
}

export function isRetryableFailedSalesOrder(order: OfflineSalesOrder): boolean {
  if (order.status !== 'failed') return false;
  if (!order.lastError) return true;
  return isNetworkSubmitError(new Error(order.lastError));
}

export async function removeOfflineSalesOrder(clientOrderKey: string): Promise<void> {
  const queue = await readOfflineSalesOrders();
  await writeQueue(queue.filter((row) => row.clientOrderKey !== clientOrderKey));
}

export async function retryOfflineSalesOrder(
  clientOrderKey: string,
): Promise<OfflineSalesOrder | null> {
  const requeuedAt = nowIso();
  const queue = await readOfflineSalesOrders();
  const next = queue.map((row) =>
    row.clientOrderKey === clientOrderKey
      ? { ...row, status: 'queued' as const, lastError: null, updatedAt: requeuedAt }
      : row,
  );
  await writeQueue(next);
  await syncOfflineSalesOrders();
  return (await readOfflineSalesOrders()).find((row) => row.clientOrderKey === clientOrderKey) ?? null;
}

async function pruneSyncedOfflineSalesOrders(): Promise<void> {
  const cutoff = Date.now() - SYNCED_PRUNE_AGE_MS;
  const queue = await readOfflineSalesOrders();
  const next = queue.filter((row) => {
    if (row.status !== 'synced') return true;
    const updatedAt = new Date(row.updatedAt).getTime();
    return Number.isNaN(updatedAt) || updatedAt >= cutoff;
  });
  if (next.length !== queue.length) {
    await writeQueue(next);
  }
}

function findNextSalesSyncTarget(queue: OfflineSalesOrder[]): OfflineSalesOrder | undefined {
  return (
    queue.find((row) => row.status === 'queued' || row.status === 'syncing') ??
    queue.find((row) => isRetryableFailedSalesOrder(row))
  );
}

async function syncSingleOfflineSalesOrder(clientOrderKey: string): Promise<OfflineSalesOrder[]> {
  let queue = await readOfflineSalesOrders();
  let target = queue.find((row) => row.clientOrderKey === clientOrderKey);
  if (!target) return queue;

  if (isRetryableFailedSalesOrder(target)) {
    const requeuedAt = nowIso();
    queue = queue.map((row) =>
      row.clientOrderKey === clientOrderKey
        ? { ...row, status: 'queued', lastError: null, updatedAt: requeuedAt }
        : row,
    );
    await writeQueue(queue);
    target = { ...target, status: 'queued', lastError: null };
  }

  if (target.status !== 'queued' && target.status !== 'syncing') {
    return queue;
  }

  const startedAt = nowIso();
  queue = queue.map((row) =>
    row.clientOrderKey === clientOrderKey
      ? { ...row, status: 'syncing', updatedAt: startedAt }
      : row,
  );
  await writeQueue(queue);

  const payloadTarget =
    (await readOfflineSalesOrders()).find((row) => row.clientOrderKey === clientOrderKey) ?? target;

  try {
    const result = await submitSalesOrderPayloadWithTimeout(
      {
        ...payloadTarget.payload,
        client_order_key: payloadTarget.clientOrderKey,
      },
      SALES_SYNC_TIMEOUT_MS,
    );

    const status = result.success ? offlineOrderStatusFromResult(result) : 'failed';
    const updatedAt = nowIso();
    queue = (await readOfflineSalesOrders()).map((row) =>
      row.clientOrderKey === clientOrderKey
        ? {
            ...row,
            status,
            attempts: row.attempts + 1,
            lastError: result.success ? null : result.detail ?? result.error ?? 'Sync failed',
            result,
            updatedAt,
          }
        : row,
    );
    await writeQueue(queue);
    return queue;
  } catch (err) {
    const retryable = isNetworkSubmitError(err);
    const message = err instanceof Error ? err.message : 'Sync failed';
    const updatedAt = nowIso();
    queue = (await readOfflineSalesOrders()).map((row) =>
      row.clientOrderKey === clientOrderKey
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

export async function syncOfflineSalesOrders(): Promise<OfflineSalesOrder[]> {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    let queue = await readOfflineSalesOrders();
    let processed = 0;

    while (processed < SYNC_MAX_PER_RUN) {
      const target = findNextSalesSyncTarget(queue);
      if (!target) break;
      queue = await syncSingleOfflineSalesOrder(target.clientOrderKey);
      processed += 1;
    }

    await pruneSyncedOfflineSalesOrders();
    return queue;
  })().finally(() => {
    syncPromise = null;
  });

  return syncPromise;
}
