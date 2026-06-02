import type { CartItem, Customer, Transport } from '../types';
import { IMPLICIT_SALES_UNIT_ID } from './sales/sellingUnits';

function normalizeCartItem(row: CartItem): CartItem {
  const foc =
    typeof row.focQty === 'number' && Number.isFinite(row.focQty)
      ? Math.max(0, Math.floor(row.focQty))
      : 0;
  const salesSellingUnit =
    typeof row.salesSellingUnit === 'string' && row.salesSellingUnit.trim()
      ? row.salesSellingUnit.trim()
      : IMPLICIT_SALES_UNIT_ID;
  return { ...row, focQty: foc, salesSellingUnit };
}

const DRAFT_VERSION = 2 as const;
const LEGACY_DRAFT_VERSION = 1 as const;
/** Drop drafts older than this (stale catalog / forgotten tabs). */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CartDraftPayload {
  items: CartItem[];
  nextLineId: number;
  selectedCustomer: Customer | null;
  selectedTransport: Transport | null;
  priority: 'normal' | 'urgent';
  notes: string;
}

interface StoredDraft extends CartDraftPayload {
  v: typeof DRAFT_VERSION | typeof LEGACY_DRAFT_VERSION;
  savedAt: number;
}

function storageKey(userName: string | null, userId: number | null): string {
  if (userName) return `paspl_sales_cart_draft_n_${encodeURIComponent(userName)}`;
  if (userId != null) return `paspl_sales_cart_draft_u_${userId}`;
  return 'paspl_sales_cart_draft_guest';
}

function isEmptyDraft(p: CartDraftPayload): boolean {
  return (
    p.items.length === 0 &&
    p.selectedCustomer === null &&
    p.selectedTransport === null &&
    p.priority === 'normal' &&
    p.notes.trim() === ''
  );
}

function safeRemove(key: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function safeSet(key: string, value: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // quota / private mode — ignore
  }
}

function safeGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function nextLineIdFromItems(items: CartItem[]): number {
  let max = 0;
  for (const row of items) {
    const m = /^line-(\d+)$/.exec(row.lineId);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

export function readCartDraft(
  userName: string | null,
  userId: number | null,
): CartDraftPayload | null {
  const key = storageKey(userName, userId);
  const raw = safeGet(key);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    safeRemove(key);
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    safeRemove(key);
    return null;
  }

  const rec = parsed as Record<string, unknown>;
  if (
    (rec.v !== DRAFT_VERSION && rec.v !== LEGACY_DRAFT_VERSION) ||
    typeof rec.savedAt !== 'number'
  ) {
    safeRemove(key);
    return null;
  }

  if (Date.now() - rec.savedAt > MAX_AGE_MS) {
    safeRemove(key);
    return null;
  }

  const items = rec.items;
  if (!Array.isArray(items)) {
    safeRemove(key);
    return null;
  }

  const payload: CartDraftPayload = {
    items: (items as CartItem[]).map(normalizeCartItem),
    nextLineId:
      typeof rec.nextLineId === 'number' && rec.nextLineId >= 1
        ? rec.nextLineId
        : nextLineIdFromItems(items as CartItem[]),
    selectedCustomer: (rec.selectedCustomer as Customer | null) ?? null,
    selectedTransport: (rec.selectedTransport as Transport | null) ?? null,
    priority: rec.priority === 'urgent' ? 'urgent' : 'normal',
    notes: typeof rec.notes === 'string' ? rec.notes : '',
  };

  return payload;
}

export function writeCartDraft(
  userName: string | null,
  userId: number | null,
  payload: CartDraftPayload,
): void {
  const key = storageKey(userName, userId);
  if (isEmptyDraft(payload)) {
    safeRemove(key);
    return;
  }

  const body: StoredDraft = {
    v: DRAFT_VERSION,
    savedAt: Date.now(),
    ...payload,
  };
  safeSet(key, JSON.stringify(body));
}

export function clearCartDraft(userName: string | null, userId: number | null): void {
  safeRemove(storageKey(userName, userId));
}
